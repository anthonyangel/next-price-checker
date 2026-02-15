// Shared type definitions for Next Price Checker extension
// ---------------------------------------------------------

/**
 * Represents the result of a price comparison between two sites.
 */
export interface PriceComparisonVerdict {
  verdict: string;
  highlight: string;
  diff: number;
  percDiff: number;
  altPriceConverted: number;
}

/**
 * Represents exchange rate data with metadata.
 */
export interface ExchangeRateData {
  rate: number;
  timestamp: number | null;
  fallback: boolean;
}

/**
 * Message sent to scan a listing page.
 */
export interface ScanListingPageMessage {
  action: 'scanListingPage';
}

/**
 * Message sent to request an alternate price from the background script.
 * The background uses the Bloomreach API (no tabs needed).
 */
export interface AlternatePriceMessage {
  action: 'getAlternatePrice';
  url: string;
}

/**
 * Message sent to request alternate prices for multiple products at once.
 * Used by catalog pages to avoid N individual requests.
 */
export interface AlternateCatalogMessage {
  action: 'getAlternateCatalogPrices';
  urls: string[];
}

/**
 * Summary of catalog price comparisons, sent from content script to popup.
 */
export interface CatalogSavingItem {
  pid: string;
  saving: string;
  percDiff: number;
  url: string;
}

export interface CatalogSummary {
  total: number;
  compared: number;
  cheaperHere: number;
  cheaperOnAlt: number;
  same: number;
  /** Top savings on the alternate site, sorted by percDiff descending. */
  topSavingsAlt: CatalogSavingItem[];
  /** Top savings on the current site, sorted by percDiff descending. */
  topSavingsHere: CatalogSavingItem[];
}

/**
 * Per-region price entry within a cached product.
 */
export interface RegionPriceEntry {
  price: number;
  timestamp: number;
}

/**
 * Cached price data for a product, keyed by region ID.
 * e.g. { uk: { price: 26, timestamp: ... }, il: { price: 90, timestamp: ... } }
 */
export type PriceCacheItem = Partial<Record<string, RegionPriceEntry>>;
