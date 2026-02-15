import { log, warn, error } from './logger';
import { getFromStorage, setToStorage } from './storageUtils';
import {
  CACHE_KEY,
  CACHE_KEY_PREFIX,
  CACHE_DURATION_MS,
  FALLBACK_RATE,
  FALLBACK_RATES,
} from './constants';
import type { ExchangeRateData } from './types';
import type { CurrencyCode } from './core/regions';

function cacheKeyForPair(from: CurrencyCode, to: CurrencyCode): string {
  return `${CACHE_KEY_PREFIX}_${from}_${to}`;
}

/**
 * Fetches an exchange rate for a currency pair from the API, with fallback and caching.
 * Defaults to GBP→ILS for backwards compatibility.
 */
export async function fetchExchangeRate(
  from: CurrencyCode = 'GBP',
  to: CurrencyCode = 'ILS'
): Promise<ExchangeRateData> {
  const key = cacheKeyForPair(from, to);
  const fallbackRate = FALLBACK_RATES[`${from}:${to}`] ?? FALLBACK_RATE;

  try {
    const res = await fetch(`https://api.frankfurter.app/latest?from=${from}&to=${to}`);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const data = await res.json();
    if (!data.rates || !data.rates[to]) throw new Error('Invalid data from exchange API');
    log(`[exchangeRate.ts] Fetched ${from}→${to} rate:`, data.rates[to]);

    const cacheData: ExchangeRateData = {
      rate: data.rates[to],
      timestamp: Date.now(),
      fallback: false,
    };
    await setToStorage(key, cacheData);
    // Also write to legacy key for backwards compat
    if (from === 'GBP' && to === 'ILS') {
      await setToStorage(CACHE_KEY, cacheData);
    }
    return cacheData;
  } catch (e) {
    error(`[exchangeRate.ts] Error fetching ${from}→${to} rate:`, e);
    const cached = await getFromStorage<ExchangeRateData>(key);
    if (cached) {
      warn('[exchangeRate.ts] Using cached exchange rate');
      return cached;
    }
    // Try legacy cache key for GBP→ILS
    if (from === 'GBP' && to === 'ILS') {
      const legacyCached = await getFromStorage<ExchangeRateData>(CACHE_KEY);
      if (legacyCached) return legacyCached;
    }
    return { rate: fallbackRate, timestamp: null, fallback: true };
  }
}

/**
 * Gets the cached exchange rate if fresh, otherwise fetches a new one.
 * Defaults to GBP→ILS for backwards compatibility.
 */
export async function getCachedOrFetchRate(
  from: CurrencyCode = 'GBP',
  to: CurrencyCode = 'ILS'
): Promise<ExchangeRateData> {
  const key = cacheKeyForPair(from, to);
  const cached = await getFromStorage<ExchangeRateData>(key);
  if (cached && Date.now() - (cached.timestamp ?? 0) < CACHE_DURATION_MS) {
    return cached;
  }
  // Check legacy key for GBP→ILS
  if (from === 'GBP' && to === 'ILS') {
    const legacyCached = await getFromStorage<ExchangeRateData>(CACHE_KEY);
    if (legacyCached && Date.now() - (legacyCached.timestamp ?? 0) < CACHE_DURATION_MS) {
      return legacyCached;
    }
  }
  return fetchExchangeRate(from, to);
}

/**
 * Formats a timestamp (ms) as a local date/time string, or 'never' if null.
 */
export function formatTimestamp(ts: number | null): string {
  if (!ts) return 'never';
  const d = new Date(ts);
  return d.toLocaleString();
}
