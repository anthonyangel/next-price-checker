/**
 * Content script — extracts products, fetches alternate prices via background
 * (Bloomreach API), and injects verdict elements into the page.
 */

import { getAlternateUrl } from './urlUtils';
import { getSiteMeta } from './siteMeta';
import { log, warn } from './logger';
import { injectVerdict, type VerdictContent } from './domUtils';
import type { ScanListingPageMessage, CatalogSummary } from './types';
import { getCachedPrice, setCachedPrice } from './storageUtils';
import { getRetailerAndRegion } from './core/registry';
import { parsePrice } from './priceUtils';

log('[content_script] Loaded');

interface WindowWithNpcState extends Window {
  _nextPriceCheckerProducts?: Array<{ link: string; price: string }>;
  _npcInfiniteScrollObserver?: MutationObserver;
  _npcScrollTimeout?: ReturnType<typeof setTimeout>;
}
const win = window as WindowWithNpcState;

/** Derive a stable DOM-safe ID from a product URL. */
function productDomId(link: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(link)))
    .replace(/=+$/, '')
    .replace(/[/+]/g, '_');
}

let scanInProgress = false;
let filterActive = false;

/**
 * Core scan logic — extracts products from the page, sends them to the popup,
 * and fetches alternate prices via the Bloomreach API (through background).
 */
