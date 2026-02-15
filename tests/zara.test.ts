import { vi, beforeEach, afterEach } from 'vitest';
import { lookupPrice, parsePriceFromHtml, parseCatalogHtml } from '../src/providers/zara';

vi.mock('../src/logger', () => ({
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const sites = {
  uk: {
    hostnames: ['www.zara.com'],
    pathPrefix: '/uk',
    catalogPathPattern: /^\/uk\/en\/.*-l\d+\.html/,
  },
  il: {
    hostnames: ['www.zara.com'],
    pathPrefix: '/il',
    catalogPathPattern: /^\/il\/en\/.*-l\d+\.html/,
  },
};

describe('parsePriceFromHtml', () => {
  it('parses price from valid HTML', () => {
    const html = '<span class="money-amount__main">29.99</span>';
    expect(parsePriceFromHtml(html, '12345678')).toBe(29.99);
  });

  it('parses price with currency symbol', () => {
    const html = '<span class="money-amount__main">£29.99</span>';
    expect(parsePriceFromHtml(html, '12345678')).toBe(29.99);
  });

  it('parses price with whitespace', () => {
    const html = '<span class="money-amount__main">\n  45.00\n</span>';
    expect(parsePriceFromHtml(html, '12345678')).toBe(45.0);
  });

  it('returns null when no price element found', () => {
    const html = '<div>No price here</div>';
    expect(parsePriceFromHtml(html, '12345678')).toBeNull();
  });

  it('returns null for non-numeric price text', () => {
    const html = '<span class="money-amount__main">TBD</span>';
    expect(parsePriceFromHtml(html, '12345678')).toBeNull();
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

  it('returns price from valid HTML response', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      text: async () => '<span class="money-amount__main">29.99</span>',
    } as Response);

    const price = await lookupPrice('02731310', 'uk', sites);
    expect(price).toBe(29.99);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://www.zara.com/uk/en/-p02731310.html',
      { credentials: 'include' }
    );
  });

  it('constructs correct URL for IL region', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      text: async () => '<span class="money-amount__main">149.90</span>',
    } as Response);

    const price = await lookupPrice('02731310', 'il', sites);
    expect(price).toBe(149.9);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://www.zara.com/il/en/-p02731310.html',
      { credentials: 'include' }
    );
  });

  it('uses productUrl when provided instead of constructing one', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      text: async () => '<span class="money-amount__main">29.99</span>',
    } as Response);

    const fullUrl = 'https://www.zara.com/uk/en/satin-dress-p02731310.html?v1=123';
    const price = await lookupPrice('02731310', 'uk', sites, fullUrl);
    expect(price).toBe(29.99);
    expect(globalThis.fetch).toHaveBeenCalledWith(fullUrl, { credentials: 'include' });
  });

  it('returns null when response is Akamai bot challenge', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      text: async () =>
        '<html><script>function triggerInterstitialChallenge(){}</script><meta http-equiv="refresh" content="5; URL=\'/?bm-verify=abc\'" /></html>',
    } as Response);

    const price = await lookupPrice('02731310', 'uk', sites);
    expect(price).toBeNull();
  });

  it('returns null on 404', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: false,
      status: 404,
    } as Response);

    const price = await lookupPrice('99999999', 'uk', sites);
    expect(price).toBeNull();
  });

  it('returns null when price element not found in HTML', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      text: async () => '<html><body>No price here</body></html>',
    } as Response);

    const price = await lookupPrice('02731310', 'uk', sites);
    expect(price).toBeNull();
  });

  it('returns null on network error', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error('Network error'));

    const price = await lookupPrice('02731310', 'uk', sites);
    expect(price).toBeNull();
  });

  it('returns null for unknown region', async () => {
    const price = await lookupPrice('02731310', 'us', sites);
    expect(price).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('retries without cookies on 410 (region cookie mismatch)', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce({ ok: false, status: 410 } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => '<span class="money-amount__main">149.90</span>',
      } as Response);

    const price = await lookupPrice('02731310', 'il', sites);
    expect(price).toBe(149.9);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch).toHaveBeenNthCalledWith(1, expect.any(String), {
      credentials: 'include',
    });
    expect(globalThis.fetch).toHaveBeenNthCalledWith(2, expect.any(String), {
      credentials: 'omit',
    });
  });

  it('returns null when 410 retry also fails', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce({ ok: false, status: 410 } as Response)
      .mockResolvedValueOnce({ ok: false, status: 403 } as Response);

    const price = await lookupPrice('02731310', 'il', sites);
    expect(price).toBeNull();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('parseCatalogHtml', () => {
  it('extracts URL ref from data-productkey and keys by both ref and internal ID', () => {
    const html = `
      <li data-productid="507930764" data-productkey="507930764-03067331059-p">
        <span class="money-amount__main">29.99</span>
      </li>
      <li data-productid="522701238" data-productkey="522701238-05029119068-p">
        <span class="money-amount__main">49.95</span>
      </li>
    `;
    const result = parseCatalogHtml(html);
    // Keyed by URL ref (8-digit, cross-region) AND internal ID (9-digit)
    expect(result['03067331']).toBe(29.99);
    expect(result['507930764']).toBe(29.99);
    expect(result['05029119']).toBe(49.95);
    expect(result['522701238']).toBe(49.95);
  });

  it('falls back to data-productid when no data-productkey present', () => {
    const html = `
      <li data-productid="507084855">
        <span class="money-amount__main">29.99</span>
      </li>
      <li data-productid="522701238">
        <span class="money-amount__main">49.95</span>
      </li>
    `;
    const result = parseCatalogHtml(html);
    expect(result).toEqual({ '507084855': 29.99, '522701238': 49.95 });
  });

  it('extracts URL ref from product link href as fallback', () => {
    const html = `
      <li data-productid="507930764">
        <a href="/uk/en/dress-p03067331.html?v1=507930764">
          <span class="money-amount__main">29.99</span>
        </a>
      </li>
    `;
    const result = parseCatalogHtml(html);
    expect(result['03067331']).toBe(29.99);
    expect(result['507930764']).toBe(29.99);
  });

  it('returns empty object when no data-productid found', () => {
    const html = '<div><span class="money-amount__main">29.99</span></div>';
    expect(parseCatalogHtml(html)).toEqual({});
  });

  it('skips products without prices', () => {
    const html = `
      <li data-productid="507084855" data-productkey="507084855-03067331059-p">
        <span class="money-amount__main">29.99</span>
      </li>
      <li data-productid="999999999" data-productkey="999999999-12345678000-p">
        <span>No price element</span>
      </li>
    `;
    const result = parseCatalogHtml(html);
    expect(result['03067331']).toBe(29.99);
    expect(result['507084855']).toBe(29.99);
    expect(result['12345678']).toBeUndefined();
  });

  it('uses first occurrence when duplicate PIDs exist', () => {
    const html = `
      <li data-productid="507084855">
        <span class="money-amount__main">29.99</span>
      </li>
      <li data-productid="507084855">
        <span class="money-amount__main">39.99</span>
      </li>
    `;
    const result = parseCatalogHtml(html);
    expect(result['507084855']).toBe(29.99);
  });
});

