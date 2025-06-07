const CACHE_KEY = 'exchangeRateData';
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24h
const FALLBACK_RATE = 4.6;

export interface ExchangeRateData {
  rate: number;
  timestamp: number | null;
  fallback: boolean;
}

export async function fetchExchangeRate(): Promise<ExchangeRateData> {
  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=GBP&to=ILS');
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const data = await res.json();
    if (!data.rates || !data.rates.ILS) throw new Error('Invalid data from exchange API');
    console.log('[exchangeRate.ts] Fetched exchange rate:', data.rates.ILS);

    const cacheData: ExchangeRateData = {
      rate: data.rates.ILS,
      timestamp: Date.now(),
      fallback: false,
    };
    await chrome.storage.local.set({ [CACHE_KEY]: cacheData });
    return cacheData;
  } catch (e) {
    console.error('[exchangeRate.ts] Error fetching exchange rate:', e);

    const cached = await chrome.storage.local.get(CACHE_KEY);
    if (cached && cached[CACHE_KEY]) {
      console.log('[exchangeRate.ts] Using cached exchange rate');
      return cached[CACHE_KEY] as ExchangeRateData;
    }

    return {
      rate: FALLBACK_RATE,
      timestamp: null,
      fallback: true,
    };
  }
}

export async function getCachedOrFetchRate(): Promise<ExchangeRateData> {
  const data = await chrome.storage.local.get(CACHE_KEY);
  if (data && data[CACHE_KEY]) {
    const cached = data[CACHE_KEY] as ExchangeRateData;
    if ((Date.now() - (cached.timestamp ?? 0)) < CACHE_DURATION_MS) {
      return cached;
    }
  }
  return fetchExchangeRate();
}

export function formatTimestamp(ts: number | null): string {
  if (!ts) return 'never';
  const d = new Date(ts);
  return d.toLocaleString();
}
