/**
 * Background service worker — handles alternate price lookups.
 *
 * Primary strategy: Bloomreach Discovery API (fast JSON fetch, no tabs).
 * The API credentials are hardcoded per retailer; if they expire,
 * the module falls back to scraping fresh keys from the homepage.
 */

import { log, warn, error } from './logger';
import { getRetailerAndRegion } from './core/registry';
import type { AlternatePriceMessage, AlternateCatalogMessage, ScrapeViaTabMessage } from './types';

log('[background.ts] loaded');

/** Clear stale price cache on extension install/update. */
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(undefined, (all) => {
    const staleKeys = Object.keys(all).filter((k) => k.startsWith('npc:price:'));
    if (staleKeys.length > 0) {
      chrome.storage.local.remove(staleKeys);
      log(`[background] Cleared ${staleKeys.length} cached price entries on install/update`);
    }
  });
});

/**
 * Given an alternate-site URL, resolve the retailer, region, and product ID.
 */
function resolveProduct(url: string) {
  const parsed = new URL(url);
  const match = getRetailerAndRegion(parsed);
  if (!match) return null;
  const { retailer, regionId } = match;
  const pid = retailer.extractProductId(parsed);
  if (!pid) return null;
  return { retailer, regionId, pid };
}

chrome.runtime.onMessage.addListener(
  (
    msg: AlternatePriceMessage | AlternateCatalogMessage | ScrapeViaTabMessage,
    _sender,
    sendResponse
  ) => {
    /**
     * Bulk catalog lookup — resolves all URLs via API in parallel.
     */
    if (msg.action === 'getAlternateCatalogPrices') {
      (async () => {
        try {
          const { urls, catalogUrl } = msg;
          // Build pid→url mapping, capture retailer and region
          const pidToUrl: Record<string, string> = {};
          let regionId: string | null = null;
          let retailer: NonNullable<ReturnType<typeof resolveProduct>>['retailer'] | null = null;

          // If catalogUrl is provided (SPA retailers), resolve retailer/region
          // from it and use the URLs array entries as PID keys directly.
          if (catalogUrl) {
            const parsed = new URL(catalogUrl);
            const match = getRetailerAndRegion(parsed);
            if (match) {
              retailer = match.retailer;
              regionId = match.regionId;
              // For SPA retailers, urls are constructed from data-productid
              // and contain PIDs that extractProductId can find — or we can
              // just extract the PID from the path directly.
              for (const url of urls) {
                try {
                  const pid = match.retailer.extractProductId(new URL(url));
                  if (pid) pidToUrl[pid] = url;
                } catch {
                  // For SPA URLs like -p507084855.html, extractProductId works
                  // because it matches \d{8,}. Use URL basename as fallback.
                  const m = url.match(/-p(\d+)\.html/);
                  if (m) pidToUrl[m[1]] = url;
                }
              }
            }
          } else {
            // Standard approach: resolve retailer/region/pid from each URL
            for (const url of urls) {
              const resolved = resolveProduct(url);
              if (resolved) {
                pidToUrl[resolved.pid] = url;
                regionId = resolved.regionId;
                retailer = resolved.retailer;
              }
            }
          }

          if (!regionId || !retailer || Object.keys(pidToUrl).length === 0) {
            (sendResponse as (r?: unknown) => void)({});
            return;
          }

          const pids = Object.keys(pidToUrl);
          log(`[background] Catalog lookup: ${pids.length} PIDs for region=${regionId}`);
          const priceMap = await retailer.lookupPrices(pids, regionId, pidToUrl, catalogUrl);

          // Map back to URL→price
          const result: Record<string, { price: number }> = {};
          for (const [pid, price] of Object.entries(priceMap)) {
            const url = pidToUrl[pid];
            if (url) result[url] = { price };
          }

          log(`[background] Catalog lookup returned ${Object.keys(result).length} prices`);
          (sendResponse as (r?: unknown) => void)(result);
        } catch (err) {
          error('[background] Error in getAlternateCatalogPrices:', err);
          (sendResponse as (r?: unknown) => void)({});
        }
      })();
      return true;
    }

    /**
     * Single product lookup via API.
     *
     * Falls back to a tab-based scrape (same mechanism catalog pages use)
     * when the API misses the product and a direct fetch is blocked by
     * bot protection — otherwise single-product pages report "not found"
     * for anything the API doesn't index (e.g. sale/clearance items),
     * even though a real browser tab can see the price fine.
     */
    if (msg.action === 'getAlternatePrice') {
      (async () => {
        try {
          const { url } = msg;
          const resolved = resolveProduct(url);

          if (!resolved) {
            log(`[background] Could not resolve product for ${url}`);
            (sendResponse as (r?: unknown) => void)({ price: null });
            return;
          }

          const { retailer, regionId, pid } = resolved;
          const price = await retailer.lookupPrice(pid, regionId, url);
          if (price !== null) {
            (sendResponse as (r?: unknown) => void)({ price });
            return;
          }

          log(`[background] API miss for ${url}, trying tab-based scrape`);
          // Let the popup (if open) disclose that a background tab is about
          // to visit the alternate site — this isn't a silent side effect.
          chrome.runtime.sendMessage({ action: 'npcTabScrapeStatus', count: 1 }).catch(() => {});
          const tabResults = await scrapeUrlsViaTab([url]);
          (sendResponse as (r?: unknown) => void)({ price: tabResults[url] ?? null });
        } catch (err) {
          error('[background] Error in getAlternatePrice:', err);
          (sendResponse as (r?: unknown) => void)({
            error: err?.toString?.() || 'Unknown error',
          });
        }
      })();
      return true;
    }

    /**
     * Tab-based scraper — opens a real browser tab to fetch product pages
     * that the API and service worker fetch both miss (sale/clearance items
     * blocked by bot protection).
     *
     * Flow: create a background tab → navigate to the alternate domain →
     * inject a script that fetches each product URL same-origin → parse
     * JSON-LD prices → close tab → return results.
     */
    if (msg.action === 'scrapeViaTab') {
      (async () => {
        const { urls } = msg;
        const results = await scrapeUrlsViaTab(urls);
        (sendResponse as (r?: unknown) => void)(results);
      })();
      return true;
    }
  }
);

