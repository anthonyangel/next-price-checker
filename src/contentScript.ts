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

/** Check if an element's text looks like a struck-through original price (e.g. "Was ₪133"). */
function isOriginalPrice(el: HTMLElement): boolean {
  return /^was\b/i.test(el.textContent?.trim() ?? '');
}

/** Look up the price element within a product div using retailer selectors. */
function findPriceEl(
  div: HTMLElement,
  priceSelector: string,
  fallbacks: string[]
): HTMLElement | null {
  let el = div.querySelector(priceSelector) as HTMLElement | null;
  if (el && isOriginalPrice(el)) el = null;
  if (!el) {
    for (const sel of fallbacks) {
      // querySelectorAll so we can skip "Was" price elements
      for (const candidate of Array.from(div.querySelectorAll(sel))) {
        const text = (candidate as HTMLElement).textContent?.trim() ?? '';
        if (text && /\d/.test(text) && !isOriginalPrice(candidate as HTMLElement)) {
          el = candidate as HTMLElement;
          break;
        }
      }
      if (el) break;
    }
  }
  return el;
}

let scanInProgress = false;
let filterActive = false;

/**
 * Core scan logic — extracts products from the page, sends them to the popup,
 * and fetches alternate prices via the Bloomreach API (through background).
 */
async function scanPage() {
  if (scanInProgress) {
    log('[content_script] scanPage already in progress, skipping');
    return;
  }
  scanInProgress = true;
  try {
    const pageUrl = new URL(location.href);
    const retailerMatch = getRetailerAndRegion(pageUrl);
    if (!retailerMatch) {
      warn('[content_script] No retailer found for', location.hostname);
      return;
    }
    const { retailer } = retailerMatch;

    let products: Array<{ link: string; price: string }> = [];

    let productContainer = document.querySelector(
      retailer.productContainerSelector
    ) as HTMLElement | null;
    if (!productContainer) {
      for (const sel of retailer.productContainerFallbackSelectors) {
        productContainer = document.querySelector(sel) as HTMLElement | null;
        if (productContainer) break;
      }
    }

    const isCatalog = retailer.isCatalogPage(pageUrl);

    if (productContainer && isCatalog) {
      const productDivs = Array.from(productContainer.children);
      products = productDivs.map((div) => {
        const anchor = div.querySelector('a[href]') as HTMLAnchorElement | null;
        let priceEl = div.querySelector(retailer.priceSelector) as HTMLElement | null;
        // Skip if main selector matched a "Was" (original) price on sale items
        if (priceEl && isOriginalPrice(priceEl)) priceEl = null;
        if (!priceEl) {
          for (const sel of retailer.catalogPriceFallbackSelectors) {
            // querySelectorAll so we can skip "Was" price elements
            for (const candidate of Array.from(div.querySelectorAll(sel))) {
              const text = (candidate as HTMLElement).textContent?.trim() ?? '';
              if (text && /\d/.test(text) && !isOriginalPrice(candidate as HTMLElement)) {
                priceEl = candidate as HTMLElement;
                break;
              }
            }
            if (priceEl) break;
          }
        }
        const link = anchor?.href ?? 'N/A';
        const price = priceEl?.textContent?.trim() ?? 'N/A';
        return { link, price };
      });
    } else {
      log(`[content_script] No product container found, trying single-product extraction`);
      const priceEl = document.querySelector(retailer.priceSelector) as HTMLElement | null;
      const priceText = priceEl?.textContent?.trim() ?? '';
      // Validate: price text must contain at least one digit to be a real price
      if (priceText && /\d/.test(priceText)) {
        log(`[content_script] Found price via CSS selector: ${priceText}`);
        products = [{ link: window.location.href, price: priceText }];
      } else {
        // Fallback: try structured data extraction (e.g. JSON-LD, __NEXT_DATA__)
        log(
          `[content_script] CSS selector "${retailer.priceSelector}" ${priceText ? `returned "${priceText}" (no digits)` : 'missed'}, trying extractPriceFromPage`
        );
        const fallbackPrice = retailer.extractPriceFromPage(pageUrl);
        if (fallbackPrice) {
          log(`[content_script] extractPriceFromPage returned: ${fallbackPrice}`);
          products = [{ link: window.location.href, price: fallbackPrice }];
        } else {
          log(`[content_script] extractPriceFromPage returned null — no price found`);
          products = [];
        }
      }
    }

    win._nextPriceCheckerProducts = products;
    log(`[content_script] Sending npcProducts: ${products.length} product(s)`);
    chrome.runtime.sendMessage({ action: 'npcProducts', products });

    // --- Catalog page: bulk fetch all alternate prices in one message ---
    if (products.length > 1 && productContainer) {
      const siteMeta = getSiteMeta(pageUrl);
      const container = productContainer; // capture for closure

      // Determine current and alternate region
      const currentRegionId = retailerMatch.regionId;
      const altRegionId = retailer.getAlternateRegionId(currentRegionId);

      // Pre-compute the alternate catalog URL (cheap string transform).
      // Only actually used for SPA retailers (when DOM fallback is needed).
      let altCatalogUrl: string | undefined;
      if (altRegionId) {
        try {
          altCatalogUrl = retailer.transformUrl(pageUrl, currentRegionId, altRegionId);
        } catch {
          // not fatal
        }
      }

      // Build metadata for each product, check cache
      const uncachedUrls: string[] = [];
      // Whether constructed product URLs are usable for buy-links and individual lookups.
      // When false (e.g. Zara SPA), we use the catalog URL instead.
      const urlsAreValid = retailer.constructedUrlsAreValid;
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
          // No valid href — try DOM-based extraction (SPA retailers like Zara)
        }

        // Fallback: extract PID from DOM element data attributes
        if (!pid) {
          const productDiv = container.children[i] as HTMLElement | undefined;
          if (productDiv) {
            pid = retailer.extractProductIdFromElement(productDiv);
            if (pid && altRegionId) {
              altUrl = retailer.constructProductUrl(pid, altRegionId);
              // tracked via retailer.constructedUrlsAreValid
            }
          }
        }

        const domId = productDomId(pid ?? product.link);
        const compareId = `npc-price-compare-${domId}`;
        productMeta.push({ product, altUrl, pid, idx: i, compareId });

        if (!altUrl || !pid) continue;

        // Cache current page price for this product
        if (currentRegionId) {
          const currentPrice = parsePrice(product.price);
          if (currentPrice !== null) {
            setCachedPrice(retailer.id, pid, currentRegionId, currentPrice);
          }
        }

        // Check persistent cache for alternate price
        if (altRegionId) {
          const cached = await getCachedPrice(retailer.id, pid, altRegionId);
          if (cached) {
            log(`[content_script] Cache HIT for ${pid}:${altRegionId}`);
            resolvedAltPrices.set(pid, cached.price);
            const productDiv = container.children[i] as HTMLElement | undefined;
            if (productDiv) {
              // When constructed URLs aren't valid, link to catalog page instead
              const buyLink = !urlsAreValid && altCatalogUrl ? altCatalogUrl : altUrl;
              const cachedPriceEl = findPriceEl(
                productDiv,
                retailer.priceSelector,
                retailer.catalogPriceFallbackSelectors
              );
              renderAndInjectVerdict(
                product,
                compareId,
                productDiv,
                { price: cached.price },
                siteMeta,
                buyLink,
                cachedPriceEl
              );
            }
            continue;
          }
        }

        uncachedUrls.push(altUrl);
      }

      // Inject loading indicators on uncached products before fetching
      for (const meta of productMeta) {
        if (!meta.altUrl || !uncachedUrls.includes(meta.altUrl)) continue;
        const productDiv = container.children[meta.idx] as HTMLElement | undefined;
        if (!productDiv) continue;
        const loadPriceEl = findPriceEl(
          productDiv,
          retailer.priceSelector,
          retailer.catalogPriceFallbackSelectors
        );
        const loadParent =
          loadPriceEl?.parentElement instanceof HTMLElement
            ? loadPriceEl.parentElement
            : productDiv;
        const loadingContent: VerdictContent = {
          lines: [
            {
              type: 'text',
              text: 'Checking alternate price...',
              style: 'color: #888; font-weight: normal; font-style: italic;',
            },
          ],
        };
        injectVerdict(loadParent, meta.compareId, loadingContent, loadPriceEl);
      }

      // Fetch all uncached prices in one bulk message
      if (uncachedUrls.length > 0) {
        log(`[content_script] Bulk API fetch: ${uncachedUrls.length} products`);

        // Track items the API couldn't find for content-script fallback
        const apiMissedItems: typeof productMeta = [];

        try {
          const catalogResp: Record<string, { price: number }> = await chrome.runtime.sendMessage({
            action: 'getAlternateCatalogPrices',
            urls: uncachedUrls,
            // Send catalogUrl when constructed URLs aren't valid product pages
            // (SPA retailers like Zara). Non-SPA retailers use individual lookups.
            catalogUrl: !urlsAreValid ? altCatalogUrl : undefined,
          });

          for (const meta of productMeta) {
            if (!meta.altUrl) continue;
            const resp = catalogResp[meta.altUrl];
            const productDiv = container.children[meta.idx] as HTMLElement | undefined;
            if (!productDiv) continue;

            // For buy links: use the real alternate URL when available.
            // For SPA retailers where constructed URLs don't work,
            // link to the alternate catalog page instead.
            const buyLink = !urlsAreValid && altCatalogUrl ? altCatalogUrl : meta.altUrl;
            const respPriceEl = findPriceEl(
              productDiv,
              retailer.priceSelector,
              retailer.catalogPriceFallbackSelectors
            );

            if (resp?.price != null) {
              // Cache alternate price and render
              if (meta.pid && altRegionId) {
                setCachedPrice(retailer.id, meta.pid, altRegionId, resp.price);
                resolvedAltPrices.set(meta.pid, resp.price);
              }
              renderAndInjectVerdict(
                meta.product,
                meta.compareId,
                productDiv,
                resp,
                siteMeta,
                buyLink,
                respPriceEl
              );
            } else if (uncachedUrls.includes(meta.altUrl)) {
              // API miss — collect for content-script fallback fetch
              apiMissedItems.push(meta);
            }
          }
        } catch (e) {
          warn('[content_script] Bulk catalog fetch failed:', e);
        }

        // Tab-based fallback: for items the API missed (e.g. sale/clearance
        // items not in Bloomreach), ask the background to open a browser tab
        // on the alternate domain and scrape prices via same-origin fetch.
        // This bypasses both CORS (content script limitation) and bot protection
        // (service worker limitation) since it's a real browser context.
        if (apiMissedItems.length > 0 && urlsAreValid) {
          log(
            `[content_script] API missed ${apiMissedItems.length} products, trying tab-based scrape`
          );
          const missedUrls = apiMissedItems
            .map((m) => m.altUrl)
            .filter((u): u is string => u != null);

          try {
            const tabResp: Record<string, number | null> =
              await chrome.runtime.sendMessage({
                action: 'scrapeViaTab',
                urls: missedUrls,
              });

            for (const meta of apiMissedItems) {
              if (!meta.altUrl) continue;
              const price = tabResp?.[meta.altUrl] ?? null;
              const productDiv = container.children[meta.idx] as HTMLElement | undefined;
              if (!productDiv) continue;
              const buyLink = !urlsAreValid && altCatalogUrl ? altCatalogUrl : meta.altUrl;
              const fbPriceEl = findPriceEl(
                productDiv,
                retailer.priceSelector,
                retailer.catalogPriceFallbackSelectors
              );

              if (price !== null) {
                if (meta.pid && altRegionId) {
                  setCachedPrice(retailer.id, meta.pid, altRegionId, price);
                  resolvedAltPrices.set(meta.pid, price);
                }
                renderAndInjectVerdict(
                  meta.product,
                  meta.compareId,
                  productDiv,
                  { price },
                  siteMeta,
                  buyLink,
                  fbPriceEl
                );
              } else {
                renderAndInjectVerdict(
                  meta.product,
                  meta.compareId,
                  productDiv,
                  {},
                  siteMeta,
                  buyLink,
                  fbPriceEl
                );
              }
            }
          } catch (e) {
            warn('[content_script] Tab-based scrape failed:', e);
            // Render "not found" for all missed items
            for (const meta of apiMissedItems) {
              if (!meta.altUrl) continue;
              const productDiv = container.children[meta.idx] as HTMLElement | undefined;
              if (!productDiv) continue;
              const buyLink = !urlsAreValid && altCatalogUrl ? altCatalogUrl : meta.altUrl;
              const fbPriceEl = findPriceEl(
                productDiv,
                retailer.priceSelector,
                retailer.catalogPriceFallbackSelectors
              );
              renderAndInjectVerdict(
                meta.product, meta.compareId, productDiv, {},
                siteMeta, buyLink, fbPriceEl
              );
            }
          }
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

  const match = getRetailerAndRegion(new URL(location.href));
  if (!match) return;

  let container = document.querySelector(
    match.retailer.productContainerSelector
  ) as HTMLElement | null;
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
      return false;
    }
    if (msg.action === 'npcFilterCatalog') {
      applyFilter(!!msg.hide);
      sendResponse();
      return false;
    }
  }
);

