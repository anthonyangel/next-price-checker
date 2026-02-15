/**
 * H&M price lookup provider.
 *
 * H&M uses Next.js with `__NEXT_DATA__` JSON embedded in every page.
 * Product pages contain full article details including prices at:
 *   props.pageProps.productPageProps.aemData.productArticleDetails
 *
 * Price fields:
 *   - whitePriceValue: regular price (string, e.g. "24.99")
 *   - priceClubValue: H&M member price (string or null, preferred when available)
 *   - redPriceValue: sale/clearance price (string or null)
 *
 * Catalog/listing pages contain product hits at:
 *   props.pageProps.srpProps.hits → [{ pdpUrl, regularPrice, ... }]
 *
 * Since the extension runs as a Chrome extension with host_permissions
 * for www2.hm.com, the service worker's fetch() sends browser-like
 * requests that bypass Akamai bot protection.
 */

import { log, warn } from '../logger';
import type { RetailerSite } from '../core/AbstractRetailer';

/**
 * Look up a single H&M product's price by fetching its product page HTML
 * and parsing the __NEXT_DATA__ JSON.
 *
 * @param pid 10-digit article code (e.g. "1247834001")
 * @param regionId Target region (e.g. "uk" or "il")
 * @param sites Retailer site config (needed for pathPrefix)
 * @returns The price as a number, or null if not found
 */
export async function lookupPrice(
  pid: string,
  regionId: string,
  sites: Record<string, RetailerSite>
): Promise<number | null> {
  const site = sites[regionId];
  if (!site) return null;

  const prefix = site.pathPrefix ?? '';
  const url = `https://www2.hm.com${prefix}/productpage.${pid}.html`;

  try {
    let resp = await fetch(url, { credentials: 'include' });

    if (resp.status === 403 || resp.status === 410) {
      log(
        `[hm] ${resp.status} with cookies for pid=${pid}, region=${regionId} — retrying without cookies`
      );
      resp = await fetch(url, { credentials: 'omit' });
    }

    if (!resp.ok) {
      warn(`[hm] HTTP ${resp.status} for pid=${pid}, region=${regionId}`);
      return null;
    }

    const html = await resp.text();
    return parsePriceFromHtml(html, pid);
  } catch (err) {
    warn('[hm] Fetch error:', err);
    return null;
  }
}

/**
 * Parse product price from H&M page HTML.
 *
 * Strategy 1: Parse __NEXT_DATA__ JSON for structured price data
 * Strategy 2: Parse JSON-LD structured data as fallback
 */
export function parsePriceFromHtml(html: string, pid: string): number | null {
  // Strategy 1: __NEXT_DATA__ JSON
  const price = parsePriceFromNextData(html, pid);
  if (price !== null) return price;

  // Strategy 2: JSON-LD fallback
  const jsonLdPrice = parsePriceFromJsonLd(html);
  if (jsonLdPrice !== null) {
    log(`[hm] pid=${pid} -> price=${jsonLdPrice} (JSON-LD fallback)`);
    return jsonLdPrice;
  }

  log(`[hm] No price found for pid=${pid}`);
  return null;
}

/**
 * Parse a price string that may contain currency symbols and use either
 * English (1,234.56) or European (1.234,56) number formatting.
 * Returns the numeric value, or null if unparseable.
 */
export function parseHmPriceStr(raw: string): number | null {
  // Strip currency symbols, spaces, and non-numeric chars except . and ,
  const cleaned = raw.replace(/[^\d.,]/g, '');
  if (!cleaned) return null;

  let numStr: string;
  if (cleaned.includes(',') && cleaned.includes('.')) {
    // Both separators present — last one is the decimal separator
    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    if (lastComma > lastDot) {
      // European: 1.234,56 → 1234.56
      numStr = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      // English: 1,234.56 → 1234.56
      numStr = cleaned.replace(/,/g, '');
    }
  } else if (cleaned.includes(',')) {
    // Comma only: could be "1,234" (thousands) or "12,99" (decimal)
    // If exactly 3 digits after comma and no other commas, treat as thousands
    const parts = cleaned.split(',');
    if (parts.length === 2 && parts[1].length === 3) {
      numStr = cleaned.replace(',', ''); // thousands separator
    } else {
      numStr = cleaned.replace(',', '.'); // decimal separator
    }
  } else {
    numStr = cleaned;
  }

  const price = parseFloat(numStr);
  return !isNaN(price) && price > 0 ? price : null;
}

/**
 * Pick the best price string from an H&M variation/article object.
 * Priority: member (priceClubValue) > sale (redPriceValue) > regular (whitePriceValue).
 */
export function pickHmPrice(obj: Record<string, unknown>): string | null {
  const raw = obj.priceClubValue ?? obj.redPriceValue ?? obj.whitePriceValue;
  return raw != null ? String(raw) : null;
}

/**
 * Check if two H&M PIDs are a valid base/variant pair.
 * H&M PIDs are 7 digits (base product) or 10 digits (base + 3-digit colour).
 * Only matches when one is exactly 7 and the other is 10, sharing a prefix.
 */
export function isHmPidMatch(a: string, b: string): boolean {
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return short.length === 7 && long.length === 10 && long.startsWith(short);
}

/**
 * Extract a price string from a parsed H&M __NEXT_DATA__ object.
 *
 * Shared by both the background provider (parsePriceFromNextData) and
 * the content script (HMRetailer.extractPriceFromPage). Having one
 * implementation means H&M structure changes only need updating here.
 *
 * @param data The parsed JSON from __NEXT_DATA__
 * @param pid  The article code to look up
 * @returns Price string (e.g. "19.99"), or null if not found
 */
