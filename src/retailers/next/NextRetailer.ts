/**
 * Next retailer implementation — supports next.co.uk and next.co.il.
 */

import { AbstractRetailer, type RetailerSite } from '../../core/AbstractRetailer';
import {
  lookupPrice as bloomreachLookup,
  type BloomreachRegionConfig,
} from '../../providers/bloomreach';
import { scrapeProductPagePrice } from '../../providers/nextPageScraper';

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

  readonly priceSelector = '[data-testid="product-now-price"] span:last-child';

  readonly productContainerSelector =
    '#plp > div.MuiGrid-root.MuiGrid-container.plp-13gwbx > div.MuiGrid-root.MuiGrid-container.plp-product-grid-wrapper.plp-wq7tal > div';

  readonly productContainerFallbackSelectors = [
    '[data-testid="product-list"]',
    '.plp-product-grid-wrapper > div',
  ];

  /**
   * Catalog page price fallbacks — the PDP priceSelector doesn't match
   * product cards on listing pages. Sale cards use a <div> with
   * data-testid="product_summary_sale_price" for the current price.
   */
  override readonly catalogPriceFallbackSelectors = [
    '[data-testid="product_summary_sale_price"]',
    '[data-testid="product-now-price"]',
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
   * Fallback price extraction from the current page DOM.
   * Handles sale pages where the primary selector may not match,
   * and falls back to JSON-LD structured data.
   */
  override extractPriceFromPage(_url: URL): string | null {
    // Try legacy non-sale selector
    const legacyEl = document.querySelector(
      '#pdp-item-title .MuiTypography-h1 span'
    ) as HTMLElement | null;
    if (legacyEl?.textContent) {
      const text = legacyEl.textContent.trim();
      if (/[\d.]/.test(text)) return text;
    }

    // Try JSON-LD structured data from DOM
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    for (const script of scripts) {
      try {
        const data = JSON.parse(script.textContent ?? '');
        if (data?.['@type'] === 'Product' && data?.offers) {
          const offers = Array.isArray(data.offers) ? data.offers[0] : data.offers;
          const price = offers?.price;
          if (price !== undefined && price !== null) {
            const num = parseFloat(String(price));
            if (!isNaN(num) && num > 0) return String(num);
          }
        }
      } catch {
        // Invalid JSON, skip
      }
    }

    return null;
  }

  /**
   * Extract product ID (PID) from a Next product URL.
   * URL format: /style/{styleCode}/{pid} or /en/style/{styleCode}/{pid}
   */
  extractProductId(url: URL): string | null {
    const match = url.pathname.match(/\/style\/[^/]+\/([^/#?]+)/);
    return match ? match[1] : null;
  }

  async lookupPrice(pid: string, regionId: string, productUrl?: string): Promise<number | null> {
    const config = this.bloomreachConfigs[regionId];
    if (!config) return null;

    const price = await bloomreachLookup(pid, config);
    if (price !== null) return price;

    // Fallback: Bloomreach doesn't index all products (e.g. sale/clearance items).
    // Try fetching the product page directly and parsing structured data.
    if (productUrl) {
      return scrapeProductPagePrice(productUrl);
    }

    return null;
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