function renderAndInjectVerdict(
  product: { link: string; price: string },
  compareId: string,
  productDiv: HTMLElement,
  resp: { price?: string | number; status?: number },
  siteMeta: ReturnType<typeof getSiteMeta>,
  altUrl?: string | null,
  priceEl?: HTMLElement | null
) {
  // Position verdict near the price element (matching pre-refactoring behavior).
  // Use priceEl.parentElement as injection parent so the verdict sits inside the
  // same wrapper as the price, right after it. Fall back to productDiv.
  const verdictParent =
    priceEl?.parentElement instanceof HTMLElement ? priceEl.parentElement : productDiv;
  // Use provided altUrl, or compute from product link as fallback
  if (!altUrl) {
    try {
      altUrl = getAlternateUrl(new URL(product.link));
    } catch {
      altUrl = '';
    }
  }

  if (resp && resp.status === 404) {
    const content: VerdictContent = {
      lines: [
        { type: 'text', text: 'Not available on alternate site', style: 'color: orange;' },
        { type: 'link', text: 'View alternate site', href: altUrl },
      ],
    };
    injectVerdict(verdictParent, compareId, content, priceEl);
    return;
  }

  if (resp && resp.price !== null && resp.price !== undefined) {
    import('./exchangeRate').then(async ({ getCachedOrFetchRate }) => {
      const { getPriceComparisonVerdict } = await import('./priceUtils');
      const { rate } = await getCachedOrFetchRate();
      const currentPriceNum = parsePrice(product.price);
      const altPriceNum = parseFloat(resp.price!.toString().replace(/[^\d.]/g, ''));
      const altSiteName = siteMeta.altSiteName;

      // If current price is unknown, show just the alternate price without comparison
      if (currentPriceNum === null) {
        const content: VerdictContent = {
          lines: [
            {
              type: 'text',
              text: `${siteMeta.altFlag} ${siteMeta.altCurrency}${altPriceNum.toFixed(2)} on ${altSiteName}`,
              style: 'color: #666;',
            },
            { type: 'br' },
            {
              type: 'link',
              text: `View on ${altSiteName} \u2192`,
              href: altUrl,
              style: 'color: #1976d2; text-decoration: underline; font-size: 0.9em;',
            },
          ],
        };
        injectVerdict(verdictParent, compareId, content, priceEl);
        log(`[content_script] Injected alt-price-only verdict for id=${compareId}`);
        return;
      }

      const result = await getPriceComparisonVerdict({
        currentPrice: product.price,
        altPrice: resp.price!.toString(),
        isUK: siteMeta.isUK,
        rate,
        url: new URL(location.href),
      });
      const altConvertedDisplay = `≈ ${siteMeta.currentCurrency}${result.altPriceConverted.toFixed(2)}`;
      const altPriceInfo = `${siteMeta.altFlag} ${siteMeta.altCurrency}${altPriceNum.toFixed(2)} on ${altSiteName} (${altConvertedDisplay})`;

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
                text: `Save ${saving} (${result.percDiff.toFixed(1)}%) on ${altSiteName}`,
                style: 'color: #e67e00; font-weight: bold;',
              },
              { type: 'br' },
              {
                type: 'link',
                text: `Buy on ${altSiteName} \u2192`,
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
      injectVerdict(verdictParent, compareId, content, priceEl);
      log(`[content_script] Injected verdict for id=${compareId}, url=${product.link}`);
    });
    return;
  }

  const content: VerdictContent = {
    lines: [
      { type: 'text', text: 'Not found on alternate site', style: 'color: #b26a00;' },
      { type: 'br' },
      {
        type: 'link',
        text: 'Check manually \u2192',
        href: altUrl,
        style: 'color: #1976d2; text-decoration: underline; font-size: 0.9em;',
      },
    ],
  };
  injectVerdict(verdictParent, compareId, content, priceEl);
  log(`[content_script] Injected not-found verdict for id=${compareId}, url=${product.link}`);
}