async function scanPage() {
  if (scanInProgress) return;
  scanInProgress = true;
  try {
    const retailerMatch = getRetailerAndRegion(location.hostname);
    if (!retailerMatch) {
      warn('[content_script] No retailer found for', location.hostname);
      return;
    }
    const { retailer } = retailerMatch;

    let products: Array<{ link: string; price: string }> = [];

    let productContainer = document.querySelector(retailer.productContainerSelector) as HTMLElement | null;
    if (!productContainer) {
      for (const sel of retailer.productContainerFallbackSelectors) {
        productContainer = document.querySelector(sel) as HTMLElement | null;
        if (productContainer) break;
      }
    }

    if (productContainer) {
      const productDivs = Array.from(productContainer.children);
      products = productDivs.map((div) => {
        const anchor = div.querySelector('a[href]') as HTMLAnchorElement | null;
        const priceEl = div.querySelector(retailer.priceSelector) as HTMLElement | null;
        const link = anchor?.href ?? 'N/A';
        const price = priceEl?.textContent?.trim() ?? 'N/A';
        return { link, price };
      });
    } else {
      const priceEl = document.querySelector(retailer.priceSelector) as HTMLElement | null;
      if (priceEl && priceEl.textContent) {
        products = [{ link: window.location.href, price: priceEl.textContent.trim() }];
      } else {
        products = [];
      }
    }

    win._nextPriceCheckerProducts = products;
    chrome.runtime.sendMessage({ action: 'npcProducts', products });

    // --- Catalog page: bulk fetch all alternate prices in one message ---
    if (products.length > 1 && productContainer) {
      const siteMeta = getSiteMeta(location.hostname);
      const container = productContainer; // capture for closure

      // Determine current and alternate region
      const currentRegionId = retailerMatch.regionId;
      const altRegionId = retailer.getAlternateRegionId(currentRegionId);

      // Build metadata for each product, check cache
      const uncachedUrls: string[] = [];
      // Track resolved alt prices for summary: pid → altPrice (numeric)
      const resolvedAltPrices: Map<string, number> = new Map();
      const productMeta: Array<{
        product: { link: string; price: string };
        altUrl: string | null;
        pid: string | null;
        idx: number;
        compareId: string;
      }> = [];

      for (let i = 0; i < products.length; i++) {
        const product = products[i];
        let altUrl: string | null = null;
        let pid: string | null = null;
        try {
          const productUrl = new URL(product.link);
          altUrl = getAlternateUrl(productUrl);
          pid = retailer.extractProductId(productUrl);
        } catch {
          // skip products without valid links
        }

        const domId = productDomId(product.link);
        const compareId = `npc-price-compare-${domId}`;
        productMeta.push({ product, altUrl, pid, idx: i, compareId });

        if (!altUrl || !pid) continue;

        // Cache current page price for this product
        if (currentRegionId) {
          const currentPrice = parsePrice(product.price);
          if (currentPrice !== null) {
            setCachedPrice(pid, currentRegionId, currentPrice);
          }
        }

        // Check persistent cache for alternate price
        if (altRegionId) {
          const cached = await getCachedPrice(pid, altRegionId);
          if (cached) {
            log(`[content_script] Cache HIT for ${pid}:${altRegionId}`);
            resolvedAltPrices.set(pid, cached.price);
            const productDiv = container.children[i] as HTMLElement | undefined;
            if (productDiv) {
              renderAndInjectVerdict(
                product,
                compareId,
                productDiv,
                { price: cached.price },
                siteMeta,
                productDiv.querySelector(retailer.priceSelector)
              );
            }
            continue;
          }
        }

        uncachedUrls.push(altUrl);
      }

      // Fetch all uncached prices in one bulk message
      if (uncachedUrls.length > 0) {
        log(`[content_script] Bulk API fetch: ${uncachedUrls.length} products`);
        try {
          const catalogResp: Record<string, { price: number }> =
            await chrome.runtime.sendMessage({
              action: 'getAlternateCatalogPrices',
              urls: uncachedUrls,
            });

          for (const meta of productMeta) {
            if (!meta.altUrl) continue;
            const resp = catalogResp[meta.altUrl];
            const productDiv = container.children[meta.idx] as HTMLElement | undefined;
            if (!productDiv) continue;

            if (resp?.price != null) {
              // Cache alternate price and render
              if (meta.pid && altRegionId) {
                setCachedPrice(meta.pid, altRegionId, resp.price);
                resolvedAltPrices.set(meta.pid, resp.price);
              }
              renderAndInjectVerdict(
                meta.product,
                meta.compareId,
                productDiv,
                resp,
                siteMeta,
                productDiv.querySelector(retailer.priceSelector)
              );
            } else if (uncachedUrls.includes(meta.altUrl)) {
              // No result from API — render fallback
              renderAndInjectVerdict(
                meta.product,
                meta.compareId,
                productDiv,
                {},
                siteMeta,
                productDiv.querySelector(retailer.priceSelector)
              );
            }
          }
        } catch (e) {
          warn('[content_script] Bulk catalog fetch failed:', e);
        }
      }

      // Send catalog summary to popup and tag product divs for filtering
      await sendCatalogSummary(productMeta, resolvedAltPrices, siteMeta, container);

      // Re-apply filter if active (e.g. after infinite scroll re-scan)
      if (filterActive) {
        applyFilter(true);
      }

      // Infinite scroll observer
      if (!win._npcInfiniteScrollObserver) {
        const observer = new MutationObserver(() => {
          if (win._npcScrollTimeout) clearTimeout(win._npcScrollTimeout);
          win._npcScrollTimeout = setTimeout(() => {
            scanPage();
          }, 200);
        });
        observer.observe(container, { childList: true, subtree: false });
        win._npcInfiniteScrollObserver = observer;
        log('[content_script] Infinite scroll observer attached');
      }
    }
  } finally {
    scanInProgress = false;
  }
}

/**
 * Compute and send a catalog price comparison summary to the popup.
 * Also tags each product div with data-npc-verdict for filtering.
 */
