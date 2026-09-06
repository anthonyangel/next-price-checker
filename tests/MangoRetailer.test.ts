import { vi, beforeEach } from 'vitest';
import { MangoRetailer } from '../src/retailers/mango/MangoRetailer';

vi.mock('../src/logger', () => ({
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../src/providers/mango', () => ({
  lookupPrice: vi.fn(),
}));

describe('MangoRetailer', () => {
  const mango = new MangoRetailer();

  describe('getRegionForUrl', () => {
    it('returns uk for /gb/ path', () => {
      expect(
        mango.getRegionForUrl(
          new URL('https://shop.mango.com/gb/en/p/women/dresses/dress_87070630')
        )
      ).toBe('uk');
    });

    it('returns il for /il/ path', () => {
      expect(
        mango.getRegionForUrl(
          new URL('https://shop.mango.com/il/en/p/women/dresses/dress_87070630')
        )
      ).toBe('il');
    });

    it('returns null for unknown path prefix', () => {
      expect(
        mango.getRegionForUrl(
          new URL('https://shop.mango.com/us/en/p/women/dresses/dress_87070630')
        )
      ).toBeNull();
    });

    it('returns null for non-Mango hostname', () => {
      expect(mango.getRegionForUrl(new URL('https://www.next.co.uk/'))).toBeNull();
    });

    it('returns null for mango.com root (no region prefix)', () => {
      expect(mango.getRegionForUrl(new URL('https://shop.mango.com/'))).toBeNull();
    });

    it('matches uk for catalog page URL', () => {
      expect(
        mango.getRegionForUrl(
          new URL('https://shop.mango.com/gb/en/c/women/dresses-and-jumpsuits/e6bb8705')
        )
      ).toBe('uk');
    });
  });

  describe('isCatalogPage', () => {
    it('returns true for UK catalog URL', () => {
      expect(
        mango.isCatalogPage(
          new URL('https://shop.mango.com/gb/en/c/women/dresses-and-jumpsuits/e6bb8705')
        )
      ).toBe(true);
    });

    it('returns true for IL catalog URL', () => {
      expect(
        mango.isCatalogPage(
          new URL('https://shop.mango.com/il/en/c/men/jackets/abc12345')
        )
      ).toBe(true);
    });

    it('returns false for product URL', () => {
      expect(
        mango.isCatalogPage(
          new URL('https://shop.mango.com/gb/en/p/women/dresses/dress_87070630')
        )
      ).toBe(false);
    });

    it('returns false for non-Mango URL', () => {
      expect(mango.isCatalogPage(new URL('https://www.next.co.uk/shop/women'))).toBe(
        false
      );
    });

    it('returns false for homepage', () => {
      expect(
        mango.isCatalogPage(new URL('https://shop.mango.com/gb/en'))
      ).toBe(false);
    });
  });

  describe('transformUrl', () => {
    it('transforms UK to IL (swaps /gb/ to /il/)', () => {
      const url = new URL(
        'https://shop.mango.com/gb/en/p/women/dresses/dress_87070630'
      );
      expect(mango.transformUrl(url, 'uk', 'il')).toBe(
        'https://shop.mango.com/il/en/p/women/dresses/dress_87070630'
      );
    });

    it('transforms IL to UK (swaps /il/ to /gb/)', () => {
      const url = new URL(
        'https://shop.mango.com/il/en/p/women/dresses/dress_87070630'
      );
      expect(mango.transformUrl(url, 'il', 'uk')).toBe(
        'https://shop.mango.com/gb/en/p/women/dresses/dress_87070630'
      );
    });

    it('preserves query params and hash', () => {
      const url = new URL(
        'https://shop.mango.com/gb/en/p/women/dresses/dress_87070630?c=16#details'
      );
      expect(mango.transformUrl(url, 'uk', 'il')).toBe(
        'https://shop.mango.com/il/en/p/women/dresses/dress_87070630?c=16#details'
      );
    });

    it('round-trips UK → IL → UK', () => {
      const original =
        'https://shop.mango.com/gb/en/p/women/dresses/dress_87070630';
      const il = mango.transformUrl(new URL(original), 'uk', 'il');
      const backToUk = mango.transformUrl(new URL(il), 'il', 'uk');
      expect(backToUk).toBe(original);
    });

    it('round-trips IL → UK → IL', () => {
      const original =
        'https://shop.mango.com/il/en/p/women/dresses/dress_87070630';
      const uk = mango.transformUrl(new URL(original), 'il', 'uk');
      const backToIl = mango.transformUrl(new URL(uk), 'uk', 'il');
      expect(backToIl).toBe(original);
    });

    it('transforms catalog URLs', () => {
      const url = new URL(
        'https://shop.mango.com/gb/en/c/women/dresses-and-jumpsuits/e6bb8705'
      );
      expect(mango.transformUrl(url, 'uk', 'il')).toBe(
        'https://shop.mango.com/il/en/c/women/dresses-and-jumpsuits/e6bb8705'
      );
    });
  });

  describe('extractProductId', () => {
    it('extracts 8-digit PID from product URL', () => {
      const url = new URL(
        'https://shop.mango.com/gb/en/p/women/dresses/belted-blazer-dress_87070630'
      );
      expect(mango.extractProductId(url)).toBe('87070630');
    });

    it('extracts PID from IL product URL', () => {
      const url = new URL(
        'https://shop.mango.com/il/en/p/women/jeans/mid-rise-straight-jeans_57014406'
      );
      expect(mango.extractProductId(url)).toBe('57014406');
    });

    it('extracts PID ignoring query params', () => {
      const url = new URL(
        'https://shop.mango.com/gb/en/p/women/dresses/dress_87070630?c=16'
      );
      expect(mango.extractProductId(url)).toBe('87070630');
    });

    it('returns null for catalog URL', () => {
      const url = new URL(
        'https://shop.mango.com/gb/en/c/women/dresses-and-jumpsuits/e6bb8705'
      );
      expect(mango.extractProductId(url)).toBeNull();
    });

    it('returns null for homepage', () => {
      const url = new URL('https://shop.mango.com/gb/en');
      expect(mango.extractProductId(url)).toBeNull();
    });

    it('returns null for hub page', () => {
      const url = new URL('https://shop.mango.com/gb/en/h/women');
      expect(mango.extractProductId(url)).toBeNull();
    });
  });

  describe('getAlternateRegionId', () => {
    it('returns il for uk', () => {
      expect(mango.getAlternateRegionId('uk')).toBe('il');
    });

    it('returns uk for il', () => {
      expect(mango.getAlternateRegionId('il')).toBe('uk');
    });
  });

  describe('selectors', () => {
    it('has a price selector', () => {
      expect(mango.priceSelector).toBe('span[class*="SinglePrice_container"]');
    });

    it('has product container selectors', () => {
      expect(mango.productContainerSelector).toBeTruthy();
      expect(mango.productContainerFallbackSelectors.length).toBeGreaterThan(0);
    });

    it('has a catalog price fallback selector distinct from the PDP selector', () => {
      expect(mango.catalogPriceFallbackSelectors.length).toBeGreaterThan(0);
      expect(mango.catalogPriceFallbackSelectors).not.toContain(mango.priceSelector);
    });
  });

  describe('lookupPrice', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('calls provider with color code from URL', async () => {
      const { lookupPrice: mockLookup } = await import('../src/providers/mango');
      vi.mocked(mockLookup).mockResolvedValue(29.99);

      const price = await mango.lookupPrice(
        '87070630',
        'uk',
        'https://shop.mango.com/gb/en/p/women/dresses/dress_87070630?c=16'
      );

      expect(price).toBe(29.99);
      expect(mockLookup).toHaveBeenCalledWith('87070630', 'uk', '16');
    });

    it('calls provider without color code when URL has no ?c param', async () => {
      const { lookupPrice: mockLookup } = await import('../src/providers/mango');
      vi.mocked(mockLookup).mockResolvedValue(29.99);

      await mango.lookupPrice(
        '87070630',
        'uk',
        'https://shop.mango.com/gb/en/p/women/dresses/dress_87070630'
      );

      expect(mockLookup).toHaveBeenCalledWith('87070630', 'uk', undefined);
    });

    it('calls provider without color code when no URL provided', async () => {
      const { lookupPrice: mockLookup } = await import('../src/providers/mango');
      vi.mocked(mockLookup).mockResolvedValue(29.99);

      await mango.lookupPrice('87070630', 'uk');

      expect(mockLookup).toHaveBeenCalledWith('87070630', 'uk', undefined);
    });
  });
});
