/**
 * Mango retailer implementation — supports shop.mango.com UK and IL regions.
 *
 * Like Zara, Mango uses a shared hostname (shop.mango.com) with path prefixes
 * (/gb/ vs /il/) to differentiate regions. Prices are fetched via Mango's
 * public REST API (no auth keys needed).
 */

import { AbstractRetailer, type RetailerSite } from '../../core/AbstractRetailer';
import { lookupPrice as mangoLookupPrice } from '../../providers/mango';

export class MangoRetailer extends AbstractRetailer {
  readonly id = 'mango';
  readonly name = 'Mango';

  readonly sites: Record<string, RetailerSite> = {
    uk: {
      hostnames: ['shop.mango.com'],
      pathPrefix: '/gb',
      catalogPathPattern: /^\/gb\/[a-z]{2}\/c\//,
    },
    il: {
      hostnames: ['shop.mango.com'],
      pathPrefix: '/il',
      catalogPathPattern: /^\/il\/[a-z]{2}\/c\//,
    },
  };

  readonly supportsProductPage = true;
  readonly supportsCatalogPage = true;

  readonly priceSelector = 'span[class*="SinglePrice_center"]';

  readonly productContainerSelector = 'form[class*="ProductCard_productCard"]';

  readonly productContainerFallbackSelectors = ['[class*="ProductCard"]'];

  /**
   * Extract the 8-digit product ID from a Mango product URL.
   * URL pattern: /gb/en/p/{category}/{slug}_{productId}?c=XX
   */
  extractProductId(url: URL): string | null {
    const match = url.pathname.match(/_(\d{8})$/);
    return match ? match[1] : null;
  }

  /**
   * Extract the price from Schema.org microdata on the current page.
   * Mango embeds <meta itemprop="price" content="29.99"> inside the
   * product offers wrapper. This is more reliable than CSS class selectors
   * which have CSS Module hash suffixes.
   */
  override extractPriceFromPage(_url: URL): string | null {
    const meta = document.querySelector('span[itemprop="offers"] meta[itemprop="price"]');
    return meta?.getAttribute('content') ?? null;
  }

  /**
   * Look up a product's price via the Mango price API.
   * Extracts the color code from the product URL's ?c= parameter when available.
   */
  async lookupPrice(pid: string, regionId: string, productUrl?: string): Promise<number | null> {
    let colorCode: string | undefined;
    if (productUrl) {
      try {
        const url = new URL(productUrl);
        colorCode = url.searchParams.get('c') ?? undefined;
      } catch {
        // ignore invalid URLs
      }
    }
    return mangoLookupPrice(pid, regionId, colorCode);
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
