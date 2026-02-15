/**
 * Retailer registry — looks up the correct retailer by URL.
 */

import type { AbstractRetailer } from './AbstractRetailer';
import { NextRetailer } from '../retailers/next/NextRetailer';
import { ZaraRetailer } from '../retailers/zara/ZaraRetailer';
import { HMRetailer } from '../retailers/hm/HMRetailer';

/** All registered retailers */
const retailers: AbstractRetailer[] = [new NextRetailer(), new ZaraRetailer(), new HMRetailer()];

/**
 * Find the retailer and region for a given URL.
 * Returns null if no retailer matches.
 */
export function getRetailerAndRegion(
  url: URL
): { retailer: AbstractRetailer; regionId: string } | null {
  for (const retailer of retailers) {
    const regionId = retailer.getRegionForUrl(url);
    if (regionId !== null) {
      return { retailer, regionId };
    }
  }
  return null;
}
