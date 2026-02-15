/**
 * Background service worker — handles alternate price lookups.
 *
 * Primary strategy: Bloomreach Discovery API (fast JSON fetch, no tabs).
 * The API credentials are hardcoded per retailer; if they expire,
 * the module falls back to scraping fresh keys from the homepage.
 */

import { log, error } from './logger';
import { getRetailerAndRegion } from './core/registry';
import type { AlternatePriceMessage, AlternateCatalogMessage } from './types';

log('[background.ts] loaded');

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
  (msg: AlternatePriceMessage | AlternateCatalogMessage, _sender, sendResponse) => {
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
          (sendResponse as (r?: unknown) => void)({ price });
        } catch (err) {
          error('[background] Error in getAlternatePrice:', err);
          (sendResponse as (r?: unknown) => void)({
            error: err?.toString?.() || 'Unknown error',
          });
        }
      })();
      return true;
    }
  }
);
