import { getSiteMeta } from './siteMeta';
import type { PriceComparisonVerdict } from './types';

/**
 * Parses a price string (e.g. '£12.99' or '₪45.00') and returns a number, or null if invalid.
 * @param raw The raw price string
 * @returns The parsed price as a number, or null
 */
export function parsePrice(raw: string | null): number | null {
  if (!raw) return null;
  // Handle price ranges like "₪45.00 - ₪60.00" by taking the first price
  const firstPrice = raw.split(/\s*[-–]\s*/)[0];
  const parsed = parseFloat(firstPrice.replace(/[^\d.]/g, ''));
  return isNaN(parsed) ? null : parsed;
}

/**
 * Compares prices between current and alternate site, returning verdict and details.
 * @param currentPrice The current site price (string)
 * @param altPrice The alternate site price (string)
 * @param isUK Whether the current site is UK
 * @param rate The GBP/ILS exchange rate
 * @param hostname The current site hostname (used for metadata lookup)
 * @returns PriceComparisonVerdict object
 */
export async function getPriceComparisonVerdict({
  currentPrice,
  altPrice,
  isUK,
  rate,
  hostname,
}: {
  currentPrice: string;
  altPrice: string;
  isUK: boolean;
  rate: number;
  hostname: string;
}): Promise<PriceComparisonVerdict> {
  const { altFlag, currentCurrency } = getSiteMeta(hostname);
  let verdict = '';
  let highlight = '';
  let diff = 0;
  let percDiff = 0;
  let altPriceConverted = 0;
  const currentPriceNum = parsePrice(currentPrice);
  const altPriceNum = parsePrice(altPrice);
  if (currentPriceNum !== null && altPriceNum !== null) {
    altPriceConverted = isUK ? altPriceNum / rate : altPriceNum * rate;
    diff = currentPriceNum - altPriceConverted;
    percDiff = (Math.abs(diff) / ((currentPriceNum + altPriceConverted) / 2)) * 100;
    if (Math.abs(diff) > 0.01) {
      if (diff > 0) {
        verdict = `Save ${currentCurrency}${Math.abs(diff).toFixed(2)} (${percDiff.toFixed(1)}%) on ${altFlag} site`;
        highlight = 'color: #e67e00;';
      } else {
        verdict = `\u2705 Cheaper here by ${currentCurrency}${Math.abs(diff).toFixed(2)} (${percDiff.toFixed(1)}%)`;
        highlight = 'color: #2e7d32;';
      }
    } else {
      verdict = 'Same price on both sites';
      highlight = 'color: #888;';
    }
  }
  return { verdict, highlight, diff, percDiff, altPriceConverted };
}
