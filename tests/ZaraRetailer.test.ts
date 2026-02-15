import { vi, beforeEach } from 'vitest';
import { ZaraRetailer } from '../src/retailers/zara/ZaraRetailer';

vi.mock('../src/logger', () => ({
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../src/providers/zara', () => ({
  lookupPrice: vi.fn(),
  lookupCatalogPrices: vi.fn(),
}));

describe('ZaraRetailer', () => {
  const zara = new ZaraRetailer();

  describe('getRegionForUrl', () => {
    it('returns uk for /uk/ path', () => {
      expect(zara.getRegionForUrl(new URL('https://www.zara.com/uk/en/product-p12345678.html'))).toBe('uk');
    });

    it('returns il for /il/ path', () => {
      expect(zara.getRegionForUrl(new URL('https://www.zara.com/il/en/product-p12345678.html'))).toBe('il');
    });

    it('returns null for unknown path prefix', () => {
      expect(zara.getRegionForUrl(new URL('https://www.zara.com/us/en/product.html'))).toBeNull();
    });

    it('returns null for non-Zara hostname', () => {
      expect(zara.getRegionForUrl(new URL('https://www.next.co.uk/'))).toBeNull();
    });

    it('returns null for zara.com root (no region prefix)', () => {
      expect(zara.getRegionForUrl(new URL('https://www.zara.com/'))).toBeNull();
    });

    it('matches uk for catalog page URL', () => {
      expect(
        zara.getRegionForUrl(
          new URL('https://www.zara.com/uk/en/woman-dresses-l1066.html')
        )
      ).toBe('uk');
    });
  });

  describe('isCatalogPage', () => {
    it('returns true for UK catalog URL', () => {
      expect(
        zara.isCatalogPage(new URL('https://www.zara.com/uk/en/woman-dresses-l1066.html'))
      ).toBe(true);
    });

    it('returns true for IL catalog URL', () => {
      expect(
        zara.isCatalogPage(new URL('https://www.zara.com/il/en/man-jackets-l737.html'))
      ).toBe(true);
    });

    it('returns false for product URL', () => {
      expect(
        zara.isCatalogPage(
          new URL('https://www.zara.com/uk/en/satin-effect-dress-p02731310.html')
        )
      ).toBe(false);
    });

    it('returns false for non-Zara URL', () => {
      expect(zara.isCatalogPage(new URL('https://www.next.co.uk/shop/women'))).toBe(false);
    });
  });

  describe('transformUrl', () => {
    it('transforms UK to IL (swaps /uk/ to /il/)', () => {
      const url = new URL(
        'https://www.zara.com/uk/en/satin-effect-dress-p02731310.html'
      );
      expect(zara.transformUrl(url, 'uk', 'il')).toBe(
        'https://www.zara.com/il/en/satin-effect-dress-p02731310.html'
      );
    });

    it('transforms IL to UK (swaps /il/ to /uk/)', () => {
      const url = new URL(
        'https://www.zara.com/il/en/satin-effect-dress-p02731310.html'
      );
      expect(zara.transformUrl(url, 'il', 'uk')).toBe(
        'https://www.zara.com/uk/en/satin-effect-dress-p02731310.html'
      );
    });

    it('preserves query params and hash', () => {
      const url = new URL(
        'https://www.zara.com/uk/en/dress-p02731310.html?v1=123456#details'
      );
      expect(zara.transformUrl(url, 'uk', 'il')).toBe(
        'https://www.zara.com/il/en/dress-p02731310.html?v1=123456#details'
      );
    });

    it('round-trips UK → IL → UK', () => {
      const original = 'https://www.zara.com/uk/en/dress-p02731310.html';
      const il = zara.transformUrl(new URL(original), 'uk', 'il');
      const backToUk = zara.transformUrl(new URL(il), 'il', 'uk');
      expect(backToUk).toBe(original);
    });

    it('round-trips IL → UK → IL', () => {
      const original = 'https://www.zara.com/il/en/dress-p02731310.html';
      const uk = zara.transformUrl(new URL(original), 'il', 'uk');
      const backToIl = zara.transformUrl(new URL(uk), 'uk', 'il');
      expect(backToIl).toBe(original);
    });
  });

  describe('extractProductId', () => {
    it('extracts PID from standard product URL', () => {
      const url = new URL(
        'https://www.zara.com/uk/en/satin-effect-dress-p02731310.html'
      );
      expect(zara.extractProductId(url)).toBe('02731310');
    });

    it('extracts PID from IL product URL', () => {
      const url = new URL(
        'https://www.zara.com/il/en/basic-t-shirt-p00962350.html'
      );
      expect(zara.extractProductId(url)).toBe('00962350');
    });

    it('extracts PID ignoring query params', () => {
      const url = new URL(
        'https://www.zara.com/uk/en/dress-p02731310.html?v1=123456'
      );
      expect(zara.extractProductId(url)).toBe('02731310');
    });

    it('returns null for catalog URL', () => {
      const url = new URL(
        'https://www.zara.com/uk/en/woman-dresses-l1066.html'
      );
      expect(zara.extractProductId(url)).toBeNull();
    });

    it('returns null for homepage', () => {
      const url = new URL('https://www.zara.com/uk/en/');
      expect(zara.extractProductId(url)).toBeNull();
    });

    it('returns null for non-product page', () => {
      const url = new URL('https://www.zara.com/uk/en/help.html');
      expect(zara.extractProductId(url)).toBeNull();
    });
  });

  describe('getAlternateRegionId', () => {
    it('returns il for uk', () => {
      expect(zara.getAlternateRegionId('uk')).toBe('il');
    });

    it('returns uk for il', () => {
      expect(zara.getAlternateRegionId('il')).toBe('uk');
    });
  });

  describe('selectors', () => {
    it('has a price selector', () => {
      expect(zara.priceSelector).toBe('span.money-amount__main');
    });

    it('has product container selectors', () => {
      expect(zara.productContainerSelector).toBeTruthy();
      expect(zara.productContainerFallbackSelectors.length).toBeGreaterThan(0);
    });

    it('does not need catalog price fallback (priceSelector works on catalog pages)', () => {
      // Zara's span.money-amount__main selector works on both product and catalog pages,
      // so no fallback selectors are needed (unlike Next whose PDP selector differs).
      expect(zara.catalogPriceFallbackSelectors).toEqual([]);
    });
  });

  describe('extractProductIdFromElement', () => {
    it('extracts 8-digit URL ref from data-productkey', () => {
      const el = {
        getAttribute: (attr: string) => {
          if (attr === 'data-productkey') return '507930764-03067331059-p';
          if (attr === 'data-productid') return '507930764';
          return null;
        },
        querySelector: () => null,
      } as unknown as Element;
      expect(zara.extractProductIdFromElement(el)).toBe('03067331');
    });

    it('extracts URL ref from child element with data-productkey', () => {
      const child = {
        getAttribute: (attr: string) =>
          attr === 'data-productkey' ? '522701238-05029119068-p' : null,
      };
      const el = {
        getAttribute: () => null,
        querySelector: (sel: string) => (sel === '[data-productkey]' ? child : null),
      } as unknown as Element;
      expect(zara.extractProductIdFromElement(el)).toBe('05029119');
    });

    it('falls back to data-productid when no data-productkey', () => {
      const el = {
        getAttribute: (attr: string) => (attr === 'data-productid' ? '507084855' : null),
        querySelector: () => null,
      } as unknown as Element;
      expect(zara.extractProductIdFromElement(el)).toBe('507084855');
    });

    it('falls back to child data-productid when no data-productkey', () => {
      const child = { getAttribute: (attr: string) => (attr === 'data-productid' ? '522701238' : null) };
      const el = {
        getAttribute: () => null,
        querySelector: (sel: string) => {
          if (sel === '[data-productkey]') return null;
          if (sel === '[data-productid]') return child;
          return null;
        },
      } as unknown as Element;
      expect(zara.extractProductIdFromElement(el)).toBe('522701238');
    });

    it('returns null when no data-productkey or data-productid found', () => {
      const el = {
        getAttribute: () => null,
        querySelector: () => null,
      } as unknown as Element;
      expect(zara.extractProductIdFromElement(el)).toBeNull();
    });
  });

  describe('constructProductUrl', () => {
    it('constructs UK product URL from 8-digit URL ref', () => {
      expect(zara.constructProductUrl('03067331', 'uk')).toBe(
        'https://www.zara.com/uk/en/-p03067331.html'
      );
    });

    it('constructs IL product URL from 8-digit URL ref', () => {
      expect(zara.constructProductUrl('05029119', 'il')).toBe(
        'https://www.zara.com/il/en/-p05029119.html'
      );
    });

    it('returns null for unknown region', () => {
      expect(zara.constructProductUrl('03067331', 'us')).toBeNull();
    });
  });

  describe('lookupPrices', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('uses catalog fetch when catalogUrl is provided', async () => {
      const { lookupCatalogPrices } = await import('../src/providers/zara');
      vi.mocked(lookupCatalogPrices).mockResolvedValue({
        '507084855': 29.99,
        '522701238': 49.95,
      });

      const result = await zara.lookupPrices(
        ['507084855', '522701238'],
        'uk',
        {},
        'https://www.zara.com/uk/en/woman-dresses-l1066.html'
      );

      expect(lookupCatalogPrices).toHaveBeenCalledWith(
        'https://www.zara.com/uk/en/woman-dresses-l1066.html'
      );
      expect(result).toEqual({ '507084855': 29.99, '522701238': 49.95 });
    });

    it('falls back to individual lookups for PIDs not in catalog', async () => {
      const { lookupCatalogPrices, lookupPrice } = await import('../src/providers/zara');
      vi.mocked(lookupCatalogPrices).mockResolvedValue({
        '507084855': 29.99,
        // '999999999' is NOT in catalog
      });
      vi.mocked(lookupPrice).mockResolvedValue(15.0);

      const pidToUrl = {
        '507084855': 'https://www.zara.com/uk/en/-p507084855.html',
        '999999999': 'https://www.zara.com/uk/en/-p999999999.html',
      };

      const result = await zara.lookupPrices(
        ['507084855', '999999999'],
        'uk',
        pidToUrl,
        'https://www.zara.com/uk/en/woman-dresses-l1066.html'
      );

      expect(lookupCatalogPrices).toHaveBeenCalled();
      // lookupPrice should be called for the unmatched PID
      expect(lookupPrice).toHaveBeenCalledWith(
        '999999999',
        'uk',
        zara.sites,
        'https://www.zara.com/uk/en/-p999999999.html'
      );
      expect(result).toEqual({ '507084855': 29.99, '999999999': 15.0 });
    });

    it('does not call individual lookups when all PIDs found in catalog', async () => {
      const { lookupCatalogPrices, lookupPrice } = await import('../src/providers/zara');
      vi.mocked(lookupCatalogPrices).mockResolvedValue({
        '507084855': 29.99,
        '522701238': 49.95,
      });

      await zara.lookupPrices(
        ['507084855', '522701238'],
        'uk',
        {},
        'https://www.zara.com/uk/en/catalog-l1066.html'
      );

      expect(lookupPrice).not.toHaveBeenCalled();
    });

    it('uses individual lookups when no catalogUrl provided', async () => {
      const { lookupCatalogPrices, lookupPrice } = await import('../src/providers/zara');
      vi.mocked(lookupPrice).mockResolvedValue(29.99);

      const result = await zara.lookupPrices(['507084855'], 'uk');

      expect(lookupCatalogPrices).not.toHaveBeenCalled();
      expect(lookupPrice).toHaveBeenCalledWith('507084855', 'uk', zara.sites, undefined);
      expect(result).toEqual({ '507084855': 29.99 });
    });
  });
});