/**
 * Open a background browser tab to scrape product prices — bypasses both
 * CORS (content script limitation) and bot protection (service worker
 * fetch limitation) since it's a real browser context. Used both for the
 * catalog-page bulk fallback and the single-product-page fallback.
 */
async function scrapeUrlsViaTab(urls: string[]): Promise<Record<string, number | null>> {
  const results: Record<string, number | null> = {};
  if (!urls || urls.length === 0) {
    return results;
  }

  let tabId: number | undefined;
  try {
    // Navigate to the first product URL directly — this is more
    // natural than the domain root and less likely to trigger bot
    // protection. It also lets us extract the first price from DOM.
    const firstUrl = urls[0];
    const tab = await chrome.tabs.create({ url: firstUrl, active: false });
    tabId = tab.id;
    if (!tabId) throw new Error('Failed to create tab');

    log(`[background] Tab scraper: created tab ${tabId} → ${firstUrl}`);

    // Wait for the tab's first navigation to finish. Note this typically
    // lands on Akamai's bot-check interstitial, not the real page — see
    // waitForRealPage below.
    await waitForTabComplete(tabId, 20_000);

    // The interstitial self-resolves (background XHR → location.reload)
    // a few seconds later; poll until real content replaces it, or bail
    // out on a terminal block / timeout.
    const state = await waitForRealPage(tabId, 15_000);
    if (state !== 'ready') {
      warn(`[background] Tab scraper: gave up waiting for real page (${state})`);
      return results;
    }

    log(`[background] Tab scraper: tab loaded, scraping ${urls.length} URLs`);

    // Inject a self-contained script that:
    // 1. Extracts the first price from the loaded page's DOM
    // 2. Fetches remaining URLs same-origin with delays
    const execResults = (await (chrome.scripting.executeScript as Function)({
      target: { tabId },
      func: injectedFetchAndParsePrices,
      args: [urls],
    })) as Array<{ result: Record<string, number | null> }>;

    const scraped = execResults?.[0]?.result;
    if (scraped) {
      Object.assign(results, scraped);
    }

    const found = Object.values(results).filter((v) => v !== null).length;
    log(`[background] Tab scraper: ${found}/${urls.length} prices found`);
  } catch (err) {
    warn('[background] Tab scraper error:', err);
  } finally {
    if (tabId) {
      chrome.tabs.remove(tabId).catch(() => {});
    }
  }

  return results;
}

/**
 * Wait for a tab to reach the "complete" loading status.
 * Resolves when complete or rejects on timeout.
 */
function waitForTabComplete(tabId: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error(`Tab ${tabId} load timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    function listener(updatedTabId: number, changeInfo: { status?: string }) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);

    // Check if already complete (race condition: tab loaded before listener attached)
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
}

/**
 * Poll the tab until it's past Akamai's bot-check interstitial, or give up.
 *
 * Next's Akamai Bot Manager serves a JS-challenge page (HTTP 200, marked by
 * `#sec-if-cpt-container` and an empty <title>) that self-resolves via a
 * background XHR + `location.reload(true)` a few seconds later — Chrome's
 * tab "complete" status fires on *this* interstitial load, not the real
 * page, so scraping immediately after it returns nothing. Poll instead of
 * trusting the first "complete" event.
 */
async function waitForRealPage(
  tabId: number,
  timeoutMs: number
): Promise<'ready' | 'blocked' | 'timeout'> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await checkTabState(tabId);
    if (state === 'blocked') return 'blocked';
    if (state === 'ready') return 'ready';
    await new Promise((r) => setTimeout(r, 500));
  }
  return 'timeout';
}

