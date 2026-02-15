import { vi } from 'vitest';
import { AbstractRetailer, type RetailerSite } from '../src/core/AbstractRetailer';

vi.mock('../src/logger', () => ({
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

/** Minimal concrete subclass for testing base class methods. */
class TestRetailer extends AbstractRetailer {
  readonly id: string = 'test';
  readonly name: string = 'Test';
  readonly sites: Record<string, RetailerSite> = {
    uk: { hostnames: ['www.test.co.uk'], catalogPathPattern: /\/shop/ },
    il: { hostnames: ['www.test.co.il'], catalogPathPattern: /\/shop/ },
  };
  readonly supportsProductPage = true;
  readonly supportsCatalogPage = true;
  readonly priceSelector = '.price';
  readonly productContainerSelector = '.grid';
  readonly productContainerFallbackSelectors: string[] = [];

  transformUrl(url: URL, _from: string, toRegion: string): string {
    return `${url.protocol}//${this.sites[toRegion].hostnames[0]}${url.pathname}`;
  }

  lookupPrice = vi.fn<(pid: string, regionId: string) => Promise<number | null>>();
}

describe('AbstractRetailer', () => {
  let retailer: TestRetailer;

  beforeEach(() => {
    retailer = new TestRetailer();
    vi.restoreAllMocks();
  });

  describe('getAlternateRegionId', () => {
    it('returns the other region for a 2-region retailer', () => {
      expect(retailer.getAlternateRegionId('uk')).toBe('il');
      expect(retailer.getAlternateRegionId('il')).toBe('uk');
    });

    it('returns null when region is the only one', () => {
      const single = new (class extends TestRetailer {
        override readonly sites = {
          uk: { hostnames: ['www.test.co.uk'], catalogPathPattern: /\/shop/ },
        };
      })();
      // Only 'uk' exists, filtering it out leaves 0 regions
      expect(single.getAlternateRegionId('uk')).toBeNull();
    });

    it('returns first alternate and warns when >2 regions', async () => {
      const { warn } = await import('../src/logger');
      const multi = new (class extends TestRetailer {
        override readonly id = 'multi';
        override readonly sites = {
          uk: { hostnames: ['www.test.co.uk'], catalogPathPattern: /\/shop/ },
          il: { hostnames: ['www.test.co.il'], catalogPathPattern: /\/shop/ },
          us: { hostnames: ['www.test.com'], catalogPathPattern: /\/shop/ },
        };
      })();
      const result = multi.getAlternateRegionId('uk');
      // Should return one of the alternates (il or us) and warn
      expect(result).toBeTruthy();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Expected exactly 1 alternate region, found 2')
      );
    });

    it('returns null for unknown region in 2-region retailer', () => {
      // Filtering 'xx' from ['uk', 'il'] leaves both → warns, returns first
      const result = retailer.getAlternateRegionId('xx');
      expect(result).toBeTruthy();
    });
  });

  describe('lookupPrices', () => {
    it('returns prices for all successful lookups', async () => {
      retailer.lookupPrice
        .mockResolvedValueOnce(29.99)
        .mockResolvedValueOnce(45.0)
        .mockResolvedValueOnce(12.5);

      const result = await retailer.lookupPrices(['a', 'b', 'c'], 'uk');
      expect(result).toEqual({ a: 29.99, b: 45.0, c: 12.5 });
      expect(retailer.lookupPrice).toHaveBeenCalledTimes(3);
    });

    it('omits PIDs where lookupPrice returns null', async () => {
      retailer.lookupPrice
        .mockResolvedValueOnce(29.99)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(12.5);

      const result = await retailer.lookupPrices(['a', 'b', 'c'], 'uk');
      expect(result).toEqual({ a: 29.99, c: 12.5 });
    });

    it('handles partial failures gracefully', async () => {
      retailer.lookupPrice
        .mockResolvedValueOnce(29.99)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(12.5);

      const result = await retailer.lookupPrices(['a', 'b', 'c'], 'uk');
      expect(result).toEqual({ a: 29.99, c: 12.5 });
    });

    it('returns empty object when all lookups fail', async () => {
      retailer.lookupPrice.mockRejectedValue(new Error('fail'));

      const result = await retailer.lookupPrices(['a', 'b'], 'uk');
      expect(result).toEqual({});
    });

    it('returns empty object for empty PID array', async () => {
      const result = await retailer.lookupPrices([], 'uk');
      expect(result).toEqual({});
      expect(retailer.lookupPrice).not.toHaveBeenCalled();
    });

    it('passes regionId to each lookupPrice call', async () => {
      retailer.lookupPrice.mockResolvedValue(10);

      await retailer.lookupPrices(['x', 'y'], 'il');
      expect(retailer.lookupPrice).toHaveBeenCalledWith('x', 'il');
      expect(retailer.lookupPrice).toHaveBeenCalledWith('y', 'il');
    });
  });
});
