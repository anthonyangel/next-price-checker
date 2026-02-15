/**
 * Zara price lookup provider.
 *
 * Zara has no public product API. Since the extension runs as a Chrome
 * extension with host_permissions for www.zara.com, the service worker's
 * fetch() sends browser-like requests. We fetch the product page HTML
 * and parse the price from the markup.
 */

import { log, warn } from '../logger';
import type { RetailerSite } from '../core/AbstractRetailer';

/**
 * Look up a Zara product's price by fetching its product page HTML.
 *
 * Uses `credentials: 'include'` so the service worker sends the browser's
 * Zara cookies (including Akamai bot-verification tokens). If Zara returns
 * 410 (region mismatch from the country-selector popup setting region
 * cookies), retries with `credentials: 'omit'` to bypass the region lock.
 *
 * @param pid Zara product ID (8+ digit number)
 * @param regionId The target region (e.g. 'uk' or 'il')
 * @param sites The retailer's site config (needed for pathPrefix)
 * @param productUrl Optional full product URL (with slug). Preferred over
 *   constructing a slug-less URL, which Zara may reject.
 * @returns The price as a number, or null if not found
 */
export async function lookupPrice(
  pid: string,
  regionId: string,
  sites: Record<string, RetailerSite>,
  productUrl?: string
): Promise<number | null> {
  const site = sites[regionId];
  if (!site) return null;

  // Prefer the full product URL (with slug) when available.
  // Fall back to a constructed slug-less URL for catalog bulk lookups.
  const prefix = site.pathPrefix ?? '';
  const url = productUrl ?? `https://www.zara.com${prefix}/en/-p${pid}.html`;

  try {
    // First try with cookies — needed for Akamai bot-verification tokens.
    // If Zara returns 410 (region mismatch — cookies say "UK" but URL is /il/
    // or vice versa, caused by the country-selector popup), retry without
    // cookies to bypass the region lock.
    let resp = await fetch(url, { credentials: 'include' });

    if (resp.status === 410) {
      log(`[zara] 410 with cookies for pid=${pid}, region=${regionId} — retrying without cookies`);
      resp = await fetch(url, { credentials: 'omit' });
    }

    if (!resp.ok) {
      warn(`[zara] HTTP ${resp.status} for pid=${pid}, region=${regionId}`);
      return null;
    }

    // Detect redirects to homepage (slug-less URLs may redirect instead of 404)
    if (resp.redirected && resp.url) {
      const finalPath = new URL(resp.url).pathname;
      if (!finalPath.includes('-p') || finalPath.endsWith('/en/') || finalPath === '/') {
        warn(`[zara] Redirected to non-product page for pid=${pid}: ${resp.url}`);
        return null;
      }
    }

    const html = await resp.text();

    // Detect Akamai bot challenge pages — they contain bm-verify tokens
    // instead of actual product content.
    if (html.includes('bm-verify') || html.includes('triggerInterstitialChallenge')) {
      warn(`[zara] Got Akamai bot challenge for pid=${pid}, region=${regionId}`);
      return null;
    }

    return parsePriceFromHtml(html, pid);
  } catch (err) {
    warn('[zara] Fetch error:', err);
    return null;
  }
}

/**
 * Fetch an alternate catalog page and parse data-productid → price pairs.
 * Zara's server-rendered HTML includes product cards with data-productid
 * attributes and money-amount__main price spans.
 *
 * @returns A map of data-productid → numeric price
 */
export async function lookupCatalogPrices(catalogUrl: string): Promise<Record<string, number>> {
  try {
    let resp = await fetch(catalogUrl, { credentials: 'include' });

    if (resp.status === 410) {
      log(`[zara] Catalog 410 with cookies — retrying without cookies`);
      resp = await fetch(catalogUrl, { credentials: 'omit' });
    }

    if (!resp.ok) {
      warn(`[zara] Catalog HTTP ${resp.status} for ${catalogUrl}`);
      return {};
    }

    const html = await resp.text();

    if (html.includes('bm-verify') || html.includes('triggerInterstitialChallenge')) {
      warn(`[zara] Got Akamai bot challenge for catalog`);
      return {};
    }

    return parseCatalogHtml(html);
  } catch (err) {
    warn('[zara] Catalog fetch error:', err);
    return {};
  }
}

/**
 * Parse catalog page HTML to extract URL-ref → price mappings.
 *
 * Zara's `data-productid` is region-specific (the same dress has a different
 * 9-digit ID on zara.com/uk vs zara.com/il). To match across regions we
 * prefer the 8-digit URL reference extracted from:
 *   1. `data-productkey` attribute  (e.g. "522701238-05029119068-p" → "05029119")
 *   2. product link href            (e.g. "…-p05029119.html" → "05029119")
 *
 * Falls back to `data-productid` when neither is available.
 * Each price is keyed by BOTH the URL ref and the internal ID so lookups
 * succeed regardless of which PID format the caller uses.
 */
export function parseCatalogHtml(html: string): Record<string, number> {
  const results: Record<string, number> = {};

  const pidPattern = /data-productid="(\d+)"/g;
  let pidMatch: RegExpExecArray | null;

  while ((pidMatch = pidPattern.exec(html)) !== null) {
    const internalId = pidMatch[1];

    // Slice from this product card to the next (or end of HTML)
    const savedIdx = pidPattern.lastIndex;
    const nextMatch = pidPattern.exec(html);
    const cardEnd = nextMatch ? nextMatch.index : html.length;
    pidPattern.lastIndex = savedIdx; // restore so outer loop advances normally
    const cardHtml = html.slice(pidMatch.index, cardEnd);

    // Extract price from this card
    const priceMatch = cardHtml.match(/money-amount__main[^>]*>([\s\S]*?)<\/span>/);
    if (!priceMatch) continue;
    const priceText = priceMatch[1].replace(/[^\d.]/g, '');
    const price = parseFloat(priceText);
    if (isNaN(price) || price <= 0) continue;

    // Try to extract 8-digit URL ref from data-productkey
    let urlRef: string | null = null;
    const keyMatch = cardHtml.match(/data-productkey="\d+-(\d{8})\d*-p"/);
    if (keyMatch) {
      urlRef = keyMatch[1];
    }

    // Fallback: extract from product link href (…-p05029119.html)
    if (!urlRef) {
      const hrefMatch = cardHtml.match(/href="[^"]*-p(\d{8,})\.html/);
      if (hrefMatch) {
        urlRef = hrefMatch[1].length >= 8 ? hrefMatch[1].slice(0, 8) : null;
      }
    }

    // Key by URL ref (cross-region) and internal ID (same-region backup)
    if (urlRef && !(urlRef in results)) results[urlRef] = price;
    if (!(internalId in results)) results[internalId] = price;
  }

  log(`[zara] Catalog parse: ${Object.keys(results).length} PID→price pairs`);
  return results;
}

/**
 * Parse the product price from Zara page HTML.
 * Looks for the `money-amount__main` span used across Zara's product pages.
 */
export function parsePriceFromHtml(html: string, pid: string): number | null {
  // Primary: <span class="money-amount__main">29.99</span>
  const match = html.match(/money-amount__main[^>]*>([\s\S]*?)<\/span>/);
  if (!match) {
    log(`[zara] No price element found for pid=${pid}`);
    return null;
  }

  const priceText = match[1].replace(/[^\d.]/g, '');
  const price = parseFloat(priceText);
  if (isNaN(price)) {
    log(`[zara] Could not parse price text "${match[1]}" for pid=${pid}`);
    return null;
  }

  log(`[zara] pid=${pid} -> price=${price}`);
  return price;
}
