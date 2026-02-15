import { vi, beforeEach } from 'vitest';
import { CACHE_KEY, FALLBACK_RATES, CACHE_DURATION_MS } from '../src/constants';
import type { ExchangeRateData } from '../src/types';

vi.mock('../src/storageUtils', () => ({
  getFromStorage: vi.fn(),
  setToStorage: vi.fn(),
}));

vi.mock('../src/logger', () => ({
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

import { fetchExchangeRate, getCachedOrFetchRate, formatTimestamp } from '../src/exchangeRate';
import { getFromStorage, setToStorage } from '../src/storageUtils';

const mockGetFromStorage = vi.mocked(getFromStorage);
const mockSetToStorage = vi.mocked(setToStorage);

beforeEach(() => {
  vi.restoreAllMocks();
  mockGetFromStorage.mockReset();
  mockSetToStorage.mockReset();
});

describe('fetchExchangeRate', () => {
  it('fetches rate from API and caches result', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ rates: { ILS: 4.7 } }),
    });
    vi.stubGlobal('fetch', mockFetch);
    mockGetFromStorage.mockResolvedValue(undefined);
    mockSetToStorage.mockResolvedValue(undefined);

    const result = await fetchExchangeRate();

    expect(result.rate).toBe(4.7);
    expect(result.fallback).toBe(false);
    expect(result.timestamp).toBeTypeOf('number');
    expect(mockSetToStorage).toHaveBeenCalledWith(CACHE_KEY, expect.objectContaining({ rate: 4.7 }));
  });

  it('returns cached data when API fails and cache exists', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
    vi.stubGlobal('fetch', mockFetch);
    const cached: ExchangeRateData = { rate: 4.5, timestamp: Date.now(), fallback: false };
    mockGetFromStorage.mockResolvedValue(cached);

    const result = await fetchExchangeRate();

    expect(result.rate).toBe(4.5);
    expect(result.fallback).toBe(false);
  });

  it('returns fallback rate when API fails and no cache', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
    vi.stubGlobal('fetch', mockFetch);
    mockGetFromStorage.mockResolvedValue(undefined);

    const result = await fetchExchangeRate();

    expect(result.rate).toBe(FALLBACK_RATES['GBP:ILS']);
    expect(result.fallback).toBe(true);
    expect(result.timestamp).toBeNull();
  });

  it('falls back when API returns non-ok response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });
    vi.stubGlobal('fetch', mockFetch);
    mockGetFromStorage.mockResolvedValue(undefined);

    const result = await fetchExchangeRate();

    expect(result.rate).toBe(FALLBACK_RATES['GBP:ILS']);
    expect(result.fallback).toBe(true);
  });

  it('falls back when API returns invalid JSON structure', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ rates: {} }), // missing ILS
    });
    vi.stubGlobal('fetch', mockFetch);
    mockGetFromStorage.mockResolvedValue(undefined);

    const result = await fetchExchangeRate();

    expect(result.rate).toBe(FALLBACK_RATES['GBP:ILS']);
    expect(result.fallback).toBe(true);
  });
});

describe('getCachedOrFetchRate', () => {
  it('returns cached data when fresh (< 24hrs)', async () => {
    const cached: ExchangeRateData = {
      rate: 4.5,
      timestamp: Date.now() - 1000, // 1 second ago
      fallback: false,
    };
    mockGetFromStorage.mockResolvedValue(cached);

    const result = await getCachedOrFetchRate();

    expect(result.rate).toBe(4.5);
  });

  it('fetches new data when cache is stale (> 24hrs)', async () => {
    const stale: ExchangeRateData = {
      rate: 4.5,
      timestamp: Date.now() - CACHE_DURATION_MS - 1000, // expired
      fallback: false,
    };
    mockGetFromStorage.mockResolvedValueOnce(stale); // for getCachedOrFetchRate check
    mockGetFromStorage.mockResolvedValueOnce(undefined); // for fetchExchangeRate fallback

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ rates: { ILS: 4.8 } }),
    });
    vi.stubGlobal('fetch', mockFetch);
    mockSetToStorage.mockResolvedValue(undefined);

    const result = await getCachedOrFetchRate();

    expect(result.rate).toBe(4.8);
    expect(mockFetch).toHaveBeenCalled();
  });

  it('fetches new data when no cache exists', async () => {
    mockGetFromStorage.mockResolvedValue(undefined);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ rates: { ILS: 4.9 } }),
    });
    vi.stubGlobal('fetch', mockFetch);
    mockSetToStorage.mockResolvedValue(undefined);

    const result = await getCachedOrFetchRate();

    expect(result.rate).toBe(4.9);
  });
});

describe('formatTimestamp', () => {
  it('returns "never" for null', () => {
    expect(formatTimestamp(null)).toBe('never');
  });

  it('returns "never" for 0', () => {
    expect(formatTimestamp(0)).toBe('never');
  });

  it('returns a date string for a valid timestamp', () => {
    const ts = new Date('2025-01-15T12:00:00Z').getTime();
    const result = formatTimestamp(ts);
    expect(result).not.toBe('never');
    expect(result.length).toBeGreaterThan(0);
  });
});
