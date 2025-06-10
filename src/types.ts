// Shared type definitions for Next Price Checker extension
// ---------------------------------------------------------

/**
 * Represents a product with a link and price.
 */
export interface Product {
  link: string;
  price: string;
}

/**
 * Represents the result of a price comparison between two sites.
 */
export interface PriceComparisonVerdict {
  verdict: string;
  highlight: string;
  altPriceDisplay: string;
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
 */
export interface AlternatePriceMessage {
  action: 'getAlternatePrice';
  url: string;
  priceSelector: string;
}