/** Inspect the tab's current DOM: terminal block, still-challenging, or real content. */
async function checkTabState(tabId: number): Promise<'ready' | 'blocked' | 'challenge'> {
  try {
    const results = (await (chrome.scripting.executeScript as Function)({
      target: { tabId },
      func: () => {
        const title = document.title.toLowerCase();
        const body = document.body?.innerText?.slice(0, 500).toLowerCase() ?? '';
        const blocked =
          title.includes('access denied') ||
          body.includes('access denied') ||
          body.includes("don't have permission");
        if (blocked) return 'blocked';

        // Akamai Bot Manager's sensor/challenge interstitial — still resolving.
        const stillChallenging =
          !!document.getElementById('sec-if-cpt-container') ||
          body.includes('powered and protected by');
        return stillChallenging ? 'challenge' : 'ready';
      },
    })) as Array<{ result: 'ready' | 'blocked' | 'challenge' }>;
    return results?.[0]?.result ?? 'ready';
  } catch {
    return 'ready';
  }
}

/**
 * Injected into a browser tab via chrome.scripting.executeScript.
 * Fetches each product URL same-origin and extracts the price from JSON-LD.
 * Must be self-contained — cannot reference external modules.
 */
async function injectedFetchAndParsePrices(urls: string[]): Promise<Record<string, number | null>> {
  const results: Record<string, number | null> = {};

  /** Extract JSON-LD Product price from raw HTML string. */
  function extractJsonLdPrice(html: string): number | null {
    const jsonLdRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = jsonLdRe.exec(html)) !== null) {
      try {
        const data = JSON.parse(m[1]);
        if (data?.['@type'] === 'Product' && data?.offers) {
          const offers = Array.isArray(data.offers) ? data.offers[0] : data.offers;
          const raw = offers?.lowPrice ?? offers?.price;
          if (raw !== undefined && raw !== null) {
            const num = typeof raw === 'number' ? raw : parseFloat(String(raw));
            if (!isNaN(num) && num > 0) return num;
          }
        }
      } catch {
        // skip malformed JSON
      }
    }
    return null;
  }

  // Step 1: Extract the first URL's price directly from the loaded page's
  // DOM — this avoids an extra network request since we navigated here.
  if (urls.length > 0) {
    const firstUrl = urls[0];
    try {
      const currentPath = window.location.pathname;
      const targetPath = new URL(firstUrl).pathname;
      if (currentPath === targetPath) {
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (const script of Array.from(scripts)) {
          try {
            const data = JSON.parse(script.textContent ?? '');
            if (data?.['@type'] === 'Product' && data?.offers) {
              const offers = Array.isArray(data.offers) ? data.offers[0] : data.offers;
              const raw = offers?.lowPrice ?? offers?.price;
              if (raw !== undefined && raw !== null) {
                const num = typeof raw === 'number' ? raw : parseFloat(String(raw));
                if (!isNaN(num) && num > 0) {
                  results[firstUrl] = num;
                  break;
                }
              }
            }
          } catch {
            // skip
          }
        }
      }
    } catch {
      // URL parsing error, skip DOM extraction
    }
  }

  // Step 2: Fetch remaining URLs via same-origin fetch with small batches
  // and delays between them to avoid triggering rate limits.
  const BATCH = 3;
  const DELAY_MS = 300;
  const remaining = urls.filter((u) => !(u in results));

  for (let i = 0; i < remaining.length; i += BATCH) {
    // Add delay between batches (not before the first batch)
    if (i > 0) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }

    const batch = remaining.slice(i, i + BATCH);
    const settled = await Promise.allSettled(
      batch.map(async (url) => {
        try {
          // Try without cookies first; only send session credentials if the
          // site actually needs them (mirrors providers/zara.ts and hm.ts).
          let resp = await fetch(url, { credentials: 'omit' });
          if (resp.status === 403 || resp.status === 410) {
            resp = await fetch(url, { credentials: 'include' });
          }
          if (!resp.ok) return { url, price: null as number | null };
          const html = await resp.text();
          if (html.length < 500) return { url, price: null as number | null };
          return { url, price: extractJsonLdPrice(html) };
        } catch {
          return { url, price: null as number | null };
        }
      })
    );

    for (const r of settled) {
      if (r.status === 'fulfilled') {
        results[r.value.url] = r.value.price;
      }
    }
  }

  return results;
}
