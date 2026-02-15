import { vi, beforeEach, afterEach } from 'vitest';
import { HMRetailer } from '../src/retailers/hm/HMRetailer';

vi.mock('../src/logger', () => ({
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../src/providers/hm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/providers/hm')>();
  return {
    ...actual,
    lookupPrice: vi.fn(),
    lookupCatalogPrices: vi.fn(),
  };
});

describe('HMRetailer', () => {
  const hm = new HMRetailer();

  describe('getRegionForUrl', () => {
    it('returns uk for /en_gb/ path', () => {
      expect(
        hm.getRegionForUrl(new URL('https://www2.hm.com/en_gb/productpage.1247834001.html'))
      ).toBe('uk');
    });

    it('returns il for /hw_il/ path', () => {
      expect(
        hm.getRegionForUrl(new URL('https://www2.hm.com/hw_il/productpage.1247834001.html'))
      ).toBe('il');
    });

    it('returns null for unknown path prefix', () => {
      expect(
        hm.getRegionForUrl(new URL('https://www2.hm.com/en_us/productpage.1247834001.html'))
      ).toBeNull();
    });

    it('returns null for non-H&M hostname', () => {
      expect(hm.getRegionForUrl(new URL('https://www.zara.com/uk/en/'))).toBeNull();
    });

    it('returns null for hm.com root (no locale prefix)', () => {
      expect(hm.getRegionForUrl(new URL('https://www2.hm.com/'))).toBeNull();
    });

    it('matches uk for catalog page URL', () => {
      expect(
        hm.getRegionForUrl(new URL('https://www2.hm.com/en_gb/ladies/shop-by-product/tops.html'))
      ).toBe('uk');
    });

    it('matches il for catalog page URL', () => {
      expect(
        hm.getRegionForUrl(new URL('https://www2.hm.com/hw_il/ladies/shop-by-product/tops.html'))
      ).toBe('il');
    });
  });

  describe('isCatalogPage', () => {
    it('returns true for UK catalog URL', () => {
      expect(
        hm.isCatalogPage(new URL('https://www2.hm.com/en_gb/ladies/shop-by-product/tops.html'))
      ).toBe(true);
    });

    it('returns true for IL catalog URL', () => {
      expect(
        hm.isCatalogPage(new URL('https://www2.hm.com/hw_il/men/shop-by-product/jackets.html'))
      ).toBe(true);
    });

    it('returns false for product URL', () => {
      expect(
        hm.isCatalogPage(new URL('https://www2.hm.com/en_gb/productpage.1247834001.html'))
      ).toBe(false);
    });

    it('returns false for non-H&M URL', () => {
      expect(hm.isCatalogPage(new URL('https://www.next.co.uk/shop/women'))).toBe(false);
    });
  });

  describe('transformUrl', () => {
    it('transforms UK to IL (swaps /en_gb/ to /hw_il/)', () => {
      const url = new URL('https://www2.hm.com/en_gb/productpage.1247834001.html');
      expect(hm.transformUrl(url, 'uk', 'il')).toBe(
        'https://www2.hm.com/hw_il/productpage.1247834001.html'
      );
    });

    it('transforms IL to UK (swaps /hw_il/ to /en_gb/)', () => {
      const url = new URL('https://www2.hm.com/hw_il/productpage.1247834001.html');
      expect(hm.transformUrl(url, 'il', 'uk')).toBe(
        'https://www2.hm.com/en_gb/productpage.1247834001.html'
      );
    });

    it('transforms catalog URL UK to IL', () => {
      const url = new URL('https://www2.hm.com/en_gb/ladies/shop-by-product/tops.html');
      expect(hm.transformUrl(url, 'uk', 'il')).toBe(
        'https://www2.hm.com/hw_il/ladies/shop-by-product/tops.html'
      );
    });

    it('preserves query params and hash', () => {
      const url = new URL('https://www2.hm.com/en_gb/productpage.1247834001.html?size=M#details');
      expect(hm.transformUrl(url, 'uk', 'il')).toBe(
        'https://www2.hm.com/hw_il/productpage.1247834001.html?size=M#details'
      );
    });

    it('round-trips UK → IL → UK', () => {
      const original = 'https://www2.hm.com/en_gb/productpage.1247834001.html';
      const il = hm.transformUrl(new URL(original), 'uk', 'il');
      const backToUk = hm.transformUrl(new URL(il), 'il', 'uk');
      expect(backToUk).toBe(original);
    });

    it('round-trips IL → UK → IL', () => {
      const original = 'https://www2.hm.com/hw_il/productpage.1247834001.html';
      const uk = hm.transformUrl(new URL(original), 'il', 'uk');
      const backToIl = hm.transformUrl(new URL(uk), 'uk', 'il');
      expect(backToIl).toBe(original);
    });
  });

  describe('extractProductId', () => {
    it('extracts 10-digit article code from UK product URL', () => {
      const url = new URL('https://www2.hm.com/en_gb/productpage.1247834001.html');
      expect(hm.extractProductId(url)).toBe('1247834001');
    });

    it('extracts article code from IL product URL', () => {
      const url = new URL('https://www2.hm.com/hw_il/productpage.1247834001.html');
      expect(hm.extractProductId(url)).toBe('1247834001');
    });

    it('extracts 7-digit base product code', () => {
      const url = new URL('https://www2.hm.com/en_gb/productpage.1247834.html');
      expect(hm.extractProductId(url)).toBe('1247834');
    });

    it('extracts PID ignoring query params and hash', () => {
      const url = new URL('https://www2.hm.com/en_gb/productpage.1247834001.html?size=M#color');
      expect(hm.extractProductId(url)).toBe('1247834001');
    });

    it('returns null for catalog/listing URL', () => {
      const url = new URL('https://www2.hm.com/en_gb/ladies/shop-by-product/tops.html');
      expect(hm.extractProductId(url)).toBeNull();
    });

    it('returns null for homepage', () => {
      const url = new URL('https://www2.hm.com/en_gb/index.html');
      expect(hm.extractProductId(url)).toBeNull();
    });

    it('returns null for non-product page', () => {
      const url = new URL('https://www2.hm.com/en_gb/customer-service.html');
      expect(hm.extractProductId(url)).toBeNull();
    });
  });

  describe('constructProductUrl', () => {
    it('constructs UK product URL', () => {
      expect(hm.constructProductUrl('1247834001', 'uk')).toBe(
        'https://www2.hm.com/en_gb/productpage.1247834001.html'
      );
    });

    it('constructs IL product URL', () => {
      expect(hm.constructProductUrl('1247834001', 'il')).toBe(
        'https://www2.hm.com/hw_il/productpage.1247834001.html'
      );
    });

    it('returns null for unknown region', () => {
      expect(hm.constructProductUrl('1247834001', 'us')).toBeNull();
    });
  });

  describe('getAlternateRegionId', () => {
    it('returns il for uk', () => {
      expect(hm.getAlternateRegionId('uk')).toBe('il');
    });

    it('returns uk for il', () => {
      expect(hm.getAlternateRegionId('il')).toBe('uk');
    });
  });

  describe('selectors', () => {
    it('has a price selector', () => {
      expect(hm.priceSelector).toBe('span.price-value');
    });

    it('uses data-elid product grid selector', () => {
      expect(hm.productContainerSelector).toBe('ul[data-elid="product-grid"]');
    });

    it('has product container fallback selectors', () => {
      expect(hm.productContainerFallbackSelectors.length).toBeGreaterThan(0);
    });

    it('has catalog price fallback selectors', () => {
      expect(hm.catalogPriceFallbackSelectors.length).toBeGreaterThan(0);
    });
  });

  describe('extractProductIdFromElement', () => {
    it('extracts article code from data-articlecode attribute', () => {
      const el = {
        getAttribute: (attr: string) => (attr === 'data-articlecode' ? '1308076014' : null),
        querySelector: () => null,
      } as unknown as Element;
      expect(hm.extractProductIdFromElement(el)).toBe('1308076014');
    });

    it('extracts from nested article element', () => {
      const article = { getAttribute: (attr: string) => (attr === 'data-articlecode' ? '1308076014' : null) };
      const el = {
        getAttribute: () => null,
        querySelector: (sel: string) => (sel === 'article[data-articlecode]' ? article : null),
      } as unknown as Element;
      expect(hm.extractProductIdFromElement(el)).toBe('1308076014');
    });

    it('returns null when no data-articlecode found', () => {
      const el = {
        getAttribute: () => null,
        querySelector: () => null,
      } as unknown as Element;
      expect(hm.extractProductIdFromElement(el)).toBeNull();
    });
  });

  describe('extractPriceFromPage', () => {
    const originalDocument = globalThis.document;

    afterEach(() => {
      if (originalDocument) {
        globalThis.document = originalDocument;
      } else {
        delete (globalThis as Record<string, unknown>).document;
      }
    });

    function mockDocument(nextData: unknown | null) {
      const mockEl = nextData ? { textContent: JSON.stringify(nextData) } : null;
      globalThis.document = {
        getElementById: (id: string) => (id === '__NEXT_DATA__' ? mockEl : null),
      } as unknown as Document;
    }

    it('extracts whitePriceValue from __NEXT_DATA__ variations', () => {
      mockDocument({
        props: {
          pageProps: {
            productPageProps: {
              aemData: {
                productArticleDetails: {
                  articleCode: '1247834001',
                  variations: {
                    '1247834001': { whitePriceValue: '19.99', name: 'Black' },
                  },
                },
              },
            },
          },
        },
      });
      const url = new URL('https://www2.hm.com/en_gb/productpage.1247834001.html');
      expect(hm.extractPriceFromPage(url)).toBe('19.99');
    });

    it('prefers redPriceValue (sale) over whitePriceValue (regular)', () => {
      mockDocument({
        props: {
          pageProps: {
            productPageProps: {
              aemData: {
                productArticleDetails: {
                  articleCode: '1247834001',
                  variations: {
                    '1247834001': {
                      whitePriceValue: '19.99',
                      redPriceValue: '14.99',
                    },
                  },
                },
              },
            },
          },
        },
      });
      const url = new URL('https://www2.hm.com/en_gb/productpage.1247834001.html');
      expect(hm.extractPriceFromPage(url)).toBe('14.99');
    });

    it('prefers priceClubValue (member) over all other prices', () => {
      mockDocument({
        props: {
          pageProps: {
            productPageProps: {
              aemData: {
                productArticleDetails: {
                  articleCode: '1247834001',
                  variations: {
                    '1247834001': {
                      whitePriceValue: '24.99',
                      redPriceValue: '19.99',
                      priceClubValue: '16.99',
                    },
                  },
                },
              },
            },
          },
        },
      });
      const url = new URL('https://www2.hm.com/en_gb/productpage.1247834001.html');
      expect(hm.extractPriceFromPage(url)).toBe('16.99');
    });

    it('returns null when __NEXT_DATA__ is not present', () => {
      mockDocument(null);
      const url = new URL('https://www2.hm.com/en_gb/productpage.1247834001.html');
      expect(hm.extractPriceFromPage(url)).toBeNull();
    });

    it('returns null when document is undefined (background worker)', () => {
      delete (globalThis as Record<string, unknown>).document;
      const url = new URL('https://www2.hm.com/en_gb/productpage.1247834001.html');
      expect(hm.extractPriceFromPage(url)).toBeNull();
    });

    it('returns null when article not found in variations', () => {
      mockDocument({
        props: {
          pageProps: {
            productPageProps: {
              aemData: {
                productArticleDetails: {
                  articleCode: '9999999999',
                  variations: {
                    '9999999999': { whitePriceValue: '19.99' },
                  },
                },
              },
            },
          },
        },
      });
      const url = new URL('https://www2.hm.com/en_gb/productpage.1247834001.html');
      expect(hm.extractPriceFromPage(url)).toBeNull();
    });

    it('returns null for catalog URL (no PID)', () => {
      mockDocument({ props: { pageProps: {} } });
      const url = new URL('https://www2.hm.com/en_gb/ladies/shop-by-product/tops.html');
      expect(hm.extractPriceFromPage(url)).toBeNull();
    });
  });

  describe('lookupPrices', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('uses catalog fetch when catalogUrl is provided', async () => {
      const { lookupCatalogPrices } = await import('../src/providers/hm');
      vi.mocked(lookupCatalogPrices).mockResolvedValue({
        '1247834001': 19.99,
        '0987654321': 29.99,
      });

      const result = await hm.lookupPrices(
        ['1247834001', '0987654321'],
        'uk',
        {},
        'https://www2.hm.com/en_gb/ladies/shop-by-product/tops.html'
      );

      expect(lookupCatalogPrices).toHaveBeenCalledWith(
        'https://www2.hm.com/en_gb/ladies/shop-by-product/tops.html'
      );
      expect(result).toEqual({ '1247834001': 19.99, '0987654321': 29.99 });
    });

    it('falls back to individual lookups for PIDs not in catalog', async () => {
      const { lookupCatalogPrices, lookupPrice } = await import('../src/providers/hm');
      vi.mocked(lookupCatalogPrices).mockResolvedValue({
        '1247834001': 19.99,
      });
      vi.mocked(lookupPrice).mockResolvedValue(29.99);

      const pidToUrl = {
        '1247834001': 'https://www2.hm.com/en_gb/productpage.1247834001.html',
        '9999999999': 'https://www2.hm.com/en_gb/productpage.9999999999.html',
      };

      const result = await hm.lookupPrices(
        ['1247834001', '9999999999'],
        'uk',
        pidToUrl,
        'https://www2.hm.com/en_gb/ladies/shop-by-product/tops.html'
      );

      expect(lookupCatalogPrices).toHaveBeenCalled();
      expect(lookupPrice).toHaveBeenCalledWith('9999999999', 'uk', hm.sites);
      expect(result).toEqual({ '1247834001': 19.99, '9999999999': 29.99 });
    });

    it('does not call individual lookups when all PIDs found in catalog', async () => {
      const { lookupCatalogPrices, lookupPrice } = await import('../src/providers/hm');
      vi.mocked(lookupCatalogPrices).mockResolvedValue({
        '1247834001': 19.99,
        '0987654321': 29.99,
      });

      await hm.lookupPrices(
        ['1247834001', '0987654321'],
        'uk',
        {},
        'https://www2.hm.com/en_gb/ladies/tops.html'
      );

      expect(lookupPrice).not.toHaveBeenCalled();
    });

    it('uses individual lookups when no catalogUrl provided', async () => {
      const { lookupCatalogPrices, lookupPrice } = await import('../src/providers/hm');
      vi.mocked(lookupPrice).mockResolvedValue(19.99);

      const result = await hm.lookupPrices(['1247834001'], 'uk');

      expect(lookupCatalogPrices).not.toHaveBeenCalled();
      expect(lookupPrice).toHaveBeenCalledWith('1247834001', 'uk', hm.sites);
      expect(result).toEqual({ '1247834001': 19.99 });
    });
  });
});
