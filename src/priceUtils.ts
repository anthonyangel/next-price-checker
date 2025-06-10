import { getSiteMeta } from './siteMeta';
import type { PriceComparisonVerdict } from './types';

/**
 * Parses a price string (e.g. '£12.99' or '₪45.00') and returns a number, or null if invalid.
 * @param raw The raw price string
 * @returns The parsed price as a number, or null
 */
export function parsePrice(raw: string | null): number | null {
  if (!raw) return null;
  const parsed = parseFloat(raw.replace(/[^\d.]/g, ''));
  return isNaN(parsed) ? null : parsed;
}

/**
 * Compares prices between current and alternate site, returning verdict and details.
 * @param currentPrice The current site price (string)
 * @param altPrice The alternate site price (string)
 * @param isUK Whether the current site is UK
 * @param rate The GBP/ILS exchange rate
 * @returns PriceComparisonVerdict object
 */
export async function getPriceComparisonVerdict({
  currentPrice,
  altPrice,
  isUK,
  rate,
}: {
  currentPrice: string;
  altPrice: string;
  isUK: boolean;
  rate: number;
}): Promise<PriceComparisonVerdict> {
  const { altFlag, currentCurrency } = getSiteMeta(isUK ? 'www.next.co.uk' : 'www.next.co.il');
  let verdict = '';
  let highlight = '';
  let altPriceDisplay = '';
  let diff = 0;
  let percDiff = 0;
  let altPriceConverted = 0;
  const currentPriceNum = parseFloat(currentPrice.replace(/[^\d.]/g, ''));
  const altPriceNum = parseFloat(altPrice.replace(/[^\d.]/g, ''));
  if (!isNaN(currentPriceNum) && !isNaN(altPriceNum)) {
    if (isUK) {
      altPriceConverted = altPriceNum / rate;
      altPriceDisplay = `${altFlag} ${altPrice}`;
      diff = currentPriceNum - altPriceConverted;
    } else {
      altPriceConverted = altPriceNum * rate;
      altPriceDisplay = `${altFlag} ${altPrice}`;
      diff = currentPriceNum - altPriceConverted;
    }
    percDiff = (Math.abs(diff) / ((currentPriceNum + altPriceConverted) / 2)) * 100;
    if (Math.abs(diff) > 0.01) {
      if (diff > 0) {
        verdict = `${altFlag} more expensive by ${currentCurrency}${Math.abs(diff).toFixed(2)} (${percDiff.toFixed(1)}%)`;
        highlight = 'color: green;';
      } else {
        verdict = `${altFlag} cheaper by ${currentCurrency}${Math.abs(diff).toFixed(2)} (${percDiff.toFixed(1)}%)`;
        highlight = 'color: red;';
      }
    } else {
      verdict = 'Prices are about the same';
      highlight = '';
    }
  } else {
    altPriceDisplay = `<span style=\"color: gray;\">Could not fetch alternate price</span>`;
    verdict = '';
    highlight = '';
  }
  return { verdict, highlight, altPriceDisplay, diff, percDiff, altPriceConverted };
}