async function sendCatalogSummary(
  productMeta: Array<{
    product: { link: string; price: string };
    altUrl: string | null;
    pid: string | null;
    idx: number;
  }>,
  resolvedAltPrices: Map<string, number>,
  siteMeta: ReturnType<typeof getSiteMeta>,
  container: HTMLElement
) {
  const { getCachedOrFetchRate } = await import('./exchangeRate');
  const { rate } = await getCachedOrFetchRate();

  let cheaperHere = 0;
  let cheaperOnAlt = 0;
  let same = 0;
  const savingsAlt: CatalogSummary['topSavingsAlt'] = [];
  const savingsHere: CatalogSummary['topSavingsHere'] = [];

  for (const meta of productMeta) {
    const productDiv = container.children[meta.idx] as HTMLElement | undefined;

    if (!meta.pid || !meta.altUrl) {
      if (productDiv) productDiv.dataset.npcVerdict = 'unknown';
      continue;
    }
    const altPrice = resolvedAltPrices.get(meta.pid);
    if (altPrice == null) {
      if (productDiv) productDiv.dataset.npcVerdict = 'unknown';
      continue;
    }

    const currentPrice = parsePrice(meta.product.price);
    if (currentPrice == null) {
      if (productDiv) productDiv.dataset.npcVerdict = 'unknown';
      continue;
    }

    // Convert alt price to current currency for comparison
    const altConverted = siteMeta.isUK ? altPrice / rate : altPrice * rate;
    const diff = currentPrice - altConverted;
    const percDiff = (Math.abs(diff) / ((currentPrice + altConverted) / 2)) * 100;
    if (Math.abs(diff) <= 0.01) {
      same++;
      if (productDiv) productDiv.dataset.npcVerdict = 'same';
    } else if (diff > 0) {
      // Alt site is cheaper
      cheaperOnAlt++;
      if (productDiv) productDiv.dataset.npcVerdict = 'cheaper-alt';
      savingsAlt.push({
        pid: meta.pid,
        saving: `${siteMeta.currentCurrency}${Math.abs(diff).toFixed(2)}`,
        percDiff,
        url: meta.altUrl,
      });
    } else {
      cheaperHere++;
      if (productDiv) productDiv.dataset.npcVerdict = 'cheaper-here';
      savingsHere.push({
        pid: meta.pid,
        saving: `${siteMeta.currentCurrency}${Math.abs(diff).toFixed(2)}`,
        percDiff,
        url: meta.product.link,
      });
    }
  }

  // Sort by biggest % saving, keep top 3 each
  savingsAlt.sort((a, b) => b.percDiff - a.percDiff);
  savingsHere.sort((a, b) => b.percDiff - a.percDiff);

  const summary: CatalogSummary = {
    total: productMeta.length,
    compared: cheaperHere + cheaperOnAlt + same,
    cheaperHere,
    cheaperOnAlt,
    same,
    topSavingsAlt: savingsAlt.slice(0, 3),
    topSavingsHere: savingsHere.slice(0, 3),
  };

  log('[content_script] Sending catalog summary:', summary);
  chrome.runtime.sendMessage({ action: 'npcCatalogSummary', summary });
}

/** Apply or remove the "show only cheaper here" filter on catalog product divs. */
function applyFilter(hide: boolean) {
  filterActive = hide;

  const match = getRetailerAndRegion(location.hostname);
  if (!match) return;

  let container = document.querySelector(match.retailer.productContainerSelector) as HTMLElement | null;
  if (!container) {
    for (const sel of match.retailer.productContainerFallbackSelectors) {
      container = document.querySelector(sel) as HTMLElement | null;
      if (container) break;
    }
  }
  if (!container) return;

  for (const child of Array.from(container.children) as HTMLElement[]) {
    const verdict = child.dataset.npcVerdict;
    if (!hide) {
      child.style.display = '';
    } else {
      // Only show products that are cheaper (or same price) on the current site
      child.style.display = verdict === 'cheaper-here' || verdict === 'same' ? '' : 'none';
    }
  }
}

chrome.runtime.onMessage.addListener(
  (msg: ScanListingPageMessage & { action: string; hide?: boolean }, _sender, sendResponse) => {
    if (msg.action === 'scanListingPage') {
      log('[content_script] Received scanListingPage message');
      scanPage();
      sendResponse();
      return true;
    }
    if (msg.action === 'npcFilterCatalog') {
      applyFilter(!!msg.hide);
      sendResponse();
      return true;
    }
  }
);

