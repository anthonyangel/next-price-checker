/**
 * IKEA retailer implementation — supports www.ikea.com UK and IL regions.
 *
 * Like Zara and Mango, IKEA serves every region from one hostname
 * (www.ikea.com) and distinguishes them by path prefix: /gb/en for the UK,
 * /il/he for Israel. Both ikea.co.il and the bare ikea.com redirect here, so
 * a single host permission covers the retailer.
 *
 * IKEA is unusually friendly to this extension:
 *   - Article numbers are global — BILLY white is 00263850 in both regions,
 *     so catalog cards match across regions with no ID remapping.
 *   - URL slugs are locale-invariant (the Hebrew page reuses the English
 *     slug), and slug-less /p/{article}/ URLs redirect to the canonical page,
 *     so region transformation is a plain prefix swap.
 *   - Pages are server-rendered, so background fetches see real prices.
 */

import { AbstractRetailer, type RetailerSite } from '../../core/AbstractRetailer';
import {
  lookupPrice as ikeaLookupPrice,
  lookupCatalogPrices,
  buildProductUrl,
  extractPriceFromLdJson,
} from '../../providers/ikea';
import { log } from '../../logger';

export class IkeaRetailer extends AbstractRetailer {
  readonly id = 'ikea';
  readonly name = 'IKEA';

  readonly sites: Record<string, RetailerSite> = {
    uk: {
      hostnames: ['www.ikea.com'],
      pathPrefix: '/gb/en',
      catalogPathPattern: /^\/gb\/en\/(cat|search)\//,
    },
    il: {
      hostnames: ['www.ikea.com'],
      pathPrefix: '/il/he',
      catalogPathPattern: /^\/il\/he\/(cat|search)\//,
    },
  };

  readonly supportsProductPage = true;
  readonly supportsCatalogPage = true;

  /**
   * Product page price.
   *
   * Scoped deliberately. `.pipcom-price-module__current-price` alone would
   * work for the *element*, but its textContent glues the visible price to a
   * screen-reader span ("£55Price £ 55"), which parsePrice would read as 5555.
   * The inner `__nowrap` span holds just the visible price ("£55").
   *
   * The `__current-price` half of the selector matters too: on discounted
   * products the previous price sits in a sibling `__comparison-price`
   * wrapper that appears *earlier* in the DOM, so an unscoped `__nowrap`
   * would match the pre-sale price.
   */
  readonly priceSelector = '.pipcom-price-module__current-price .pipcom-price__nowrap';

  /** Direct parent of the product cards on category pages. */
  readonly productContainerSelector = '.plp-product-list__products';

  readonly productContainerFallbackSelectors = ['.plp-product-list', '#product-list'];

  /**
   * Catalog cards use `plp-`-prefixed classes rather than the product page's
   * `pipcom-` ones, so the PDP selector never matches there. Same scoping
   * rationale as priceSelector: innermost span for clean text, scoped to the
   * current-price wrapper so sale items don't report the previous price.
   */
  override readonly catalogPriceFallbackSelectors = [
    '.plp-price-module__current-price .plp-price__nowrap',
    '.plp-price-module__current-price',
  ];

  /**
   * Extract the article number from an IKEA product URL.
   *
   * Product URLs are `/p/{slug}-{article}/`, and the slug is optional:
   *   /gb/en/p/billy-bookcase-white-00263850/  → 00263850
   *   /gb/en/p/s69440596/                      → s69440596
   *
   * Article numbers are 8 digits, optionally prefixed with `s` for
   * combination/bundle products.
   */
  extractProductId(url: URL): string | null {
    const segment = url.pathname.match(/\/p\/([^/]+)\/?$/);
    if (!segment) return null;
    const article = segment[1].match(/(s?\d{8})$/);
    return article ? article[1] : null;
  }

  /**
   * Extract the article number from a catalog card.
   * Cards expose it as a plain attribute, and the value is identical in both
   * regions — so it matches `extractProductId` output directly.
   */
  override extractProductIdFromElement(element: Element): string | null {
    const card = element.hasAttribute('data-product-number')
      ? element
      : element.querySelector('[data-product-number]');
    return card?.getAttribute('data-product-number') ?? null;
  }

  /**
   * Build a product URL from an article number. IKEA redirects slug-less
   * URLs to the canonical slugged page, so these are real, navigable links.
   */
  override constructProductUrl(pid: string, regionId: string): string | null {
    const site = this.sites[regionId];
    if (!site) return null;
    return buildProductUrl(pid, site);
  }

  /**
   * Read the current page's price from its schema.org JSON-LD.
   * Used by the content script when the CSS selector misses — more robust
   * than class names, and it already handles the sale (AggregateOffer) shape.
   */
  override extractPriceFromPage(_url: URL): string | null {
    if (typeof document === 'undefined') return null;

    const blocks = Array.from(
      document.querySelectorAll('script[type="application/ld+json"]')
    ) as HTMLScriptElement[];

    for (const block of blocks) {
      const text = block.textContent;
      if (!text) continue;
      // Reuse the provider's parser by wrapping the JSON back into a script tag.
      const price = extractPriceFromLdJson(`<script type="application/ld+json">${text}</script>`);
      if (price !== null) {
        log(`[ikea] extractPriceFromPage: price=${price}`);
        return String(price);
      }
    }

    return null;
  }

  async lookupPrice(pid: string, regionId: string, productUrl?: string): Promise<number | null> {
    return ikeaLookupPrice(pid, regionId, this.sites, productUrl);
  }

  /**
   * Bulk lookup: fetch the alternate category page once and read every card's
   * `data-price`, then fall back to individual product pages for anything the
   * catalog didn't cover.
   *
   * The fallback matters — search result pages are client-rendered, so a
   * background fetch of one returns no cards at all.
   */
  async lookupPrices(
    pids: string[],
    regionId: string,
    pidToUrl?: Record<string, string>,
    catalogUrl?: string
  ): Promise<Record<string, number>> {
    if (catalogUrl) {
      return this.lookupPricesWithCatalog(
        pids,
        regionId,
        catalogUrl,
        lookupCatalogPrices,
        pidToUrl
      );
    }
    return super.lookupPrices(pids, regionId, pidToUrl);
  }

  transformUrl(url: URL, fromRegion: string, toRegion: string): string {
    const fromSite = this.sites[fromRegion];
    const toSite = this.sites[toRegion];
    if (!fromSite || !toSite) {
      throw new Error(`Unknown region: ${fromRegion} or ${toRegion}`);
    }

    const fromPrefix = fromSite.pathPrefix ?? '';
    const toPrefix = toSite.pathPrefix ?? '';

    let path = url.pathname;
    if (fromPrefix && path.startsWith(fromPrefix)) {
      path = path.slice(fromPrefix.length) || '/';
    }
    path = toPrefix + path;

    return `${url.protocol}//${url.hostname}${path}${url.search}${url.hash}`;
  }
}
