// Constants for Next Price Checker
// -------------------------------

export const CACHE_KEY_PREFIX = 'exchangeRate';
export const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Fallback rates keyed by "FROM:TO" currency pair */
export const FALLBACK_RATES: Record<string, number> = {
  'GBP:ILS': 4.3,
};

/** Legacy cache key — reads/writes to this key for GBP:ILS compatibility with older cached data. */
export const CACHE_KEY = 'exchangeRateData';
/** Default fallback rate when a currency pair isn't in FALLBACK_RATES. */
export const FALLBACK_RATE = 4.3;

/** Price cache TTL — how long fetched alternate prices stay valid */
export const PRICE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
export const PRICE_CACHE_KEY_PREFIX = 'npc:price:';