function renderAndInjectVerdict(
  product: { link: string; price: string },
  compareId: string,
  productDiv: HTMLElement,
  resp: { price?: string | number; status?: number },
  siteMeta: ReturnType<typeof getSiteMeta>,
  priceEl: Element | null
) {
  const altUrl = getAlternateUrl(new URL(product.link));

  if (resp && resp.status === 404) {
    const content: VerdictContent = {
      lines: [
        { type: 'text', text: 'Not available on alternate site', style: 'color: orange;' },
        { type: 'link', text: 'View alternate site', href: altUrl },
      ],
    };
    injectVerdict(
      priceEl && priceEl.parentElement ? priceEl.parentElement : productDiv,
      compareId,
      content,
      priceEl
    );
    return;
  }

  if (resp && resp.price !== null && resp.price !== undefined) {
    import('./exchangeRate').then(async ({ getCachedOrFetchRate }) => {
      const { getPriceComparisonVerdict } = await import('./priceUtils');
      const { rate } = await getCachedOrFetchRate();
      const result = await getPriceComparisonVerdict({
        currentPrice: product.price,
        altPrice: resp.price!.toString(),
        isUK: siteMeta.isUK,
        rate,
        hostname: location.hostname,
      });
      const altPriceNum = parseFloat(resp.price!.toString().replace(/[^\d.]/g, ''));
      const altConvertedDisplay = `≈ ${siteMeta.currentCurrency}${result.altPriceConverted.toFixed(2)}`;
      const altHostname = new URL(altUrl).hostname.replace('www.', '');
      const altPriceInfo = `${siteMeta.altFlag} ${siteMeta.altCurrency}${altPriceNum.toFixed(2)} on ${altHostname} (${altConvertedDisplay})`;

      let content: VerdictContent;
      if (Math.abs(result.diff) > 0.01) {
        if (result.diff > 0) {
          // Alternate site is cheaper — nudge user with a CTA
          const saving = `${siteMeta.currentCurrency}${Math.abs(result.diff).toFixed(2)}`;
          content = {
            lines: [
              { type: 'text', text: altPriceInfo, style: 'color: #666;' },
              { type: 'br' },
              {
                type: 'text',
                text: `Save ${saving} (${result.percDiff.toFixed(1)}%) on ${altHostname}`,
                style: 'color: #e67e00; font-weight: bold;',
              },
              { type: 'br' },
              {
                type: 'link',
                text: `Buy on ${altHostname} \u2192`,
                href: altUrl,
                style:
                  'display: inline-block; margin-top: 4px; padding: 4px 10px; background: #e67e00; color: #fff; border-radius: 4px; text-decoration: none; font-size: 0.85em; font-weight: bold;',
              },
            ],
          };
        } else {
          // Current site is cheaper — positive reinforcement
          const saving = `${siteMeta.currentCurrency}${Math.abs(result.diff).toFixed(2)}`;
          content = {
            lines: [
              { type: 'text', text: altPriceInfo, style: 'color: #666;' },
              { type: 'br' },
              {
                type: 'text',
                text: `\u2705 Cheaper here by ${saving} (${result.percDiff.toFixed(1)}%)`,
                style: 'color: #2e7d32;',
              },
            ],
          };
        }
      } else {
        content = {
          lines: [
            { type: 'text', text: altPriceInfo, style: 'color: #666;' },
            { type: 'br' },
            { type: 'text', text: 'Same price on both sites', style: 'color: #888;' },
          ],
        };
      }
      injectVerdict(
        priceEl && priceEl.parentElement ? priceEl.parentElement : productDiv,
        compareId,
        content,
        priceEl
      );
      log(`[content_script] Injected verdict for id=${compareId}, url=${product.link}`);
    });
    return;
  }

  const content: VerdictContent = {
    lines: [{ type: 'text', text: 'Could not fetch alternate price', style: 'color: gray;' }],
  };
  injectVerdict(
    priceEl && priceEl.parentElement ? priceEl.parentElement : productDiv,
    compareId,
    content,
    priceEl
  );
  log(`[content_script] Injected fallback verdict for id=${compareId}, url=${product.link}`);
}
