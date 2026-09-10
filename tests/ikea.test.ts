import { vi, beforeEach } from 'vitest';
import {
  lookupPrice,
  lookupCatalogPrices,
  parseCatalogHtml,
  parsePriceFromHtml,
  extractPriceFromLdJson,
  extractPriceFromPriceModule,
  buildProductUrl,
} from '../src/providers/ikea';
import type { RetailerSite } from '../src/core/AbstractRetailer';

vi.mock('../src/logger', () => ({
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const sites: Record<string, RetailerSite> = {
  uk: {
    hostnames: ['www.ikea.com'],
    pathPrefix: '/gb/en',
    catalogPathPattern: /^\/gb\/en\/(cat|search)\//,
  },
  il: {
    hostnames: ['www.ikea.com'],
    pathPrefix: '/il/he',
    catalogPathPattern: /^\/il\/he\/(cat|search)\//,
  },
};

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.restoreAllMocks();
  mockFetch = vi.fn();
  vi.stubGlobal('fetch', mockFetch);
});

/** Build a JSON-LD script block as it appears on an IKEA product page. */
function ldJson(node: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(node)}</script>`;
}

/** A full-price product page. */
function productHtml(price: string, currency = 'GBP'): string {
  return `<html><head>${ldJson({
    '@context': 'https://schema.org/',
    '@type': 'Product',
    name: 'BILLY',
    offers: {
      '@type': 'Offer',
      availability: 'https://schema.org/InStock',
      price,
      priceCurrency: currency,
    },
  })}</head><body></body></html>`;
}

/** A discounted product page — AggregateOffer with highPrice = pre-sale figure. */
function saleProductHtml(current: string, previous: string): string {
  return `<html><head>${ldJson({
    '@context': 'https://schema.org/',
    '@type': 'Product',
    name: 'KIVIK',
    offers: {
      '@type': 'AggregateOffer',
      highPrice: previous,
      lowPrice: current,
      offercount: 1,
      offers: [{ '@type': 'Offer', price: current, priceCurrency: 'GBP' }],
    },
  })}</head><body></body></html>`;
}

/** A catalog product card as IKEA server-renders it. */
function card(pid: string, price: string, currency = 'GBP'): string {
  return (
    `<div class="plp-mastercard plp-fragment-wrapper" data-ref-id="${pid}" ` +
    `data-product-number="${pid}" data-price="${price}" data-currency="${currency}" ` +
    `data-product-name="BILLY" data-testid="plp-product-card"></div>`
  );
}

function okResponse(html: string, extra: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    redirected: false,
    url: 'https://www.ikea.com/gb/en/p/billy-bookcase-white-00263850/',
    text: () => Promise.resolve(html),
    ...extra,
  };
}

describe('buildProductUrl', () => {
  it('builds a slug-less UK product URL', () => {
    expect(buildProductUrl('00263850', sites.uk)).toBe(
      'https://www.ikea.com/gb/en/p/00263850/'
    );
  });

  it('builds a slug-less IL product URL', () => {
    expect(buildProductUrl('00263850', sites.il)).toBe(
      'https://www.ikea.com/il/he/p/00263850/'
    );
  });

  it('handles s-prefixed combination article numbers', () => {
    expect(buildProductUrl('s69440596', sites.uk)).toBe(
      'https://www.ikea.com/gb/en/p/s69440596/'
    );
  });
});

describe('lookupPrice', () => {
  it('returns the price from a valid UK product page', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(productHtml('55')));

    const price = await lookupPrice('00263850', 'uk', sites);

    expect(price).toBe(55);
    expect(mockFetch).toHaveBeenCalledWith('https://www.ikea.com/gb/en/p/00263850/', {
      credentials: 'omit',
    });
  });

  it('returns the price from a valid IL product page', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(productHtml('445', 'ILS')));

    const price = await lookupPrice('00263850', 'il', sites);

    expect(price).toBe(445);
    expect(mockFetch).toHaveBeenCalledWith('https://www.ikea.com/il/he/p/00263850/', {
      credentials: 'omit',
    });
  });

  it('prefers a supplied product URL over a constructed one', async () => {
    const real = 'https://www.ikea.com/il/he/p/billy-bookcase-white-00263850/';
    mockFetch.mockResolvedValueOnce(okResponse(productHtml('445', 'ILS')));

    await lookupPrice('00263850', 'il', sites, real);

    expect(mockFetch).toHaveBeenCalledWith(real, { credentials: 'omit' });
  });

  it('returns the discounted price for a sale item, not the previous price', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(saleProductHtml('449', '499')));

    expect(await lookupPrice('s69440596', 'uk', sites)).toBe(449);
  });

  it('returns null for an unknown region without fetching', async () => {
    expect(await lookupPrice('00263850', 'us', sites)).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns null on a 404 response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    expect(await lookupPrice('00263850', 'uk', sites)).toBeNull();
  });

  it('returns null on a 500 response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    expect(await lookupPrice('00263850', 'uk', sites)).toBeNull();
  });

  it('returns null when the page has no price', async () => {
    mockFetch.mockResolvedValueOnce(okResponse('<html><body>no price here</body></html>'));
    expect(await lookupPrice('00263850', 'uk', sites)).toBeNull();
  });

  it('returns null when redirected away from a product page', async () => {
    // A non-existent article redirects to a category listing with HTTP 200.
    mockFetch.mockResolvedValueOnce(
      okResponse(productHtml('55'), {
        redirected: true,
        url: 'https://www.ikea.com/gb/en/cat/products-products/',
      })
    );

    expect(await lookupPrice('99999999', 'uk', sites)).toBeNull();
  });

  it('accepts a redirect that lands on the canonical product page', async () => {
    // Slug-less URLs legitimately redirect to the slugged canonical URL.
    mockFetch.mockResolvedValueOnce(
      okResponse(productHtml('55'), {
        redirected: true,
        url: 'https://www.ikea.com/gb/en/p/billy-bookcase-white-00263850/',
      })
    );

    expect(await lookupPrice('00263850', 'uk', sites)).toBe(55);
  });

  it('returns null on a network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    expect(await lookupPrice('00263850', 'uk', sites)).toBeNull();
  });
});

describe('lookupCatalogPrices', () => {
  it('parses every card on a category page', async () => {
    const html = `<div class="plp-product-list__products">
      ${card('00263850', '55')}${card('50263838', '35')}${card('s29281066', '120')}
    </div>`;
    mockFetch.mockResolvedValueOnce(okResponse(html));

    expect(await lookupCatalogPrices('https://www.ikea.com/gb/en/cat/bookcases-10382/')).toEqual({
      '00263850': 55,
      '50263838': 35,
      s29281066: 120,
    });
  });

  it('returns an empty map on an HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });
    expect(await lookupCatalogPrices('https://www.ikea.com/gb/en/cat/x/')).toEqual({});
  });

  it('returns an empty map on a network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('offline'));
    expect(await lookupCatalogPrices('https://www.ikea.com/gb/en/cat/x/')).toEqual({});
  });

  it('returns an empty map for a client-rendered search page', async () => {
    // Search results are hydrated client-side, so the raw HTML has no cards.
    mockFetch.mockResolvedValueOnce(okResponse('<div id="search-results"></div>'));
    expect(await lookupCatalogPrices('https://www.ikea.com/gb/en/search/?q=billy')).toEqual({});
  });
});

describe('parseCatalogHtml', () => {
  it('maps article numbers to prices', () => {
    expect(parseCatalogHtml(card('00263850', '55') + card('50263838', '35'))).toEqual({
      '00263850': 55,
      '50263838': 35,
    });
  });

  it('handles s-prefixed combination article numbers', () => {
    expect(parseCatalogHtml(card('s69440596', '449'))).toEqual({ s69440596: 449 });
  });

  it('handles decimal prices', () => {
    expect(parseCatalogHtml(card('12345678', '4.50'))).toEqual({ '12345678': 4.5 });
  });

  it('reads ILS prices the same way as GBP', () => {
    expect(parseCatalogHtml(card('00263850', '445', 'ILS'))).toEqual({ '00263850': 445 });
  });

  it('uses the discounted price for sale cards', () => {
    // data-price carries the current price; the previous price lives in a
    // separate addon element and must not be picked up.
    const saleCard =
      card('s69440596', '449') +
      `<div class="plp-price-module__addon"><span class="plp-price__integer">499</span></div>`;
    expect(parseCatalogHtml(saleCard)).toEqual({ s69440596: 449 });
  });

  it('returns an empty map when there are no cards', () => {
    expect(parseCatalogHtml('<html><body>nothing</body></html>')).toEqual({});
  });

  it('skips cards with a zero price', () => {
    expect(parseCatalogHtml(card('00263850', '0'))).toEqual({});
  });

  it('keeps the first price when an article appears twice', () => {
    expect(parseCatalogHtml(card('00263850', '55') + card('00263850', '99'))).toEqual({
      '00263850': 55,
    });
  });

  it('does not pair one card\'s article number with another card\'s price', () => {
    // A card missing data-price must not absorb the next card's price.
    const broken =
      `<div data-product-number="11111111" data-testid="plp-product-card"></div>` +
      card('22222222', '35');
    expect(parseCatalogHtml(broken)).toEqual({ '22222222': 35 });
  });
});

describe('extractPriceFromLdJson', () => {
  it('reads a plain Offer price', () => {
    expect(extractPriceFromLdJson(productHtml('55'))).toBe(55);
  });

  it('reads the nested Offer price from an AggregateOffer', () => {
    expect(extractPriceFromLdJson(saleProductHtml('449', '499'))).toBe(449);
  });

  it('never returns highPrice for a discounted product', () => {
    expect(extractPriceFromLdJson(saleProductHtml('449', '499'))).not.toBe(499);
  });

  it('falls back to lowPrice when an AggregateOffer has no nested offers', () => {
    const html = ldJson({
      '@type': 'Product',
      offers: { '@type': 'AggregateOffer', highPrice: '499', lowPrice: '449' },
    });
    expect(extractPriceFromLdJson(html)).toBe(449);
  });

  it('handles a numeric (non-string) price', () => {
    const html = ldJson({ '@type': 'Product', offers: { '@type': 'Offer', price: 55 } });
    expect(extractPriceFromLdJson(html)).toBe(55);
  });

  it('handles decimal prices', () => {
    expect(extractPriceFromLdJson(productHtml('4.50'))).toBe(4.5);
  });

  it('skips non-Product nodes and finds the Product', () => {
    const html =
      ldJson({ '@type': 'BreadcrumbList', itemListElement: [] }) +
      productHtml('445', 'ILS') +
      ldJson({ '@type': '3DModel', name: 'x' });
    expect(extractPriceFromLdJson(html)).toBe(445);
  });

  it('handles a JSON-LD array payload', () => {
    const html = ldJson([
      { '@type': 'BreadcrumbList' },
      { '@type': 'Product', offers: { '@type': 'Offer', price: '99' } },
    ]);
    expect(extractPriceFromLdJson(html)).toBe(99);
  });

  it('skips malformed JSON and keeps looking', () => {
    const html = '<script type="application/ld+json">{ broken </script>' + productHtml('55');
    expect(extractPriceFromLdJson(html)).toBe(55);
  });

  it('returns null when there is no JSON-LD', () => {
    expect(extractPriceFromLdJson('<html><body>nothing</body></html>')).toBeNull();
  });

  it('returns null when the Product has no offers', () => {
    expect(extractPriceFromLdJson(ldJson({ '@type': 'Product', name: 'BILLY' }))).toBeNull();
  });
});

describe('extractPriceFromPriceModule', () => {
  const saleModule =
    `<span class="pipcom-price-module__comparison-price">` +
    `<span class="pipcom-price__integer">499</span></span>` +
    `<span class="pipcom-price-module__current-price">` +
    `<span class="pipcom-price__currency">£</span>` +
    `<span class="pipcom-price__integer">449</span></span>`;

  it('reads the current price', () => {
    expect(
      extractPriceFromPriceModule(
        `<span class="pipcom-price-module__current-price"><span class="pipcom-price__integer">55</span></span>`
      )
    ).toBe(55);
  });

  it('reads the current price and ignores the earlier previous price', () => {
    expect(extractPriceFromPriceModule(saleModule)).toBe(449);
  });

  it('combines integer and decimal parts', () => {
    expect(
      extractPriceFromPriceModule(
        `<span class="pipcom-price-module__current-price">` +
          `<span class="pipcom-price__integer">4</span>` +
          `<span class="pipcom-price__decimal">50</span></span>`
      )
    ).toBe(4.5);
  });

  it('strips thousands separators', () => {
    expect(
      extractPriceFromPriceModule(
        `<span class="pipcom-price-module__current-price"><span class="pipcom-price__integer">1,299</span></span>`
      )
    ).toBe(1299);
  });

  it('returns null when the price module is absent', () => {
    expect(extractPriceFromPriceModule('<div>no price</div>')).toBeNull();
  });
});

describe('parsePriceFromHtml', () => {
  it('prefers JSON-LD when present', () => {
    expect(parsePriceFromHtml(productHtml('55'), '00263850')).toBe(55);
  });

  it('falls back to the price module when JSON-LD is missing', () => {
    const html =
      `<span class="pipcom-price-module__current-price"><span class="pipcom-price__integer">55</span></span>`;
    expect(parsePriceFromHtml(html, '00263850')).toBe(55);
  });

  it('falls back to the price module when JSON-LD is malformed', () => {
    const html =
      '<script type="application/ld+json">{ broken </script>' +
      `<span class="pipcom-price-module__current-price"><span class="pipcom-price__integer">449</span></span>`;
    expect(parsePriceFromHtml(html, 's69440596')).toBe(449);
  });

  it('returns null when neither source has a price', () => {
    expect(parsePriceFromHtml('<html><body>nothing</body></html>', '00263850')).toBeNull();
  });
});
