/**
 * Mango price lookup provider.
 *
 * Uses Mango's public REST API at online-orchestrator.mango.com to fetch
 * product prices. No auth keys required. The same endpoint serves both
 * UK and IL prices — just swap the countryIso parameter.
 */

import { log, warn } from '../logger';

const API_BASE = 'https://online-orchestrator.mango.com/v3/prices/products';

/** Map internal region IDs to Mango's countryIso codes. */
const REGION_TO_COUNTRY: Record<string, string> = {
  uk: 'GB',
  il: 'IL',
};

interface MangoPriceEntry {
  price: number;
  previousPrices?: { originalShop?: number };
  discountRate?: number;
  type?: string;
}

/**
 * Look up a product's price via the Mango price API.
 *
 * The API returns prices keyed by 2-digit color code (e.g. "99", "16").
 * When a color code is provided, we look up that specific entry; otherwise
 * we take the first available color's price.
 *
 * @param pid 8-digit Mango product ID
 * @param regionId Target region ('uk' or 'il')
 * @param colorCode Optional 2-digit color code from the URL's ?c= parameter
 * @returns The price as a number, or null if not found
 */
export async function lookupPrice(
  pid: string,
  regionId: string,
  colorCode?: string
): Promise<number | null> {
  const countryIso = REGION_TO_COUNTRY[regionId];
  if (!countryIso) {
    warn(`[mango] Unknown region: ${regionId}`);
    return null;
  }

  const params = new URLSearchParams({
    channelId: 'shop',
    countryIso,
    productId: pid,
  });

  try {
    const resp = await fetch(`${API_BASE}?${params}`);
    if (!resp.ok) {
      warn(`[mango] HTTP ${resp.status} for pid=${pid}, region=${regionId}`);
      return null;
    }

    const data: Record<string, MangoPriceEntry> = await resp.json();
    return extractPrice(data, pid, colorCode);
  } catch (err) {
    warn('[mango] Fetch error:', err);
    return null;
  }
}

/**
 * Extract the price from the API response, preferring the specified color.
 */
function extractPrice(
  data: Record<string, MangoPriceEntry>,
  pid: string,
  colorCode?: string
): number | null {
  const keys = Object.keys(data);
  if (keys.length === 0) {
    log(`[mango] No price entries for pid=${pid}`);
    return null;
  }

  // Prefer the requested color code if present in the response
  let entry: MangoPriceEntry | undefined;
  if (colorCode && data[colorCode]) {
    entry = data[colorCode];
  } else {
    entry = data[keys[0]];
  }

  if (!entry || typeof entry.price !== 'number') {
    log(`[mango] No valid price for pid=${pid}`);
    return null;
  }

  log(`[mango] pid=${pid} -> price=${entry.price}`);
  return entry.price;
}
