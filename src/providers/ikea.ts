/**
 * IKEA price lookup provider.
 *
 * IKEA has no public price API (api.ingka.ikea.com requires auth), but its
 * pages are fully server-rendered, so a plain service-worker fetch() gets
 * real price data with no JavaScript execution and no bot challenge.
 *
 * Two extraction paths:
 *
 *  1. Product pages — schema.org JSON-LD (`<script type="application/ld+json">`)
 *     carries a Product node whose `offers` holds the current price. This is a
 *     documented standard rather than a CSS class, so it survives redesigns.
 *
 *  2. Catalog pages — each product card is a plain HTML element carrying
 *     `data-product-number` and `data-price` attributes, so one fetch resolves
 *     every product on the page. Article numbers are global (identical in UK
 *     and IL), so no cross-region ID remapping is needed.
 *
 * Sale handling: on a discounted product IKEA emits an AggregateOffer whose
 * nested Offer holds the *current* (discounted) price, with the pre-sale figure
 * exposed only as `highPrice`. Catalog `data-price` is likewise the discounted
 * price. Both paths therefore report the price the shopper actually pays.
 */

import { log, warn } from '../logger';
import type { RetailerSite } from '../core/AbstractRetailer';

/** Shape of the schema.org nodes we care about. Everything is optional — this is untrusted page data. */
interface LdOffer {
  '@type'?: string;
  price?: string | number;
  lowPrice?: string | number;
  offers?: LdOffer | LdOffer[];
}

interface LdNode {
  '@type'?: string;
  offers?: LdOffer | LdOffer[];
}

/**
 * Build a product page URL for an article number in a given region.
 * IKEA resolves slug-less `/p/{article}/` URLs to the canonical slugged URL,
 * so we never need to know a product's slug in the target locale.
 */
export function buildProductUrl(pid: string, site: RetailerSite): string {
  const prefix = site.pathPrefix ?? '';
  return `https://www.ikea.com${prefix}/p/${pid}/`;
}

/**
 * Look up a product's price by fetching its product page and reading JSON-LD.
 *
 * @param pid IKEA article number (8 digits, or `s` + 8 digits for combinations)
 * @param regionId Target region ('uk' or 'il')
 * @param sites The retailer's site config (supplies the region path prefix)
 * @param productUrl Optional real product URL. Preferred when known; otherwise
 *   a slug-less URL is constructed, which IKEA redirects to the canonical page.
 * @returns The price as a number, or null if not found
 */
export async function lookupPrice(
  pid: string,
  regionId: string,
  sites: Record<string, RetailerSite>,
  productUrl?: string
): Promise<number | null> {
  const site = sites[regionId];
  if (!site) {
    warn(`[ikea] Unknown region: ${regionId}`);
    return null;
  }

  const url = productUrl ?? buildProductUrl(pid, site);

  try {
    const resp = await fetch(url, { credentials: 'omit' });

    if (!resp.ok) {
      warn(`[ikea] HTTP ${resp.status} for pid=${pid}, region=${regionId}`);
      return null;
    }

    // A product that doesn't exist in this region does not 404 — IKEA either
    // keeps the URL and renders a page with no price, or redirects to a
    // category listing. Detect the redirect case before parsing.
    if (resp.redirected && resp.url && !new URL(resp.url).pathname.includes('/p/')) {
      log(`[ikea] pid=${pid} not available in ${regionId} (redirected to ${resp.url})`);
      return null;
    }

    const html = await resp.text();
    return parsePriceFromHtml(html, pid);
  } catch (err) {
    warn('[ikea] Fetch error:', err);
    return null;
  }
}

/**
 * Fetch a catalog page and parse article number → price pairs from the
 * product card data attributes.
 *
 * Category pages (`/cat/...`) are server-rendered and yield a full grid.
 * Search pages (`/search/?q=...`) are client-rendered, so this returns an
 * empty map for them and the caller falls back to individual lookups.
 *
 * @returns A map of article number → numeric price (empty on any failure)
 */
export async function lookupCatalogPrices(catalogUrl: string): Promise<Record<string, number>> {
  try {
    const resp = await fetch(catalogUrl, { credentials: 'omit' });
    if (!resp.ok) {
      warn(`[ikea] Catalog HTTP ${resp.status} for ${catalogUrl}`);
      return {};
    }
    const html = await resp.text();
    return parseCatalogHtml(html);
  } catch (err) {
    warn('[ikea] Catalog fetch error:', err);
    return {};
  }
}

/**
 * Parse catalog page HTML into article number → price pairs.
 *
 * Product cards look like:
 *   <div data-product-number="00263850" data-price="55" data-currency="GBP"
 *        data-testid="plp-product-card" ...>
 *
 * `data-price` is the current (post-discount) price. Article numbers are the
 * same in every region, so these keys match across UK and IL directly.
 */
