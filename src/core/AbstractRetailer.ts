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
   * Transform a URL from one region to another.
   * e.g. next.co.uk/style/123 → next.co.il/en/style/123
   */
  abstract transformUrl(url: URL, fromRegion: string, toRegion: string): string;

  /**
   * Determine which region a hostname belongs to, or null if not this retailer.
   */
  getRegionForHostname(hostname: string): string | null {
    for (const [regionId, site] of Object.entries(this.sites)) {
      if (site.hostnames.some((h) => hostname === h || hostname.endsWith(h))) {
        return regionId;
      }
    }
    return null;
  }

  /**
   * Check if a URL is a catalog/listing page for this retailer.
   */
  isCatalogPage(url: URL): boolean {
    const regionId = this.getRegionForHostname(url.hostname);
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
   */
  abstract lookupPrice(pid: string, regionId: string): Promise<number | null>;

  /**
   * Look up prices for multiple PIDs in parallel.
   * Default implementation calls lookupPrice individually;
   * retailers can override for bulk APIs.
   */
  async lookupPrices(pids: string[], regionId: string): Promise<Record<string, number>> {
    const results: Record<string, number> = {};
    const settled = await Promise.allSettled(
      pids.map(async (pid) => {
        const price = await this.lookupPrice(pid, regionId);
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
