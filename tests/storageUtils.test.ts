import {
  getFromStorage,
  setToStorage,
  getCachedPrice,
  setCachedPrice,
} from '../src/storageUtils';
import { PRICE_CACHE_KEY_PREFIX, PRICE_CACHE_TTL_MS } from '../src/constants';
import type { PriceCacheItem } from '../src/types';

describe('getFromStorage', () => {
  it('returns stored value for a given key', async () => {
    await chrome.storage.local.set({ testKey: 'testValue' });
    const result = await getFromStorage<string>('testKey');
    expect(result).toBe('testValue');
  });

  it('returns undefined when key does not exist', async () => {
    const result = await getFromStorage<string>('nonexistent');
    expect(result).toBeUndefined();
  });
});

describe('setToStorage', () => {
  it('stores a value retrievable by getFromStorage', async () => {
    await setToStorage('myKey', { data: 123 });
    const result = await getFromStorage<{ data: number }>('myKey');
    expect(result).toEqual({ data: 123 });
  });
});

describe('price cache', () => {
  const pid = 'F29977';
  const key = `${PRICE_CACHE_KEY_PREFIX}${pid}`;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('setCachedPrice', () => {
    it('stores price under the correct region', async () => {
      const now = 1000000;
      vi.setSystemTime(now);

      await setCachedPrice(pid, 'uk', 26);

      const stored = await getFromStorage<PriceCacheItem>(key);
      expect(stored).toEqual({
        uk: { price: 26, timestamp: now },
      });
    });

    it('merges prices for multiple regions', async () => {
      const now = 1000000;
      vi.setSystemTime(now);

      await setCachedPrice(pid, 'uk', 26);

      vi.setSystemTime(now + 100);
      await setCachedPrice(pid, 'il', 90);

      const stored = await getFromStorage<PriceCacheItem>(key);
      expect(stored).toEqual({
        uk: { price: 26, timestamp: now },
        il: { price: 90, timestamp: now + 100 },
      });
    });
  });

  describe('getCachedPrice', () => {
    it('returns null if no cache exists', async () => {
      const result = await getCachedPrice(pid, 'uk');
      expect(result).toBeNull();
    });

    it('returns null if product cached but region not present', async () => {
      const now = 1000000;
      vi.setSystemTime(now);

      await setCachedPrice(pid, 'uk', 26);

      const result = await getCachedPrice(pid, 'il');
      expect(result).toBeNull();
    });

    it('returns entry if cache is fresh', async () => {
      const now = 1000000;
      vi.setSystemTime(now);

      await setCachedPrice(pid, 'uk', 20);

      // Advance time but stay within TTL
      vi.setSystemTime(now + PRICE_CACHE_TTL_MS - 1);

      const result = await getCachedPrice(pid, 'uk');
      expect(result).toEqual({ price: 20, timestamp: now });
    });

    it('returns null and clears stale region but keeps fresh ones', async () => {
      const now = 1000000;
      vi.setSystemTime(now);

      await setCachedPrice(pid, 'uk', 26);

      // Cache IL later
      vi.setSystemTime(now + PRICE_CACHE_TTL_MS);
      await setCachedPrice(pid, 'il', 90);

      // Advance so UK is stale but IL is still fresh
      vi.setSystemTime(now + PRICE_CACHE_TTL_MS + 1);

      const ukResult = await getCachedPrice(pid, 'uk');
      expect(ukResult).toBeNull();

      const ilResult = await getCachedPrice(pid, 'il');
      expect(ilResult).toEqual({ price: 90, timestamp: now + PRICE_CACHE_TTL_MS });

      // Verify UK was removed but IL remains
      const stored = await getFromStorage<PriceCacheItem>(key);
      expect(stored).toEqual({
        il: { price: 90, timestamp: now + PRICE_CACHE_TTL_MS },
      });
    });

    it('removes entire key when all regions are stale', async () => {
      const now = 1000000;
      vi.setSystemTime(now);

      await setCachedPrice(pid, 'uk', 26);

      // Advance time beyond TTL
      vi.setSystemTime(now + PRICE_CACHE_TTL_MS + 1);

      const result = await getCachedPrice(pid, 'uk');
      expect(result).toBeNull();

      // Verify entire key was removed
      const stored = await getFromStorage(key);
      expect(stored).toBeUndefined();
    });
  });
});
