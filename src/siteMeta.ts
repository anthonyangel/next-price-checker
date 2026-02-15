/**
 * Returns site/currency/flag metadata based on a URL.
 * Uses the retailer registry + region config to derive all values.
 *
 * @param url The page URL (used to look up the retailer and region)
 * @returns An object with isUK, currentFlag, altFlag, currentCurrency, altCurrency
 */
import { getRetailerAndRegion } from './core/registry';
import { getRegion } from './core/regions';

export function getSiteMeta(url: URL) {
  const match = getRetailerAndRegion(url);

  if (match) {
    const { retailer, regionId } = match;
    const currentRegion = getRegion(regionId);
    // Find the alternate region (the other region for this retailer)
    const altRegionId = retailer.getAlternateRegionId(regionId);
    const altRegion = altRegionId ? getRegion(altRegionId) : currentRegion;

    // For shared-hostname retailers (e.g. Zara), use "Zara UK" / "Zara Israel"
    // instead of the hostname which would be identical for both regions.
    const currentHostname = retailer.sites[regionId]?.hostnames[0]?.replace('www.', '') ?? '';
    const altHostname =
      (altRegionId ? retailer.sites[altRegionId]?.hostnames[0]?.replace('www.', '') : '') ?? '';
    const sharedHostname = currentHostname === altHostname;

    return {
      isUK: regionId === 'uk',
      currentFlag: currentRegion.flag,
      altFlag: altRegion.flag,
      currentCurrency: currentRegion.currencySymbol,
      altCurrency: altRegion.currencySymbol,
      currentSiteName: sharedHostname ? `${retailer.name} ${currentRegion.name}` : currentHostname,
      altSiteName: sharedHostname ? `${retailer.name} ${altRegion.name}` : altHostname,
    };
  }

  throw new Error(`No retailer found for URL: ${url.hostname}`);
}
