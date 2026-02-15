/**
 * Retailer registry — looks up the correct retailer by hostname.
 */

import type { AbstractRetailer } from './AbstractRetailer';
import { NextRetailer } from '../retailers/next/NextRetailer';

/** All registered retailers */
const retailers: AbstractRetailer[] = [new NextRetailer()];

/**
 * Find the retailer and region for a given hostname.
 * Returns null if no retailer matches.
 */
export function getRetailerAndRegion(
  hostname: string
): { retailer: AbstractRetailer; regionId: string } | null {
  for (const retailer of retailers) {
    const regionId = retailer.getRegionForHostname(hostname);
    if (regionId !== null) {
      return { retailer, regionId };
    }
  }
  return null;
}
