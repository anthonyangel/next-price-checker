/**
 * Given a product URL on a supported retailer, returns the equivalent URL on the alternate site.
 * Uses the retailer registry to handle URL transformations generically.
 *
 * @param currentUrl The current product URL (as a URL object)
 * @returns The alternate site product URL as a string
 */
import { getRetailerAndRegion } from './core/registry';

export function getAlternateUrl(currentUrl: URL): string {
  const match = getRetailerAndRegion(currentUrl);

  if (match) {
    const { retailer, regionId } = match;
    const altRegionId = retailer.getAlternateRegionId(regionId);
    if (altRegionId) {
      return retailer.transformUrl(currentUrl, regionId, altRegionId);
    }
  }

  throw new Error(`No retailer found for hostname: ${currentUrl.hostname}`);
}
