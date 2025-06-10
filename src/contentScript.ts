/**
 * Handles all content script logic for extracting prices, injecting verdicts, and messaging.
 */

console.log('[content_script] Loaded');

import { getAlternateUrl } from './urlUtils';
import {
  priceSelector,
  productContainerSelector,
  productContainerFallbackSelectors,
} from './selectors';
import { getSiteMeta } from './siteMeta';
import { log, warn } from './logger';
import { injectVerdict } from './domUtils';
import type { ScanListingPageMessage } from './types';

// Move WindowWithNpcCache and AltPriceCache interfaces to the top of the file for global use
interface AltPriceCache {
  [altUrl: string]: { price?: string | number; status?: number };
}
interface WindowWithNpcCache extends Window {
  _npcAltPriceCache?: AltPriceCache;
  _nextPriceCheckerProducts?: Array<{ link: string; price: string }>;
  _npcInfiniteScrollObserver?: MutationObserver;
  _npcScrollTimeout?: ReturnType<typeof setTimeout>;
}
const win = window as WindowWithNpcCache;

chrome.runtime.onMessage.addListener((msg: ScanListingPageMessage, sender, sendResponse) => {
  if (msg.action === 'scanListingPage') {
    console.log('[content_script] Received scanListingPage message');

    (async () => {
      let responseObj: { products?: Array<{ link: string; price: string }>; error?: string } = {};
      let products: Array<{ link: string; price: string }> = [];
      try {
        // Try to detect product page price if product container is not found
        let productContainer = document.querySelector(
          productContainerSelector
        ) as HTMLElement | null;
        if (!productContainer) {
          // Try fallback selectors for robustness
          let fallback1 = null;
          let fallback2 = null;
          if (productContainerFallbackSelectors.length > 0) {
            fallback1 = document.querySelector(productContainerFallbackSelectors[0]);
          }
          if (productContainerFallbackSelectors.length > 1) {
            fallback2 = document.querySelector(productContainerFallbackSelectors[1]);
          }
          productContainer = (fallback1 || fallback2) as HTMLElement | null;
        }
        if (productContainer) {
          const productDivs = Array.from(productContainer.children);
          products = productDivs.map((div, _idx) => {
            const anchor = div.querySelector('a[href]') as HTMLAnchorElement | null;
            // Try priceSelector first for each product, then fallback
            let priceEl = div.querySelector(priceSelector) as HTMLElement | null;
            if (!priceEl) {
              priceEl = div.querySelector('.product-price, [data-testid="price"], span');
            }
            const link = anchor?.href ?? 'N/A';
            const price = priceEl?.textContent?.trim() ?? 'N/A';
            return { link, price };
          });
        } else {
          // Try priceSelector from selectors.ts first, then fallback to generic selectors
          let priceEl = document.querySelector(priceSelector) as HTMLElement | null;
          if (!priceEl) {
            priceEl = document.querySelector('.product-price, [data-testid="price"], span');
          }
          if (priceEl && priceEl.textContent) {
            products = [{ link: window.location.href, price: priceEl.textContent.trim() }];
          } else {
            products = [];
          }
        }
        win._nextPriceCheckerProducts = products;
        chrome.runtime.sendMessage({ action: 'npcProducts', products });
        // --- Inject price comparison for product page if on a product page ---
        // For single product pages, do NOT inject or update the DOM; only send price data for the popup
        // --- Inject price comparison for listing page (multiple products) ---
        if (products.length > 1) {
          // Always re-inject verdicts for all visible products (for infinite scroll)
          if (productContainer) {
            // Remove any previous verdicts before injecting new ones to handle infinite scroll and re-injection
            // (Do NOT remove verdicts here, only in processBatch for each product)
          }
          // For each product, fetch alternate price and inject into DOM in batches of 10
          const batchSize = 10;
          // Simple in-memory cache for alternate prices (per session)
          const altPriceCache = win._npcAltPriceCache ?? (win._npcAltPriceCache = {});
          const processBatch = (batch: Array<{ link: string; price: string }>, offset: number) => {
            log(
              `[content_script] processBatch called: batch.length=${batch.length}, offset=${offset}`
            );
            batch.forEach((product, _idx) => {
              // Move siteMeta declaration to just before first use in each code path
              let siteMeta: ReturnType<typeof getSiteMeta>;
              const uniqueId = btoa(unescape(encodeURIComponent(product.link)))
                .replace(/=+$/, '')
                .replace(/\/+/, '_');
              const compareId = `npc-price-compare-${uniqueId}`;
              const productDiv = productContainer?.children[offset + _idx] as
                | HTMLElement
                | undefined;
              if (!productDiv) {
                warn(
                  `[content_script] No productDiv found for idx=${offset + _idx}, url=${product.link}`
                );
                return;
              }
              siteMeta = getSiteMeta(location.hostname);
              log(
                `[content_script] Processing productDiv idx=${offset + _idx}, compareId=${compareId}, url=${product.link}`
              );
              // --- Debug: Log productDiv and its HTML for troubleshooting ---
              log(`[content_script] productDiv.outerHTML:`, productDiv.outerHTML);
              // --- End debug ---
              const oldVerdict = productDiv.querySelector(`#${compareId}`);
              if (oldVerdict && oldVerdict.parentElement) {
                oldVerdict.parentElement.removeChild(oldVerdict);
              }
              let priceEl = productDiv.querySelector('.product-price, [data-testid="price"], span');
              log(`[content_script] priceEl:`, priceEl ? priceEl.outerHTML : 'null');
              if (priceEl && priceEl.parentElement) {
                // No need to call removeVerdictById here, injectVerdict will handle it
              }
              try {
                const altUrl = getAlternateUrl(new URL(product.link));
                if (!altPriceCache) return;
                if (altPriceCache[altUrl]) {
                  siteMeta = getSiteMeta(location.hostname);
                  renderAndInjectVerdict(
                    product,
                    compareId,
                    productDiv,
                    altPriceCache[altUrl],
                    siteMeta,
                    priceEl
                  );
                  return;
                }
                chrome.runtime
                  .sendMessage({
                    action: 'getAlternatePrice',
                    url: altUrl,
                    priceSelector,
                  })
                  .then((resp: { price?: string | number; status?: number }) => {
                    if (!altPriceCache) return;
                    altPriceCache[altUrl] = resp;
                    siteMeta = getSiteMeta(location.hostname);
                    renderAndInjectVerdict(product, compareId, productDiv, resp, siteMeta, priceEl);
                  });
              } catch (e) {
                warn(
                  '[content_script] Could not fetch or inject alternate price for listing product:',
                  e
                );
              }
            });
          };
          let offset = 0;
          function processNextBatch() {
            if (offset >= products.length) return;
            const batch = products.slice(offset, offset + batchSize);
            processBatch(batch, offset);
            offset += batchSize;
            if (offset < products.length) {
              setTimeout(processNextBatch, 800); // 800ms between batches
            }
          }
          processNextBatch();
          // --- Infinite scroll support: observe for new products ---
          if (productContainer && !win._npcInfiniteScrollObserver) {
            const observer = new MutationObserver(() => {
              // Debounce to avoid rapid re-injection
              if (win._npcScrollTimeout) clearTimeout(win._npcScrollTimeout);
              win._npcScrollTimeout = setTimeout(() => {
                chrome.runtime.sendMessage({ action: 'scanListingPage' });
              }, 200);
            });
            observer.observe(productContainer, { childList: true, subtree: false });
            win._npcInfiniteScrollObserver = observer;
            console.log('[content_script] Infinite scroll observer attached');
          }
        }
        sendResponse();
        return;
      } catch (e) {
        console.error('[content_script] Error scanning listing:', e);
        let errorMsg = 'Unknown error';
        if (e && typeof e === 'object' && e !== null && 'message' in e) {
          errorMsg = (e as { message: string }).message;
        }
        responseObj = { error: errorMsg };
      }
      console.log('[content_script] Sending response:', responseObj);
      win._nextPriceCheckerProducts = responseObj.products ?? [];
      sendResponse();
    })();
    return true;
  }
});

