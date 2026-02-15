/**
 * Next retailer implementation — supports next.co.uk and next.co.il.
 */

import { AbstractRetailer, type RetailerSite } from '../../core/AbstractRetailer';
import {
  lookupPrice as bloomreachLookup,
  type BloomreachRegionConfig,
} from '../../providers/bloomreach';

export class NextRetailer extends AbstractRetailer {
  readonly id = 'next';
  readonly name = 'Next';

  readonly sites: Record<string, RetailerSite> = {
    uk: {
      hostnames: ['www.next.co.uk'],
      catalogPathPattern: /\/shop/,
    },
    il: {
      hostnames: ['www.next.co.il'],
      pathPrefix: '/en',
      catalogPathPattern: /\/shop/,
    },
  };

  readonly supportsProductPage = true;
  readonly supportsCatalogPage = true;

  readonly priceSelector = '#pdp-item-title .MuiTypography-h1 span';

  readonly productContainerSelector =
    '#plp > div.MuiGrid-root.MuiGrid-container.plp-13gwbx > div.MuiGrid-root.MuiGrid-container.plp-product-grid-wrapper.plp-wq7tal > div';

  readonly productContainerFallbackSelectors = [
    '[data-testid="product-list"]',
    '.plp-product-grid-wrapper > div',
  ];

  /**
   * Catalog page price fallbacks — the PDP priceSelector doesn't match
   * product cards on listing pages. Try common price selectors first,
   * then fall back to any <span> (which typically contains the price text).
   */
  override readonly catalogPriceFallbackSelectors = [
    '.product-price',
    '[data-testid="price"]',
    'span',
  ];

  /** Bloomreach Discovery API credentials per region. */
  private readonly bloomreachConfigs: Record<string, BloomreachRegionConfig> = {
    uk: {
      accountId: '6042',
      authKey: 'vyzz50jis1i9dbxj',
      domainKey: 'next',
      siteUrl: 'https://www.next.co.uk',
    },
    il: {
      accountId: '6116',
      authKey: 'harovpat1tpa716o',
      domainKey: 'next_global',
      siteUrl: 'https://www.next.co.il',
    },
  };

  /**
   * Extract product ID (PID) from a Next product URL.
   * URL format: /style/{styleCode}/{pid} or /en/style/{styleCode}/{pid}
   */
  extractProductId(url: URL): string | null {
    const match = url.pathname.match(/\/style\/[^/]+\/([^/#?]+)/);
    return match ? match[1] : null;
  }

  async lookupPrice(pid: string, regionId: string): Promise<number | null> {
    const config = this.bloomreachConfigs[regionId];
    if (!config) return null;
    return bloomreachLookup(pid, config);
  }

  transformUrl(url: URL, fromRegion: string, toRegion: string): string {
    const fromSite = this.sites[fromRegion];
    const toSite = this.sites[toRegion];
    if (!fromSite || !toSite) {
      throw new Error(`Unknown region: ${fromRegion} or ${toRegion}`);
    }

    const altDomain = toSite.hostnames[0];

    // Handle path prefix differences between regions
    let path = url.pathname;

    // Remove the source region's path prefix if present
    if (fromSite.pathPrefix && path.startsWith(fromSite.pathPrefix)) {
      path = path.slice(fromSite.pathPrefix.length) || '/';
    }

    // Add the target region's path prefix
    if (toSite.pathPrefix) {
      path = toSite.pathPrefix + path;
    }

    return `${url.protocol}//${altDomain}${path}${url.search}${url.hash}`;
  }
}
