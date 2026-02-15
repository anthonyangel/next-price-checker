/**
 * Global region definitions — currency, flag, and display info.
 * Adding a new country is a one-line addition here.
 * Retailers reference region IDs, never duplicate this information.
 */

export type CurrencyCode = 'GBP' | 'ILS';

export interface Region {
  id: string;
  name: string;
  flag: string;
  currency: CurrencyCode;
  currencySymbol: string;
}

export const regions: Record<string, Region> = {
  uk: {
    id: 'uk',
    name: 'United Kingdom',
    flag: '🇬🇧',
    currency: 'GBP',
    currencySymbol: '£',
  },
  il: {
    id: 'il',
    name: 'Israel',
    flag: '🇮🇱',
    currency: 'ILS',
    currencySymbol: '₪',
  },
};

/**
 * Look up a region by its ID.
 * @throws if the region ID is not found
 */
export function getRegion(regionId: string): Region {
  const region = regions[regionId];
  if (!region) throw new Error(`Unknown region: ${regionId}`);
  return region;
}
