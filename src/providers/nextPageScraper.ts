/**
 * Fallback price extraction for Next product pages.
 *
 * When the Bloomreach API doesn't index a product (common for sale/clearance
 * items), this module fetches the product page HTML directly and extracts
 * the price from structured data (JSON-LD, __NEXT_DATA__, or meta tags).
 *
 * Uses regex parsing (no DOM APIs) so it works in any context:
 * service worker, content script, etc.
 */

import { log, warn } from '../logger';

/**
 * Extract price from raw HTML using structured data strategies.
 * Pure parsing — no network I/O. Usable from any context.
 */
export function extractPriceFromHtml(html: string): number | null {
  // Strategy 1: JSON-LD structured data
  const jsonLdPrice = extractFromJsonLd(html);
  if (jsonLdPrice !== null) return jsonLdPrice;

  // Strategy 2: __NEXT_DATA__ (Next.js SSR data)
  const nextDataPrice = extractFromNextData(html);
  if (nextDataPrice !== null) return nextDataPrice;

  // Strategy 3: OpenGraph / meta tags
  const metaPrice = extractFromMetaTags(html);
  if (metaPrice !== null) return metaPrice;

  return null;
}

/**
 * Fetch a Next product page and extract its price from structured data.
 * Returns null if the page can't be fetched or no price is found.
 */
export async function scrapeProductPagePrice(productUrl: string): Promise<number | null> {
  try {
    const res = await fetch(productUrl, { credentials: 'omit' });
    if (!res.ok) {
      log(`[nextPageScraper] HTTP ${res.status} for ${productUrl}`);
      return null;
    }

    const html = await res.text();
    if (html.length < 1000) {
      log(`[nextPageScraper] Response too small (${html.length} bytes), likely blocked`);
      return null;
    }

    const price = extractPriceFromHtml(html);
    if (price !== null) {
      log(`[nextPageScraper] Extracted price: ${price} for ${productUrl}`);
    } else {
      log(`[nextPageScraper] No price found in HTML for ${productUrl}`);
    }
    return price;
  } catch (err) {
    warn(`[nextPageScraper] Fetch error for ${productUrl}:`, err);
    return null;
  }
}

/** Extract price from JSON-LD Product schema. */
function extractFromJsonLd(html: string): number | null {
  // Match all <script type="application/ld+json"> blocks
  const jsonLdPattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = jsonLdPattern.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      const price = extractPriceFromLdJson(data);
      if (price !== null) return price;
    } catch {
      // Invalid JSON, skip
    }
  }
  return null;
}

/** Recursively search JSON-LD data for a Product with offers.price. */
function extractPriceFromLdJson(data: unknown): number | null {
  if (!data || typeof data !== 'object') return null;

  if (Array.isArray(data)) {
    for (const item of data) {
      const price = extractPriceFromLdJson(item);
      if (price !== null) return price;
    }
    return null;
  }

  const obj = data as Record<string, unknown>;
  if (obj['@type'] === 'Product' || obj['@type'] === 'IndividualProduct') {
    const offers = obj['offers'];
    if (offers && typeof offers === 'object') {
      const price = extractPriceFromOffers(offers);
      if (price !== null) return price;
    }
  }

  // Check @graph arrays
  if (obj['@graph'] && Array.isArray(obj['@graph'])) {
    return extractPriceFromLdJson(obj['@graph']);
  }

  return null;
}

/** Extract numeric price from an Offers object or array. */
function extractPriceFromOffers(offers: unknown): number | null {
  if (Array.isArray(offers)) {
    for (const offer of offers) {
      const price = extractPriceFromOffers(offer);
      if (price !== null) return price;
    }
    return null;
  }

  if (offers && typeof offers === 'object') {
    const obj = offers as Record<string, unknown>;
    // Prefer lowPrice (sale price) over price
    for (const key of ['lowPrice', 'price']) {
      const val = obj[key];
      if (val !== undefined && val !== null) {
        const num = typeof val === 'number' ? val : parseFloat(String(val));
        if (!isNaN(num) && num > 0) return num;
      }
    }
  }
  return null;
}

/** Extract price from __NEXT_DATA__ JSON embedded in the page. */
function extractFromNextData(html: string): number | null {
  const nextDataMatch = html.match(
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/
  );
  if (!nextDataMatch) return null;

  try {
    const data = JSON.parse(nextDataMatch[1]);
    // Walk through pageProps looking for price fields
    const pageProps = data?.props?.pageProps;
    if (!pageProps) return null;
    return findPriceInObject(pageProps, 0);
  } catch {
    return null;
  }
}

/** Recursively search an object for price-like fields. Max depth to avoid cycles. */
function findPriceInObject(obj: unknown, depth: number): number | null {
  if (depth > 6 || !obj || typeof obj !== 'object') return null;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const price = findPriceInObject(item, depth + 1);
      if (price !== null) return price;
    }
    return null;
  }

  const record = obj as Record<string, unknown>;

  // Look for common price field names (prefer sale/current price)
  for (const key of ['salePrice', 'sale_price', 'currentPrice', 'price', 'Price']) {
    const val = record[key];
    if (val !== undefined && val !== null) {
      const num = typeof val === 'number' ? val : parseFloat(String(val));
      if (!isNaN(num) && num > 0) return num;
    }
  }

  // Recurse into nested objects (skip large arrays)
  for (const [key, val] of Object.entries(record)) {
    if (key.startsWith('_') || key === 'buildId') continue;
    if (typeof val === 'object' && val !== null) {
      const price = findPriceInObject(val, depth + 1);
      if (price !== null) return price;
    }
  }

  return null;
}

/** Extract price from OpenGraph or product meta tags. */
function extractFromMetaTags(html: string): number | null {
  // product:price:amount, og:price:amount, etc.
  const metaPattern =
    /<meta[^>]*(?:property|name)=["'](?:product:price:amount|og:price:amount)["'][^>]*content=["']([^"']+)["']/i;
  const match = html.match(metaPattern);
  if (match) {
    const num = parseFloat(match[1]);
    if (!isNaN(num) && num > 0) return num;
  }

  // Also try reversed attribute order: content before property
  const metaPatternReversed =
    /<meta[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:product:price:amount|og:price:amount)["']/i;
  const matchReversed = html.match(metaPatternReversed);
  if (matchReversed) {
    const num = parseFloat(matchReversed[1]);
    if (!isNaN(num) && num > 0) return num;
  }

  return null;
}
