import { scrapeProductPagePrice } from '../src/providers/nextPageScraper';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function htmlResponse(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
  } as Response;
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('scrapeProductPagePrice', () => {
  describe('JSON-LD extraction', () => {
    it('extracts price from Product JSON-LD with offers.price', async () => {
      const html = `
        <html><head>
        <script type="application/ld+json">
        {"@type":"Product","name":"Test","offers":{"@type":"Offer","price":24.99,"priceCurrency":"GBP"}}
        </script>
        </head><body>some content that is long enough to pass the size check ${'x'.repeat(1000)}</body></html>
      `;
      mockFetch.mockResolvedValue(htmlResponse(html));
      expect(await scrapeProductPagePrice('https://www.next.co.uk/style/abc/123')).toBe(24.99);
    });

    it('extracts lowPrice from AggregateOffer', async () => {
      const html = `
        <html><head>
        <script type="application/ld+json">
        {"@type":"Product","name":"Test","offers":{"@type":"AggregateOffer","lowPrice":19.00,"highPrice":29.00}}
        </script>
        </head><body>${'x'.repeat(1000)}</body></html>
      `;
      mockFetch.mockResolvedValue(htmlResponse(html));
      expect(await scrapeProductPagePrice('https://www.next.co.uk/style/abc/123')).toBe(19.0);
    });

    it('extracts price from offers array', async () => {
      const html = `
        <html><head>
        <script type="application/ld+json">
        {"@type":"Product","name":"Test","offers":[{"@type":"Offer","price":15.50}]}
        </script>
        </head><body>${'x'.repeat(1000)}</body></html>
      `;
      mockFetch.mockResolvedValue(htmlResponse(html));
      expect(await scrapeProductPagePrice('https://www.next.co.uk/style/abc/123')).toBe(15.5);
    });

    it('extracts from @graph array', async () => {
      const html = `
        <html><head>
        <script type="application/ld+json">
        {"@context":"https://schema.org","@graph":[{"@type":"Product","offers":{"price":42.00}}]}
        </script>
        </head><body>${'x'.repeat(1000)}</body></html>
      `;
      mockFetch.mockResolvedValue(htmlResponse(html));
      expect(await scrapeProductPagePrice('https://www.next.co.uk/style/abc/123')).toBe(42.0);
    });

    it('handles string price values', async () => {
      const html = `
        <html><head>
        <script type="application/ld+json">
        {"@type":"Product","offers":{"price":"33.99"}}
        </script>
        </head><body>${'x'.repeat(1000)}</body></html>
      `;
      mockFetch.mockResolvedValue(htmlResponse(html));
      expect(await scrapeProductPagePrice('https://www.next.co.uk/style/abc/123')).toBe(33.99);
    });
  });

  describe('__NEXT_DATA__ extraction', () => {
    it('extracts price from __NEXT_DATA__ pageProps', async () => {
      const nextData = {
        props: {
          pageProps: {
            product: {
              salePrice: 28.0,
            },
          },
        },
      };
      const html = `
        <html><head>
        <script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script>
        </head><body>${'x'.repeat(1000)}</body></html>
      `;
      mockFetch.mockResolvedValue(htmlResponse(html));
      expect(await scrapeProductPagePrice('https://www.next.co.uk/style/abc/123')).toBe(28.0);
    });

    it('extracts nested price from __NEXT_DATA__', async () => {
      const nextData = {
        props: {
          pageProps: {
            item: {
              details: {
                price: 55.0,
              },
            },
          },
        },
      };
      const html = `
        <html><head>
        <script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script>
        </head><body>${'x'.repeat(1000)}</body></html>
      `;
      mockFetch.mockResolvedValue(htmlResponse(html));
      expect(await scrapeProductPagePrice('https://www.next.co.uk/style/abc/123')).toBe(55.0);
    });
  });

  describe('meta tag extraction', () => {
    it('extracts from product:price:amount meta tag', async () => {
      const html = `
        <html><head>
        <meta property="product:price:amount" content="18.50">
        </head><body>${'x'.repeat(1000)}</body></html>
      `;
      mockFetch.mockResolvedValue(htmlResponse(html));
      expect(await scrapeProductPagePrice('https://www.next.co.uk/style/abc/123')).toBe(18.5);
    });

    it('extracts from og:price:amount meta tag', async () => {
      const html = `
        <html><head>
        <meta property="og:price:amount" content="22.00">
        </head><body>${'x'.repeat(1000)}</body></html>
      `;
      mockFetch.mockResolvedValue(htmlResponse(html));
      expect(await scrapeProductPagePrice('https://www.next.co.uk/style/abc/123')).toBe(22.0);
    });

    it('handles reversed attribute order', async () => {
      const html = `
        <html><head>
        <meta content="30.00" property="product:price:amount">
        </head><body>${'x'.repeat(1000)}</body></html>
      `;
      mockFetch.mockResolvedValue(htmlResponse(html));
      expect(await scrapeProductPagePrice('https://www.next.co.uk/style/abc/123')).toBe(30.0);
    });
  });

  describe('priority order', () => {
    it('prefers JSON-LD over __NEXT_DATA__', async () => {
      const nextData = { props: { pageProps: { price: 99.0 } } };
      const html = `
        <html><head>
        <script type="application/ld+json">{"@type":"Product","offers":{"price":10.00}}</script>
        <script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script>
        </head><body>${'x'.repeat(1000)}</body></html>
      `;
      mockFetch.mockResolvedValue(htmlResponse(html));
      expect(await scrapeProductPagePrice('https://www.next.co.uk/style/abc/123')).toBe(10.0);
    });
  });

  describe('error handling', () => {
    it('returns null on HTTP error', async () => {
      mockFetch.mockResolvedValue(htmlResponse('Not Found', 404));
      expect(await scrapeProductPagePrice('https://www.next.co.uk/style/abc/123')).toBeNull();
    });

    it('returns null on fetch failure', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));
      expect(await scrapeProductPagePrice('https://www.next.co.uk/style/abc/123')).toBeNull();
    });

    it('returns null for tiny response (bot protection)', async () => {
      mockFetch.mockResolvedValue(htmlResponse('<html>blocked</html>'));
      expect(await scrapeProductPagePrice('https://www.next.co.uk/style/abc/123')).toBeNull();
    });

    it('returns null when no price found in HTML', async () => {
      const html = `<html><head></head><body>${'x'.repeat(1000)}</body></html>`;
      mockFetch.mockResolvedValue(htmlResponse(html));
      expect(await scrapeProductPagePrice('https://www.next.co.uk/style/abc/123')).toBeNull();
    });

    it('handles malformed JSON-LD gracefully', async () => {
      const html = `
        <html><head>
        <script type="application/ld+json">{invalid json}</script>
        </head><body>${'x'.repeat(1000)}</body></html>
      `;
      mockFetch.mockResolvedValue(htmlResponse(html));
      expect(await scrapeProductPagePrice('https://www.next.co.uk/style/abc/123')).toBeNull();
    });

    it('ignores zero/negative prices', async () => {
      const html = `
        <html><head>
        <script type="application/ld+json">{"@type":"Product","offers":{"price":0}}</script>
        </head><body>${'x'.repeat(1000)}</body></html>
      `;
      mockFetch.mockResolvedValue(htmlResponse(html));
      expect(await scrapeProductPagePrice('https://www.next.co.uk/style/abc/123')).toBeNull();
    });
  });
});
