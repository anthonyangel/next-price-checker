/**
 * Zara retailer implementation — supports zara.com UK and IL regions.
 *
 * Unlike Next, Zara uses the same hostname (www.zara.com) for all regions,
 * differentiated by URL path prefix (/uk/ vs /il/).
 */

import { AbstractRetailer, type RetailerSite } from '../../core/AbstractRetailer';
import { lookupPrice as zaraLookupPrice, lookupCatalogPrices } from '../../providers/zara';

export class ZaraRetailer extends AbstractRetailer {
  readonly id = 'zara';
  readonly name = 'Zara';

  readonly sites: Record<string, RetailerSite> = {
    uk: {
      hostnames: ['www.zara.com'],
      pathPrefix: '/uk',
      catalogPathPattern: /^\/uk\/en\/.*-l\d+\.html/,
    },
    il: {
      hostnames: ['www.zara.com'],
      pathPrefix: '/il',
      catalogPathPattern: /^\/il\/en\/.*-l\d+\.html/,
    },
  };

  readonly supportsProductPage = true;
  readonly supportsCatalogPage = true;

  /** Zara's slug-less constructed URLs may redirect to homepage. */
  override readonly constructedUrlsAreValid = false;

  readonly priceSelector = 'span.money-amount__main';

  readonly productContainerSelector = 'ul.product-grid__product-list';

  readonly productContainerFallbackSelectors = [
    '.product-grid > ul',
    'section[class*="product"] > ul',
  ];

  /**
   * Extract product ID from a Zara product URL.
   * URL pattern: /uk/en/product-name-p12345678.html
   */
  extractProductId(url: URL): string | null {
    const match = url.pathname.match(/-p(\d{8,})\.html/);
    return match ? match[1] : null;
  }

  /**
   * Extract product ID from a catalog page DOM element.
   *
   * Zara's SPA doesn't put href on <a> tags. Product cards carry two relevant
   * attributes:
   *   - `data-productid`  — internal 9-digit ID (e.g. "507930764")
   *   - `data-productkey` — composite key: `{internalId}-{urlRef}{variant}-p`
   *     e.g. "507930764-03067331059-p"
   *
   * The URL-friendly product reference is the first 8 digits of the middle
   * segment (e.g. "03067331"). Slug-less URLs like `-p03067331.html` work,
   * whereas `-p507930764.html` (internal ID) redirects to the homepage.
   *
   * We prefer `data-productkey` so the PID matches what `extractProductId`
   * returns from product-page URLs, keeping the cache consistent.
   */
  extractProductIdFromElement(element: Element): string | null {
    const productKey =
      element.getAttribute('data-productkey') ??
      element.querySelector('[data-productkey]')?.getAttribute('data-productkey');

    if (productKey) {
      const parts = productKey.split('-');
      // parts: [internalId, urlRefWithVariant, "p"]
      if (parts.length >= 2) {
        const urlRef = parts[1].slice(0, 8);
        if (/^\d{8}$/.test(urlRef)) return urlRef;
      }
    }

    // Fallback: use data-productid (9-digit internal ID).
    // Slug-less URLs with this ID may not work, but it's better than nothing.
    const pid =
      element.getAttribute('data-productid') ??
      element.querySelector('[data-productid]')?.getAttribute('data-productid');
    return pid ?? null;
  }

  /**
   * Construct a product page URL from a PID and region.
   * Zara accepts slug-less URLs like /uk/en/-p{pid}.html and redirects.
   */
  constructProductUrl(pid: string, regionId: string): string | null {
    const site = this.sites[regionId];
    if (!site) return null;
    const prefix = site.pathPrefix ?? '';
    return `https://www.zara.com${prefix}/en/-p${pid}.html`;
  }

  async lookupPrice(pid: string, regionId: string, productUrl?: string): Promise<number | null> {
    return zaraLookupPrice(pid, regionId, this.sites, productUrl);
  }

  /**
   * Override bulk lookup to fetch the alternate catalog page once instead of
   * hitting individual product pages (which fail because data-productid ≠ URL ref).
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
