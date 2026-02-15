/**
 * Returns site/currency/flag metadata based on hostname.
 * Uses the retailer registry + region config to derive all values.
 *
 * @param hostname The hostname (e.g. www.next.co.uk or www.next.co.il)
 * @returns An object with isUK, currentFlag, altFlag, currentCurrency, altCurrency
 */
import { getRetailerAndRegion } from './core/registry';
import { getRegion } from './core/regions';

export function getSiteMeta(hostname: string) {
  const match = getRetailerAndRegion(hostname);

  if (match) {
    const { retailer, regionId } = match;
    const currentRegion = getRegion(regionId);
    // Find the alternate region (the other region for this retailer)
    const altRegionId = retailer.getAlternateRegionId(regionId);
    const altRegion = altRegionId ? getRegion(altRegionId) : currentRegion;

    return {
      isUK: regionId === 'uk',
      currentFlag: currentRegion.flag,
      altFlag: altRegion.flag,
      currentCurrency: currentRegion.currencySymbol,
      altCurrency: altRegion.currencySymbol,
    };
  }

  throw new Error(`No retailer found for hostname: ${hostname}`);
}
