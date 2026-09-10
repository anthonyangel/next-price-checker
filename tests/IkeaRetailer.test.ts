import { vi, beforeEach, afterEach } from 'vitest';
import { IkeaRetailer } from '../src/retailers/ikea/IkeaRetailer';

vi.mock('../src/logger', () => ({
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../src/providers/ikea', async () => {
  const actual = await vi.importActual<typeof import('../src/providers/ikea')>(
    '../src/providers/ikea'
  );
  return {
    ...actual,
    lookupPrice: vi.fn(),
    lookupCatalogPrices: vi.fn(),
  };
});

const UK_PDP = 'https://www.ikea.com/gb/en/p/billy-bookcase-white-00263850/';
const IL_PDP = 'https://www.ikea.com/il/he/p/billy-bookcase-white-00263850/';
const UK_CAT = 'https://www.ikea.com/gb/en/cat/bookcases-10382/';
const IL_CAT = 'https://www.ikea.com/il/he/cat/bookcases-10382/';

describe('IkeaRetailer', () => {
  const ikea = new IkeaRetailer();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('identity', () => {
    it('has the expected id and name', () => {
      expect(ikea.id).toBe('ikea');
      expect(ikea.name).toBe('IKEA');
    });

    it('supports both product and catalog pages', () => {
      expect(ikea.supportsProductPage).toBe(true);
      expect(ikea.supportsCatalogPage).toBe(true);
    });
  });

  describe('getRegionForUrl', () => {
    it('returns uk for a /gb/en/ product URL', () => {
      expect(ikea.getRegionForUrl(new URL(UK_PDP))).toBe('uk');
    });

    it('returns il for a /il/he/ product URL', () => {
      expect(ikea.getRegionForUrl(new URL(IL_PDP))).toBe('il');
    });

    it('returns uk for a /gb/en/ catalog URL', () => {
      expect(ikea.getRegionForUrl(new URL(UK_CAT))).toBe('uk');
    });

    it('returns il for a /il/he/ catalog URL', () => {
      expect(ikea.getRegionForUrl(new URL(IL_CAT))).toBe('il');
    });

    it('returns null for an unsupported locale on the same hostname', () => {
      expect(
        ikea.getRegionForUrl(new URL('https://www.ikea.com/us/en/p/billy-bookcase-white-00263850/'))
      ).toBeNull();
    });

    it('returns null for the hostname root (no region prefix)', () => {
      expect(ikea.getRegionForUrl(new URL('https://www.ikea.com/'))).toBeNull();
    });

    it('returns null for a non-IKEA hostname', () => {
      expect(ikea.getRegionForUrl(new URL('https://www.next.co.uk/'))).toBeNull();
    });
  });

  describe('isCatalogPage', () => {
    it('returns true for a UK category page', () => {
      expect(ikea.isCatalogPage(new URL(UK_CAT))).toBe(true);
    });

    it('returns true for an IL category page', () => {
      expect(ikea.isCatalogPage(new URL(IL_CAT))).toBe(true);
    });

    it('returns true for a UK search page', () => {
      expect(ikea.isCatalogPage(new URL('https://www.ikea.com/gb/en/search/?q=billy'))).toBe(true);
    });

    it('returns true for an IL search page', () => {
      expect(ikea.isCatalogPage(new URL('https://www.ikea.com/il/he/search/?q=billy'))).toBe(true);
    });

    it('returns false for a product page', () => {
      expect(ikea.isCatalogPage(new URL(UK_PDP))).toBe(false);
      expect(ikea.isCatalogPage(new URL(IL_PDP))).toBe(false);
    });

    it('returns false for the region homepage', () => {
      expect(ikea.isCatalogPage(new URL('https://www.ikea.com/gb/en/'))).toBe(false);
    });

    it('returns false for a non-IKEA URL', () => {
      expect(ikea.isCatalogPage(new URL('https://www.zara.com/uk/'))).toBe(false);
    });
  });

  describe('transformUrl', () => {
    it('transforms a UK product URL to IL', () => {
      expect(ikea.transformUrl(new URL(UK_PDP), 'uk', 'il')).toBe(IL_PDP);
    });

    it('transforms an IL product URL to UK', () => {
      expect(ikea.transformUrl(new URL(IL_PDP), 'il', 'uk')).toBe(UK_PDP);
    });

    it('transforms a UK catalog URL to IL', () => {
      expect(ikea.transformUrl(new URL(UK_CAT), 'uk', 'il')).toBe(IL_CAT);
    });

    it('round-trips UK → IL → UK unchanged', () => {
      const il = ikea.transformUrl(new URL(UK_PDP), 'uk', 'il');
      expect(ikea.transformUrl(new URL(il), 'il', 'uk')).toBe(UK_PDP);
    });

    it('round-trips IL → UK → IL unchanged', () => {
      const uk = ikea.transformUrl(new URL(IL_PDP), 'il', 'uk');
      expect(ikea.transformUrl(new URL(uk), 'uk', 'il')).toBe(IL_PDP);
    });

    it('preserves the query string', () => {
      expect(ikea.transformUrl(new URL(`${UK_CAT}?sort=PRICE_LOW_TO_HIGH`), 'uk', 'il')).toBe(
        `${IL_CAT}?sort=PRICE_LOW_TO_HIGH`
      );
    });

    it('preserves the hash fragment', () => {
      expect(ikea.transformUrl(new URL(`${UK_PDP}#reviews`), 'uk', 'il')).toBe(`${IL_PDP}#reviews`);
    });

    it('preserves both query string and hash together', () => {
      expect(ikea.transformUrl(new URL(`${UK_PDP}?a=1#buy`), 'uk', 'il')).toBe(`${IL_PDP}?a=1#buy`);
    });

    it('maps the region homepage to the other region homepage', () => {
      expect(ikea.transformUrl(new URL('https://www.ikea.com/gb/en/'), 'uk', 'il')).toBe(
        'https://www.ikea.com/il/he/'
      );
    });

    it('throws for an unknown source region', () => {
      expect(() => ikea.transformUrl(new URL(UK_PDP), 'us', 'il')).toThrow(/Unknown region/);
    });

    it('throws for an unknown target region', () => {
      expect(() => ikea.transformUrl(new URL(UK_PDP), 'uk', 'us')).toThrow(/Unknown region/);
    });
  });

  describe('extractProductId', () => {
    it('extracts an 8-digit article number from a slugged UK URL', () => {
      expect(ikea.extractProductId(new URL(UK_PDP))).toBe('00263850');
    });

    it('extracts the same article number from the IL URL', () => {
      expect(ikea.extractProductId(new URL(IL_PDP))).toBe('00263850');
    });

    it('extracts an s-prefixed article number for combination products', () => {
      expect(
        ikea.extractProductId(
          new URL('https://www.ikea.com/gb/en/p/kivik-3-seat-sofa-tibbleby-beige-grey-s69440596/')
        )
      ).toBe('s69440596');
    });

    it('extracts from a slug-less product URL', () => {
      expect(ikea.extractProductId(new URL('https://www.ikea.com/gb/en/p/00263850/'))).toBe(
        '00263850'
      );
    });

    it('extracts when the URL has no trailing slash', () => {
      expect(
        ikea.extractProductId(new URL('https://www.ikea.com/gb/en/p/billy-bookcase-white-00263850'))
      ).toBe('00263850');
    });

    it('ignores digits inside the slug and takes the trailing article number', () => {
      expect(
        ikea.extractProductId(
          new URL('https://www.ikea.com/gb/en/p/kallax-shelving-unit-white-80x147-cm-80275887/')
        )
      ).toBe('80275887');
    });

    it('returns null for a catalog URL', () => {
      expect(ikea.extractProductId(new URL(UK_CAT))).toBeNull();
    });

    it('returns null for the homepage', () => {
      expect(ikea.extractProductId(new URL('https://www.ikea.com/gb/en/'))).toBeNull();
    });

    it('returns null for a /p/ URL with no article number', () => {
      expect(ikea.extractProductId(new URL('https://www.ikea.com/gb/en/p/some-slug/'))).toBeNull();
    });
  });

  describe('extractProductIdFromElement', () => {
    /**
     * Minimal stand-in for a catalog card element. The project runs tests in a
     * Node environment with no DOM implementation, so we model only the three
     * members extractProductIdFromElement touches.
     */
    function fakeCard(ownAttr: string | null, descendantAttr?: string): Element {
      return {
        hasAttribute: (name: string) => name === 'data-product-number' && ownAttr !== null,
        getAttribute: (name: string) =>
          name === 'data-product-number' ? ownAttr : null,
        querySelector: (sel: string) =>
          sel === '[data-product-number]' && descendantAttr
            ? { getAttribute: () => descendantAttr }
            : null,
      } as unknown as Element;
    }

    it('reads data-product-number from the card element itself', () => {
      expect(ikea.extractProductIdFromElement(fakeCard('00263850'))).toBe('00263850');
    });

    it('reads data-product-number from a descendant', () => {
      expect(ikea.extractProductIdFromElement(fakeCard(null, 's69440596'))).toBe('s69440596');
    });

    it('returns null when no article number is present', () => {
      expect(ikea.extractProductIdFromElement(fakeCard(null))).toBeNull();
    });

    it('matches extractProductId for the same product (cross-region consistency)', () => {
      // The catalog attribute and the URL segment must agree, or cross-region
      // catalog matching silently fails.
      expect(ikea.extractProductIdFromElement(fakeCard('00263850'))).toBe(
        ikea.extractProductId(new URL(IL_PDP))
      );
    });
  });

  describe('constructProductUrl', () => {
    it('builds a UK product URL', () => {
      expect(ikea.constructProductUrl('00263850', 'uk')).toBe(
        'https://www.ikea.com/gb/en/p/00263850/'
      );
    });

    it('builds an IL product URL', () => {
      expect(ikea.constructProductUrl('00263850', 'il')).toBe(
        'https://www.ikea.com/il/he/p/00263850/'
      );
    });

    it('returns null for an unknown region', () => {
      expect(ikea.constructProductUrl('00263850', 'us')).toBeNull();
    });

    it('marks constructed URLs as valid (IKEA redirects slug-less URLs)', () => {
      expect(ikea.constructedUrlsAreValid).toBe(true);
    });

    it('produces a URL that extractProductId can read back', () => {
      const url = ikea.constructProductUrl('s69440596', 'uk')!;
      expect(ikea.extractProductId(new URL(url))).toBe('s69440596');
    });
  });

  describe('getAlternateRegionId', () => {
    it('returns il for uk', () => {
      expect(ikea.getAlternateRegionId('uk')).toBe('il');
    });

    it('returns uk for il', () => {
      expect(ikea.getAlternateRegionId('il')).toBe('uk');
    });
  });

  describe('selectors', () => {
    it('defines a price selector scoped to the current price', () => {
      expect(ikea.priceSelector).toBeTruthy();
      expect(ikea.priceSelector).toContain('current-price');
    });

    it('scopes the price selector to the inner span, not the SR-text wrapper', () => {
      expect(ikea.priceSelector).toContain('__nowrap');
    });

    it('defines a product container selector', () => {
      expect(ikea.productContainerSelector).toBeTruthy();
    });

    it('defines product container fallback selectors', () => {
      expect(ikea.productContainerFallbackSelectors.length).toBeGreaterThan(0);
    });

    it('defines catalog price fallback selectors scoped to the current price', () => {
      expect(ikea.catalogPriceFallbackSelectors.length).toBeGreaterThan(0);
      for (const sel of ikea.catalogPriceFallbackSelectors) {
        expect(sel).toContain('current-price');
      }
    });
  });

  describe('extractPriceFromPage', () => {
    /**
     * Stub `document` with just the JSON-LD script blocks the method reads.
     * Tests run in a Node environment, so there is no real DOM to populate.
     */
    function stubLdJsonScripts(...payloads: string[]) {
      vi.stubGlobal('document', {
        querySelectorAll: (sel: string) =>
          sel === 'script[type="application/ld+json"]'
            ? payloads.map((textContent) => ({ textContent }))
            : [],
      });
    }

    // Restore only `document` — vi.unstubAllGlobals() would also clear the
    // `chrome` global that tests/setup.ts installs for every test.
    afterEach(() => {
      vi.stubGlobal('document', undefined);
    });

    it('reads the price from schema.org JSON-LD', () => {
      stubLdJsonScripts(
        JSON.stringify({
          '@type': 'Product',
          offers: { '@type': 'Offer', price: '55', priceCurrency: 'GBP' },
        })
      );
      expect(ikea.extractPriceFromPage(new URL(UK_PDP))).toBe('55');
    });

    it('reads the discounted price from an AggregateOffer', () => {
      stubLdJsonScripts(
        JSON.stringify({
          '@type': 'Product',
          offers: {
            '@type': 'AggregateOffer',
            highPrice: '499',
            lowPrice: '449',
            offers: [{ '@type': 'Offer', price: '449', priceCurrency: 'GBP' }],
          },
        })
      );
      expect(ikea.extractPriceFromPage(new URL(UK_PDP))).toBe('449');
    });

    it('skips non-Product JSON-LD blocks', () => {
      stubLdJsonScripts(
        JSON.stringify({ '@type': 'BreadcrumbList', itemListElement: [] }),
        JSON.stringify({
          '@type': 'Product',
          offers: { '@type': 'Offer', price: '445', priceCurrency: 'ILS' },
        })
      );
      expect(ikea.extractPriceFromPage(new URL(IL_PDP))).toBe('445');
    });

    it('returns null when there is no JSON-LD', () => {
      stubLdJsonScripts();
      expect(ikea.extractPriceFromPage(new URL(UK_PDP))).toBeNull();
    });

    it('returns null when the JSON-LD is malformed', () => {
      stubLdJsonScripts('{ not json ');
      expect(ikea.extractPriceFromPage(new URL(UK_PDP))).toBeNull();
    });

    it('returns null when a script block is empty', () => {
      stubLdJsonScripts('');
      expect(ikea.extractPriceFromPage(new URL(UK_PDP))).toBeNull();
    });
  });

  describe('lookupPrice', () => {
    it('delegates to the provider with the retailer sites and product URL', async () => {
      const provider = await import('../src/providers/ikea');
      vi.mocked(provider.lookupPrice).mockResolvedValueOnce(55);

      const price = await ikea.lookupPrice('00263850', 'uk', UK_PDP);

      expect(price).toBe(55);
      expect(provider.lookupPrice).toHaveBeenCalledWith('00263850', 'uk', ikea.sites, UK_PDP);
    });
  });

  describe('lookupPrices', () => {
    it('uses the catalog page when a catalog URL is supplied', async () => {
      const provider = await import('../src/providers/ikea');
      vi.mocked(provider.lookupCatalogPrices).mockResolvedValueOnce({
        '00263850': 445,
        '50263838': 285,
      });

      const prices = await ikea.lookupPrices(['00263850', '50263838'], 'il', undefined, IL_CAT);

      expect(prices).toEqual({ '00263850': 445, '50263838': 285 });
      expect(provider.lookupCatalogPrices).toHaveBeenCalledWith(IL_CAT);
      expect(provider.lookupPrice).not.toHaveBeenCalled();
    });

    it('falls back to individual lookups for PIDs the catalog missed', async () => {
      const provider = await import('../src/providers/ikea');
      vi.mocked(provider.lookupCatalogPrices).mockResolvedValueOnce({ '00263850': 445 });
      vi.mocked(provider.lookupPrice).mockResolvedValueOnce(999);

      const prices = await ikea.lookupPrices(['00263850', 's69440596'], 'il', undefined, IL_CAT);

      expect(prices).toEqual({ '00263850': 445, s69440596: 999 });
      expect(provider.lookupPrice).toHaveBeenCalledTimes(1);
    });

    it('uses individual lookups when no catalog URL is supplied', async () => {
      const provider = await import('../src/providers/ikea');
      vi.mocked(provider.lookupPrice).mockResolvedValue(55);

      const prices = await ikea.lookupPrices(['00263850'], 'uk');

      expect(prices).toEqual({ '00263850': 55 });
      expect(provider.lookupCatalogPrices).not.toHaveBeenCalled();
    });
  });
});
