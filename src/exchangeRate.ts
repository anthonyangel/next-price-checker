import { log, warn, error } from './logger';
import { getFromStorage, setToStorage } from './storageUtils';
import { CACHE_KEY, CACHE_DURATION_MS, FALLBACK_RATE } from './constants';
import type { ExchangeRateData } from './types';

/**
 * Fetches the current GBP/ILS exchange rate from the API, with fallback and caching.
 * @returns ExchangeRateData object with rate, timestamp, and fallback flag
 */
export async function fetchExchangeRate(): Promise<ExchangeRateData> {
  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=GBP&to=ILS');
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const data = await res.json();
    if (!data.rates || !data.rates.ILS) throw new Error('Invalid data from exchange API');
    log('[exchangeRate.ts] Fetched exchange rate:', data.rates.ILS);

    const cacheData: ExchangeRateData = {
      rate: data.rates.ILS,
      timestamp: Date.now(),
      fallback: false,
    };
    await setToStorage(CACHE_KEY, cacheData);
    return cacheData;
  } catch (e) {
    error('[exchangeRate.ts] Error fetching exchange rate:', e);
    const cached = await getFromStorage<ExchangeRateData>(CACHE_KEY);
    if (cached) {
      warn('[exchangeRate.ts] Using cached exchange rate');
      return cached;
    }
    return {
      rate: FALLBACK_RATE,
      timestamp: null,
      fallback: true,
    };
  }
}

/**
 * Gets the cached exchange rate if fresh, otherwise fetches a new one.
 * @returns ExchangeRateData object
 */
export async function getCachedOrFetchRate(): Promise<ExchangeRateData> {
  const cached = await getFromStorage<ExchangeRateData>(CACHE_KEY);
  if (cached && Date.now() - (cached.timestamp ?? 0) < CACHE_DURATION_MS) {
    return cached;
  }
  return fetchExchangeRate();
}

/**
 * Formats a timestamp (ms) as a local date/time string, or 'never' if null.
 * @param ts Timestamp in ms
 * @returns Local date/time string
 */
export function formatTimestamp(ts: number | null): string {
  if (!ts) return 'never';
  const d = new Date(ts);
  return d.toLocaleString();
}