// --- Price comparison injection for product page ---
function renderAndInjectVerdict(
  product: { link: string; price: string },
  compareId: string,
  productDiv: HTMLElement,
  resp: { price?: string | number; status?: number },
  siteMeta: ReturnType<typeof getSiteMeta>,
  priceEl: Element | null
) {
  let verdictHtml = '';
  if (resp && resp.status === 404) {
    verdictHtml = `<span style=\"color: orange;\">Alternate site not found (404). <a href=\"${getAlternateUrl(new URL(product.link))}\" target=\"_blank\">View alternate site</a></span>`;
  } else if (resp && resp.price !== null && resp.price !== undefined) {
    import('./exchangeRate').then(async ({ getCachedOrFetchRate }) => {
      const { getPriceComparisonVerdict } = await import('./priceUtils');
      const { rate } = await getCachedOrFetchRate();
      const result = await getPriceComparisonVerdict({
        currentPrice: product.price,
        altPrice: resp.price!.toString(),
        isUK: siteMeta.isUK,
        rate,
      });
      const altPriceNum = parseFloat(resp.price!.toString().replace(/[^\d.]/g, ''));
      const altConvertedDisplay = siteMeta.isUK
        ? `≈ £${result.altPriceConverted.toFixed(2)}`
        : `≈ ₪${result.altPriceConverted.toFixed(2)}`;
      const altDisplay = `Alternate site: ${siteMeta.altCurrency}${altPriceNum.toFixed(2)} (${altConvertedDisplay})`;
      let verdictMsg = '';
      let verdictColor = '';
      if (Math.abs(result.diff) > 0.01) {
        if (result.diff > 0) {
          verdictMsg = `📈 Alternate site is cheaper by ${siteMeta.currentCurrency}${Math.abs(result.diff).toFixed(2)} (${result.percDiff.toFixed(1)}%)`;
          verdictColor = 'color: red;';
        } else {
          verdictMsg = `📉 Alternate site is more expensive by ${siteMeta.currentCurrency}${Math.abs(result.diff).toFixed(2)} (${result.percDiff.toFixed(1)}%)`;
          verdictColor = 'color: green;';
        }
      } else {
        verdictMsg = 'Prices are about the same';
        verdictColor = '';
      }
      verdictHtml = `${altDisplay}<br><span style=\"${verdictColor}\">${verdictMsg}</span><br><a href=\"${getAlternateUrl(new URL(product.link))}\" target=\"_blank\" rel=\"noopener noreferrer\">View alternate site</a>`;
      injectVerdict(
        priceEl && priceEl.parentElement ? priceEl.parentElement : productDiv,
        compareId,
        verdictHtml,
        priceEl
      );
      log(`[content_script] Injected verdict for id=${compareId}, url=${product.link}`);
    });
    return;
  } else {
    verdictHtml = `<span style=\"color: gray;\">Could not fetch alternate price</span>`;
  }
  injectVerdict(
    priceEl && priceEl.parentElement ? priceEl.parentElement : productDiv,
    compareId,
    verdictHtml,
    priceEl
  );
  log(`[content_script] Injected fallback verdict for id=${compareId}, url=${product.link}`);
}
