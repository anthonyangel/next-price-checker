import { vi, beforeEach, afterEach } from 'vitest';
import {
  lookupPrice,
  parsePriceFromHtml,
  parsePriceFromNextData,
  parsePriceFromJsonLd,
  parseCatalogHtml,
} from '../src/providers/hm';

vi.mock('../src/logger', () => ({
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const sites = {
  uk: {
    hostnames: ['www2.hm.com'],
    pathPrefix: '/en_gb',
    catalogPathPattern: /^\/en_gb\/(?!productpage\.).*\.html$/,
  },
  il: {
    hostnames: ['www2.hm.com'],
    pathPrefix: '/hw_il',
    catalogPathPattern: /^\/hw_il\/(?!productpage\.).*\.html$/,
  },
};

/** Build a minimal HTML page with __NEXT_DATA__ JSON. */
function makeNextDataHtml(nextData: unknown): string {
  return `<html><head><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script></head><body></body></html>`;
}

/** Build __NEXT_DATA__ for a product page with the given article and price. */
function makeProductNextData(pid: string, whitePrice: string, redPrice?: string) {
  return {
    props: {
      pageProps: {
        productPageProps: {
          aemData: {
            productArticleDetails: {
              articleCode: pid,
              variations: {
                [pid]: {
                  name: 'Black',
                  whitePriceValue: whitePrice,
                  ...(redPrice ? { redPriceValue: redPrice } : {}),
                },
              },
            },
          },
        },
      },
    },
  };
}

/** Build HTML with JSON-LD structured data. */
function makeJsonLdHtml(price: string, currency: string): string {
  const jsonLd = {
    '@type': 'Product',
    name: 'Test Product',
    offers: [{ price, priceCurrency: currency }],
  };
  return `<html><head><script type="application/ld+json">${JSON.stringify(jsonLd)}</script></head><body></body></html>`;
}

describe('parsePriceFromNextData', () => {
  it('parses regular price (whitePriceValue)', () => {
    const html = makeNextDataHtml(makeProductNextData('1247834001', '19.99'));
    expect(parsePriceFromNextData(html, '1247834001')).toBe(19.99);
  });

  it('prefers sale price (redPriceValue) over regular', () => {
    const html = makeNextDataHtml(makeProductNextData('1247834001', '19.99', '14.99'));
    expect(parsePriceFromNextData(html, '1247834001')).toBe(14.99);
  });

  it('parses ILS price', () => {
    const html = makeNextDataHtml(makeProductNextData('1247834001', '89.90'));
    expect(parsePriceFromNextData(html, '1247834001')).toBe(89.9);
  });

  it('handles price with currency symbol in string', () => {
    const html = makeNextDataHtml(makeProductNextData('1247834001', '£19.99'));
    expect(parsePriceFromNextData(html, '1247834001')).toBe(19.99);
  });

  it('returns null when __NEXT_DATA__ is missing', () => {
    const html = '<html><body>No next data</body></html>';
    expect(parsePriceFromNextData(html, '1247834001')).toBeNull();
  });

  it('returns null when productArticleDetails is missing', () => {
    const html = makeNextDataHtml({ props: { pageProps: {} } });
    expect(parsePriceFromNextData(html, '1247834001')).toBeNull();
  });

  it('returns null when article code not found in variations', () => {
    const html = makeNextDataHtml(makeProductNextData('9999999999', '19.99'));
    expect(parsePriceFromNextData(html, '1247834001')).toBeNull();
  });

  it('returns null for invalid price text', () => {
    const html = makeNextDataHtml(makeProductNextData('1247834001', 'TBD'));
    expect(parsePriceFromNextData(html, '1247834001')).toBeNull();
  });

  it('returns null when __NEXT_DATA__ is invalid JSON', () => {
    const html = '<html><head><script id="__NEXT_DATA__">{invalid json</script></head></html>';
    expect(parsePriceFromNextData(html, '1247834001')).toBeNull();
  });
});

describe('parsePriceFromJsonLd', () => {
  it('extracts price from JSON-LD Product markup', () => {
    const html = makeJsonLdHtml('19.99', 'GBP');
    expect(parsePriceFromJsonLd(html)).toBe(19.99);
  });

  it('extracts price from ILS JSON-LD', () => {
    const html = makeJsonLdHtml('89.90', 'ILS');
    expect(parsePriceFromJsonLd(html)).toBe(89.9);
  });

  it('returns null when no JSON-LD present', () => {
    expect(parsePriceFromJsonLd('<html><body></body></html>')).toBeNull();
  });

  it('returns null when JSON-LD has no Product type', () => {
    const html = `<script type="application/ld+json">{"@type":"Organization","name":"H&M"}</script>`;
    expect(parsePriceFromJsonLd(html)).toBeNull();
  });

  it('returns null for invalid JSON-LD', () => {
    const html = `<script type="application/ld+json">{invalid}</script>`;
    expect(parsePriceFromJsonLd(html)).toBeNull();
  });

  it('handles array of JSON-LD objects', () => {
    const jsonLd = [
      { '@type': 'BreadcrumbList' },
      { '@type': 'Product', offers: [{ price: '29.99', priceCurrency: 'GBP' }] },
    ];
    const html = `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`;
    expect(parsePriceFromJsonLd(html)).toBe(29.99);
  });
});

describe('parsePriceFromHtml', () => {
  it('uses __NEXT_DATA__ as primary source', () => {
    const html = makeNextDataHtml(makeProductNextData('1247834001', '19.99'));
    expect(parsePriceFromHtml(html, '1247834001')).toBe(19.99);
  });

  it('falls back to JSON-LD when __NEXT_DATA__ has no price', () => {
    const jsonLd = { '@type': 'Product', offers: [{ price: '29.99' }] };
    const html = `<html><head><script type="application/ld+json">${JSON.stringify(jsonLd)}</script></head></html>`;
    expect(parsePriceFromHtml(html, '1247834001')).toBe(29.99);
  });

  it('returns null when no price source found', () => {
    expect(parsePriceFromHtml('<html><body></body></html>', '1247834001')).toBeNull();
  });
});

describe('lookupPrice', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns price from valid __NEXT_DATA__ response', async () => {
    const html = makeNextDataHtml(makeProductNextData('1247834001', '19.99'));
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      text: async () => html,
    } as Response);

    const price = await lookupPrice('1247834001', 'uk', sites);
    expect(price).toBe(19.99);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://www2.hm.com/en_gb/productpage.1247834001.html',
      { credentials: 'include' }
    );
  });

  it('constructs correct URL for IL region', async () => {
    const html = makeNextDataHtml(makeProductNextData('1247834001', '89.90'));
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      text: async () => html,
    } as Response);

    const price = await lookupPrice('1247834001', 'il', sites);
    expect(price).toBe(89.9);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://www2.hm.com/hw_il/productpage.1247834001.html',
      { credentials: 'include' }
    );
  });

  it('returns null on 404', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: false,
      status: 404,
    } as Response);

    const price = await lookupPrice('9999999999', 'uk', sites);
    expect(price).toBeNull();
  });

  it('retries without cookies on 403', async () => {
    const html = makeNextDataHtml(makeProductNextData('1247834001', '19.99'));
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce({ ok: false, status: 403 } as Response)
      .mockResolvedValueOnce({ ok: true, text: async () => html } as Response);

    const price = await lookupPrice('1247834001', 'uk', sites);
    expect(price).toBe(19.99);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch).toHaveBeenNthCalledWith(1, expect.any(String), {
      credentials: 'include',
    });
    expect(globalThis.fetch).toHaveBeenNthCalledWith(2, expect.any(String), {
      credentials: 'omit',
    });
  });

  it('returns null when price not found in HTML', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      text: async () => '<html><body>No price here</body></html>',
    } as Response);

    const price = await lookupPrice('1247834001', 'uk', sites);
    expect(price).toBeNull();
  });

  it('returns null on network error', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error('Network error'));

    const price = await lookupPrice('1247834001', 'uk', sites);
    expect(price).toBeNull();
  });

  it('returns null for unknown region', async () => {
    const price = await lookupPrice('1247834001', 'us', sites);
    expect(price).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('parseCatalogHtml', () => {
  it('extracts PID→price pairs from catalog __NEXT_DATA__', () => {
    const data = {
      props: {
        pageProps: {
          srpProps: {
            hits: [
              { pdpUrl: '/en_gb/productpage.1247834001.html', regularPrice: '£19.99' },
              { pdpUrl: '/en_gb/productpage.0987654321.html', regularPrice: '£29.99' },
            ],
          },
        },
      },
    };
    const html = makeNextDataHtml(data);
    const result = parseCatalogHtml(html);
    expect(result['1247834001']).toBe(19.99);
    expect(result['0987654321']).toBe(29.99);
  });

  it('extracts PID from IL catalog URLs', () => {
    const data = {
      props: {
        pageProps: {
          srpProps: {
            hits: [{ pdpUrl: '/hw_il/productpage.1247834001.html', regularPrice: '89.90 ₪' }],
          },
        },
      },
    };
    const html = makeNextDataHtml(data);
    const result = parseCatalogHtml(html);
    expect(result['1247834001']).toBe(89.9);
  });

  it('returns empty object when no __NEXT_DATA__ found', () => {
    expect(parseCatalogHtml('<html><body></body></html>')).toEqual({});
  });

  it('returns empty object when no srpProps.hits', () => {
    const html = makeNextDataHtml({ props: { pageProps: {} } });
    expect(parseCatalogHtml(html)).toEqual({});
  });

  it('skips products without pdpUrl', () => {
    const data = {
      props: {
        pageProps: {
          srpProps: {
            hits: [
              { pdpUrl: '/en_gb/productpage.1247834001.html', regularPrice: '£19.99' },
              { regularPrice: '£29.99' },
            ],
          },
        },
      },
    };
    const html = makeNextDataHtml(data);
    const result = parseCatalogHtml(html);
    expect(Object.keys(result)).toHaveLength(1);
    expect(result['1247834001']).toBe(19.99);
  });

  it('skips products without regularPrice', () => {
    const data = {
      props: {
        pageProps: {
          srpProps: {
            hits: [{ pdpUrl: '/en_gb/productpage.1247834001.html' }],
          },
        },
      },
    };
    const html = makeNextDataHtml(data);
    expect(parseCatalogHtml(html)).toEqual({});
  });

  it('uses first occurrence when duplicate PIDs exist', () => {
    const data = {
      props: {
        pageProps: {
          srpProps: {
            hits: [
              { pdpUrl: '/en_gb/productpage.1247834001.html', regularPrice: '£19.99' },
              { pdpUrl: '/en_gb/productpage.1247834001.html', regularPrice: '£29.99' },
            ],
          },
        },
      },
    };
    const html = makeNextDataHtml(data);
    const result = parseCatalogHtml(html);
    expect(result['1247834001']).toBe(19.99);
  });
});