export function parseCatalogHtml(html: string): Record<string, number> {
  const results: Record<string, number> = {};

  // Match a card's article number and price within the same opening tag.
  // The two attributes are adjacent in IKEA's markup; `[^>]*` keeps the match
  // inside one tag so we can never pair one card's id with another's price.
  const cardPattern = /data-product-number="(s?\d+)"[^>]*?data-price="([\d.]+)"/g;

  let match: RegExpExecArray | null;
  while ((match = cardPattern.exec(html)) !== null) {
    const [, pid, priceText] = match;
    const price = parseFloat(priceText);
    if (isNaN(price) || price <= 0) continue;
    if (!(pid in results)) results[pid] = price;
  }

  log(`[ikea] Catalog parse: ${Object.keys(results).length} article→price pairs`);
  return results;
}

/**
 * Parse the current price out of an IKEA product page.
 *
 * Primary source is schema.org JSON-LD; falls back to the rendered price
 * module markup if the structured data is missing or malformed.
 */
export function parsePriceFromHtml(html: string, pid: string): number | null {
  const fromLd = extractPriceFromLdJson(html);
  if (fromLd !== null) {
    log(`[ikea] pid=${pid} -> price=${fromLd} (json-ld)`);
    return fromLd;
  }

  const fromMarkup = extractPriceFromPriceModule(html);
  if (fromMarkup !== null) {
    log(`[ikea] pid=${pid} -> price=${fromMarkup} (price module)`);
    return fromMarkup;
  }

  log(`[ikea] No price found for pid=${pid}`);
  return null;
}

/**
 * Extract the current price from schema.org JSON-LD blocks.
 *
 * Handles both shapes IKEA emits:
 *   - full price:  offers: { "@type": "Offer", price: "55" }
 *   - on sale:     offers: { "@type": "AggregateOffer", highPrice: "499",
 *                            lowPrice: "449", offers: [{ price: "449" }] }
 *
 * For AggregateOffer we deliberately read the nested Offer (or `lowPrice`),
 * never `highPrice` — `highPrice` is the struck-through pre-sale figure.
 */
export function extractPriceFromLdJson(html: string): number | null {
  const blocks = html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );

  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block[1]);
    } catch {
      continue; // not our block, or truncated — try the next one
    }

    const nodes: LdNode[] = Array.isArray(parsed) ? parsed : [parsed as LdNode];
    for (const node of nodes) {
      if (node?.['@type'] !== 'Product') continue;
      const price = priceFromOffers(node.offers);
      if (price !== null) return price;
    }
  }

  return null;
}

/** Resolve a numeric current price from an `offers` value of any supported shape. */
function priceFromOffers(offers: LdOffer | LdOffer[] | undefined): number | null {
  if (!offers) return null;

  if (Array.isArray(offers)) {
    for (const offer of offers) {
      const price = priceFromOffers(offer);
      if (price !== null) return price;
    }
    return null;
  }

  // A plain Offer carries the price directly.
  const direct = toPrice(offers.price);
  if (direct !== null) return direct;

  // An AggregateOffer nests the real Offer(s); prefer those over lowPrice.
  const nested = priceFromOffers(offers.offers);
  if (nested !== null) return nested;

  return toPrice(offers.lowPrice);
}

/** Coerce a JSON-LD price value to a positive number, or null. */
function toPrice(value: string | number | undefined): number | null {
  if (value === undefined || value === null) return null;
  const num = typeof value === 'number' ? value : parseFloat(value);
  return isNaN(num) || num <= 0 ? null : num;
}

/**
 * Fallback: read the price out of the rendered price module.
 *
 * Scoped to `pipcom-price-module__current-price` on purpose. On discounted
 * products the previous price appears *earlier* in the document inside
 * `pipcom-price-module__comparison-price`, so an unscoped match would return
 * the pre-sale price.
 */
export function extractPriceFromPriceModule(html: string): number | null {
  const start = html.indexOf('pipcom-price-module__current-price');
  if (start === -1) return null;

  // Only look at the current-price element, not whatever follows it.
  const scope = html.slice(start, start + 600);

  const integer = scope.match(/pipcom-price__integer[^>]*>([\d,]+)</);
  if (!integer) return null;

  const decimal = scope.match(/pipcom-price__decimal[^>]*>(\d+)</);
  const text = `${integer[1].replace(/,/g, '')}${decimal ? `.${decimal[1]}` : ''}`;

  const price = parseFloat(text);
  return isNaN(price) || price <= 0 ? null : price;
}
