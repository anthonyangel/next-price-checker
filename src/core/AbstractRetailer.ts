/**
 * Base class that all retailer implementations extend.
 * Each retailer defines its sites, selectors, and URL transformation logic.
 */

import { warn } from '../logger';

export interface RetailerSite {
  hostnames: string[];
  pathPrefix?: string;
  catalogPathPattern: RegExp;
}

export abstract class AbstractRetailer {
  /** Unique retailer identifier (e.g. 'next') */
  abstract readonly id: string;

  /** Human-readable retailer name (e.g. 'Next') */
  abstract readonly name: string;

  /**
   * Map of region ID → site config.
   * e.g. { uk: { hostnames: ['www.next.co.uk'], catalogPathPattern: /\/shop/ }, ... }
   */
  abstract readonly sites: Record<string, RetailerSite>;

  /** Whether this retailer supports product page price extraction */
  abstract readonly supportsProductPage: boolean;

  /** Whether this retailer supports catalog/listing page extraction */
  abstract readonly supportsCatalogPage: boolean;

  /**
   * CSS selector for the price element on a product page.
   * Used by background.ts tab extraction and content script.
   */
  abstract readonly priceSelector: string;

  /**
   * CSS selector for the product container on catalog/listing pages.
   * Returns the container whose children are individual product cards.
   */
  abstract readonly productContainerSelector: string;

  /** Fallback selectors for the product container */
  abstract readonly productContainerFallbackSelectors: string[];

  /**
   * Fallback CSS selectors for price extraction on catalog/listing pages.
   * Tried in order when priceSelector doesn't match a product card element.
   * Override in subclasses where the PDP price selector differs from catalog.
   */
  readonly catalogPriceFallbackSelectors: string[] = [];

  /**
   * Transform a URL from one region to another.
   * e.g. next.co.uk/style/123 → next.co.il/en/style/123
   */
  abstract transformUrl(url: URL, fromRegion: string, toRegion: string): string;

  /**
   * Determine which region a URL belongs to, or null if not this retailer.
   * Matches by hostname first. When multiple regions share a hostname,
   * uses pathPrefix to disambiguate (e.g. Zara UK /uk/ vs IL /il/).
   * When a hostname uniquely identifies a region, pathPrefix is not required.
   */
  getRegionForUrl(url: URL): string | null {
    // Collect all regions whose hostname matches
    const candidates: [string, RetailerSite][] = [];
    for (const [regionId, site] of Object.entries(this.sites)) {
      const hostnameMatch = site.hostnames.some(
        (h) => url.hostname === h || url.hostname.endsWith(h)
      );
      if (hostnameMatch) candidates.push([regionId, site]);
    }

    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0][0];

    // Multiple regions share this hostname — use pathPrefix to disambiguate
    for (const [regionId, site] of candidates) {
      if (site.pathPrefix && url.pathname.startsWith(site.pathPrefix)) {
        return regionId;
      }
    }
    return null;
  }

  /**
   * Check if a URL is a catalog/listing page for this retailer.
   */
  isCatalogPage(url: URL): boolean {
    const regionId = this.getRegionForUrl(url);
    if (!regionId) return false;
    return this.sites[regionId].catalogPathPattern.test(url.pathname);
  }

  /**
   * Extract a product ID from a URL for API-based price lookup.
   * Returns null if the URL doesn't contain a recognizable product ID.
   * Subclasses override this if they support direct API lookups.
   */
  extractProductId(_url: URL): string | null {
    return null;
  }

  /**
   * Extract a product ID from a catalog page DOM element (e.g., data attributes).
   * Used as fallback when product cards don't have `<a href>` (SPA retailers).
   * Returns null by default; override in subclasses like Zara.
   */
  extractProductIdFromElement(_element: Element): string | null {
    return null;
  }

  /**
   * Construct a product page URL from a PID and region ID.
   * Used for SPA retailers where catalog DOM elements don't have hrefs.
   * Returns null by default; override in subclasses that need it.
   */
  constructProductUrl(_pid: string, _regionId: string): string | null {
    return null;
  }

  /**
   * Get the alternate region ID for a given region.
   * Warns if the retailer has more than 2 regions (not yet supported).
   */
  getAlternateRegionId(currentRegionId: string): string | null {
    const ids = Object.keys(this.sites).filter((id) => id !== currentRegionId);
    if (ids.length !== 1) {
      warn(`[${this.id}] Expected exactly 1 alternate region, found ${ids.length}`);
    }
    return ids[0] ?? null;
  }

  /**
   * Look up a product's price by PID and region via the retailer's API.
   * Each retailer implements this with its own provider (e.g. Bloomreach).
   *
   * @param pid Product identifier
   * @param regionId Target region (e.g. 'uk', 'il')
   * @param productUrl Optional full product URL — used by HTML-scraping
   *   providers that need the real URL (with slug) instead of constructing one.
   */
  abstract lookupPrice(pid: string, regionId: string, productUrl?: string): Promise<number | null>;

  /**
   * Look up prices for multiple PIDs in parallel.
   * Default implementation calls lookupPrice individually;
   * retailers can override for bulk APIs.
   *
   * @param pidToUrl Optional mapping of PID → full product URL, passed
   *   through to lookupPrice for HTML-scraping providers.
   * @param catalogUrl Optional alternate catalog page URL — SPA retailers
   *   (like Zara) can fetch this once to get all prices instead of hitting
   *   individual product pages.
   */
  async lookupPrices(
    pids: string[],
    regionId: string,
    pidToUrl?: Record<string, string>,
    _catalogUrl?: string
  ): Promise<Record<string, number>> {
    const results: Record<string, number> = {};
    const settled = await Promise.allSettled(
      pids.map(async (pid) => {
        const price = await this.lookupPrice(pid, regionId, pidToUrl?.[pid]);
        if (price !== null) results[pid] = price;
      })
    );
    for (const r of settled) {
      if (r.status === 'rejected') {
        warn('[AbstractRetailer] lookupPrices rejected:', r.reason);
      }
    }
    return results;
  }
}
