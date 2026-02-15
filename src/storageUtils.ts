// Centralized Chrome storage utilities for Next Price Checker
// ----------------------------------------------------------

/**
 * Gets a value from chrome.storage.local by key.
 * @param key The storage key
 * @returns The value, or undefined if not found
 */
export async function getFromStorage<T>(key: string): Promise<T | undefined> {
  const data = await chrome.storage.local.get(key);
  return data[key] as T | undefined;
}

/**
 * Sets a value in chrome.storage.local by key.
 * @param key The storage key
 * @param value The value to store
 */
export async function setToStorage<T>(key: string, value: T): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

import { PRICE_CACHE_KEY_PREFIX, PRICE_CACHE_TTL_MS } from './constants';
import type { PriceCacheItem, RegionPriceEntry } from './types';

import { log } from './logger';

/**
 * Gets a cached price for a product in a specific region, if it exists and is fresh.
 * @param retailerId Retailer identifier (e.g. 'next', 'zara') to scope the cache key.
 */
export async function getCachedPrice(
  retailerId: string,
  pid: string,
  regionId: string
): Promise<RegionPriceEntry | null> {
  const key = `${PRICE_CACHE_KEY_PREFIX}${retailerId}:${pid}`;
  const item = await getFromStorage<PriceCacheItem>(key);

  if (!item) return null;

  const entry = item[regionId];
  if (!entry) return null;

  // Check TTL
  if (Date.now() - entry.timestamp > PRICE_CACHE_TTL_MS) {
    log(`[storageUtils] Cache expired for ${pid}:${regionId}`);
    // Remove just this region entry; keep others
    delete item[regionId];
    if (Object.keys(item).length === 0) {
      await chrome.storage.local.remove(key);
    } else {
      await setToStorage(key, item);
    }
    return null;
  }

  log(`[storageUtils] Cache HIT for ${pid}:${regionId} → ${entry.price}`);
  return entry;
}

/**
 * Per-key write locks to prevent read-modify-write races when
 * concurrent calls cache different regions for the same PID.
 */
const writeLocks = new Map<string, Promise<void>>();

/**
 * Caches a price for a product in a specific region.
 * Merges into the existing cache entry so both regions coexist.
 * Serialized per key to prevent concurrent writes from losing data.
 * @param retailerId Retailer identifier (e.g. 'next', 'zara') to scope the cache key.
 */
export async function setCachedPrice(
  retailerId: string,
  pid: string,
  regionId: string,
  price: number
): Promise<void> {
  const key = `${PRICE_CACHE_KEY_PREFIX}${retailerId}:${pid}`;
  const prev = writeLocks.get(key) ?? Promise.resolve();
  const op = prev.then(async () => {
    const existing = (await getFromStorage<PriceCacheItem>(key)) ?? {};
    existing[regionId] = { price, timestamp: Date.now() };
    await setToStorage(key, existing);
    log(`[storageUtils] Cache WRITE for ${pid.toUpperCase()}:${regionId} → ${price}`);
  });
  writeLocks.set(
    key,
    op.catch(() => {})
  );
  await op;
}
