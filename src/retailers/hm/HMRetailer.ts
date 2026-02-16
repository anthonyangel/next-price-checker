/**
 * H&M retailer implementation — supports www2.hm.com UK and IL regions.
 *
 * Like Zara, H&M uses the same hostname (www2.hm.com) for all regions,
 * differentiated by URL path prefix (/en_gb/ vs /hw_il/).
 *
 * H&M is a Next.js site — product data (including prices) is embedded
 * in __NEXT_DATA__ JSON on every page, making extraction reliable.
 */

import { AbstractRetailer, type RetailerSite } from '../../core/AbstractRetailer';
import {
  lookupPrice as hmLookupPrice,
  lookupCatalogPrices,
  extractPriceFromNextDataObject,
} from '../../providers/hm';
import { log } from '../../logger';

export class HMRetailer extends AbstractRetailer {
  readonly id = 'hm';
  readonly name = 'H&M';

  readonly sites: Record<string, RetailerSite> = {
    uk: {
      hostnames: ['www2.hm.com'],
      pathPrefix: '/en_gb',
      catalogPathPattern: /^\/en_gb\/(?!productpage\.).*\.html$/,
    },
    il: {
      hostnames: ['www2.hm.com'],
      pathPrefix: '/hw_il',
      catalogPathPattern: /^\/hw_il\/(?!productpage\.).*\.html$/,
    },
  };

  readonly supportsProductPage = true;
  readonly supportsCatalogPage = true;

  /**
   * H&M's price element on product pages.
   * The __NEXT_DATA__ approach is primary, but this CSS selector is used
   * by the content script for DOM-based extraction on the current page.
   */
  readonly priceSelector = 'span.price-value';

  /**
   * H&M catalog uses stable data-elid attribute for the product grid.
   * Individual cards are <article data-articlecode="..."> inside <li>s.
   */
  readonly productContainerSelector = 'ul[data-elid="product-grid"]';

  readonly productContainerFallbackSelectors = [
    '[data-elid="product-grid"]',
    'ul[class]:has(> li > article[data-articlecode])',
  ];

  /**
   * Catalog price fallback selectors — H&M catalog cards use plain <p>
   * for prices (no stable class). Try the last <p> in the article.
   */
  override readonly catalogPriceFallbackSelectors = ['p'];

  /**
   * Extract the current page's price from __NEXT_DATA__ JSON in the DOM.
   * Delegates to the shared extractPriceFromNextDataObject so the structure
   * navigation logic lives in one place (providers/hm.ts).
   */
  override extractPriceFromPage(url: URL): string | null {
    if (typeof document === 'undefined') return null;
    const script = document.getElementById('__NEXT_DATA__');
    if (!script?.textContent) return null;

    const pid = this.extractProductId(url);
    if (!pid) return null;

    try {
      const data = JSON.parse(script.textContent);
      const price = extractPriceFromNextDataObject(data, pid);
      if (price) {
        log(`[hm] extractPriceFromPage: pid=${pid}, price=${price}`);
      }
      return price;
    } catch {
      return null;
    }
  }

  /**
   * Extract product ID from a catalog page DOM element.
   * H&M uses <article data-articlecode="1308076014"> for each product card.
   */
  override extractProductIdFromElement(element: Element): string | null {
    const article = element.getAttribute('data-articlecode')
      ? element
      : element.querySelector('article[data-articlecode]');
    return article?.getAttribute('data-articlecode') ?? null;
  }

  /**
   * Extract product ID (article code) from an H&M product URL.
   * URL pattern: /{locale}/productpage.{articleCode}.html
   * Article code is a 7-10 digit number (first 7 = base product, last 3 = colour).
   */
  extractProductId(url: URL): string | null {
    const match = url.pathname.match(/\/productpage\.(\d{7,})\.html/);
    return match ? match[1] : null;
  }

  /**
   * Construct a product page URL from a PID and region.
   */
  constructProductUrl(pid: string, regionId: string): string | null {
    const site = this.sites[regionId];
    if (!site) return null;
    const prefix = site.pathPrefix ?? '';
    return `https://www2.hm.com${prefix}/productpage.${pid}.html`;
  }

  async lookupPrice(pid: string, regionId: string): Promise<number | null> {
    return hmLookupPrice(pid, regionId, this.sites);
  }

  /**
   * Override bulk lookup to try catalog-page fetch first.
   * H&M catalog pages embed all product prices in __NEXT_DATA__,
   * so one request can resolve all PIDs.
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