export function extractPriceFromNextDataObject(data: unknown, pid: string): string | null {
  const details = (data as Record<string, unknown>)?.props
    ? ((
        data as Record<
          string,
          Record<string, Record<string, Record<string, Record<string, unknown>>>>
        >
      )?.props?.pageProps?.productPageProps?.aemData?.productArticleDetails as
        | Record<string, unknown>
        | undefined)
    : undefined;
  if (!details) return null;

  // Prices live under details.variations[articleCode]
  const variations = details.variations as Record<string, Record<string, unknown>> | undefined;
  if (variations) {
    // Exact PID match
    const variant = variations[pid];
    if (variant) {
      const price = pickHmPrice(variant);
      if (price) return price;
    }
    // Base/variant prefix match (7-digit ↔ 10-digit)
    for (const [code, v] of Object.entries(variations)) {
      if (isHmPidMatch(pid, code)) {
        const price = pickHmPrice(v as Record<string, unknown>);
        if (price) return price;
      }
    }
  }

  // Legacy fallback: details[pid] directly (older site versions)
  const article = details[pid] as Record<string, unknown> | undefined;
  if (article) {
    const price = pickHmPrice(article);
    if (price) return price;
  }

  return null;
}

/**
 * Extract price from __NEXT_DATA__ JSON embedded in page HTML.
 *
 * Actual structure (verified Feb 2026):
 *   productArticleDetails.variations[articleCode].whitePriceValue (regular)
 *   productArticleDetails.variations[articleCode].priceClubValue (member, preferred)
 *   productArticleDetails.variations[articleCode].redPriceValue (sale)
 */
export function parsePriceFromNextData(html: string, pid: string): number | null {
  const match = html.match(/<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) {
    log(`[hm] No __NEXT_DATA__ found for pid=${pid}`);
    return null;
  }

  try {
    const data = JSON.parse(match[1]);
    const priceStr = extractPriceFromNextDataObject(data, pid);
    if (priceStr) {
      const price = parseHmPriceStr(priceStr);
      if (price !== null) {
        log(`[hm] pid=${pid} -> price=${price}`);
        return price;
      }
    }

    log(`[hm] No price found in __NEXT_DATA__ for pid=${pid}`);
    return null;
  } catch (err) {
    warn(`[hm] Failed to parse __NEXT_DATA__ for pid=${pid}:`, err);
    return null;
  }
}

/**
 * Extract price from JSON-LD structured data (Schema.org Product markup).
 */
export function parsePriceFromJsonLd(html: string): number | null {
  const pattern = /<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let jsonLdMatch: RegExpExecArray | null;

  while ((jsonLdMatch = pattern.exec(html)) !== null) {
    try {
      const data = JSON.parse(jsonLdMatch[1]);
      // Handle both single object and array of JSON-LD blocks
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item['@type'] === 'Product' && item.offers) {
          const offers = Array.isArray(item.offers) ? item.offers : [item.offers];
          for (const offer of offers) {
            if (offer.price != null) {
              const price = parseFloat(String(offer.price));
              if (!isNaN(price) && price > 0) return price;
            }
          }
        }
      }
    } catch {
      // Invalid JSON-LD block, try next
    }
  }

  return null;
}

/**
 * Parse catalog page HTML to extract PID → price mappings.
 *
 * H&M catalog pages embed product data in __NEXT_DATA__ at:
 *   props.pageProps.srpProps.hits → [{ pdpUrl, regularPrice, ... }]
 *
 * The PID is extracted from pdpUrl: /en_gb/productpage.{pid}.html
 */
export function parseCatalogHtml(html: string): Record<string, number> {
  const results: Record<string, number> = {};

  const match = html.match(/<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) {
    log('[hm] No __NEXT_DATA__ found in catalog page');
    return results;
  }

  try {
    const data = JSON.parse(match[1]);
    const hits = data?.props?.pageProps?.srpProps?.hits;
    if (!Array.isArray(hits)) {
      log('[hm] No srpProps.hits in catalog __NEXT_DATA__');
      return results;
    }

    for (const hit of hits) {
      const pdpUrl: string | undefined = hit.pdpUrl;
      if (!pdpUrl) continue;

      // Extract PID from pdpUrl: e.g. "/en_gb/productpage.1247834001.html"
      const pidMatch = pdpUrl.match(/productpage\.(\d{7,})\.html/);
      if (!pidMatch) continue;
      const pid = pidMatch[1];

      // Parse price from regularPrice string (e.g. "£19.99" or "89.90 ₪")
      const priceStr: string | undefined = hit.regularPrice;
      if (!priceStr) continue;

      const price = parseHmPriceStr(priceStr);
      if (price === null) continue;

      if (!(pid in results)) {
        results[pid] = price;
      }
    }
  } catch (err) {
    warn('[hm] Failed to parse catalog __NEXT_DATA__:', err);
  }

  log(`[hm] Catalog parse: ${Object.keys(results).length} PID→price pairs`);
  return results;
}

/**
 * Fetch a catalog page and parse PID → price pairs.
 */
export async function lookupCatalogPrices(catalogUrl: string): Promise<Record<string, number>> {
  try {
    let resp = await fetch(catalogUrl, { credentials: 'include' });

    if (resp.status === 403 || resp.status === 410) {
      log('[hm] Catalog blocked with cookies — retrying without cookies');
      resp = await fetch(catalogUrl, { credentials: 'omit' });
    }

    if (!resp.ok) {
      warn(`[hm] Catalog HTTP ${resp.status} for ${catalogUrl}`);
      return {};
    }

    const html = await resp.text();
    return parseCatalogHtml(html);
  } catch (err) {
    warn('[hm] Catalog fetch error:', err);
    return {};
  }
}
