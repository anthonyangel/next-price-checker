import { vi, beforeEach } from 'vitest';
import { lookupPrice, type BloomreachRegionConfig } from '../src/providers/bloomreach';

vi.mock('../src/logger', () => ({
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const config: BloomreachRegionConfig = {
  accountId: '1234',
  authKey: 'testkey123',
  domainKey: 'testdomain',
  siteUrl: 'https://www.example.com',
};

/** Helper to build a Bloomreach API JSON response. */
function apiResponse(docs: Array<{ pid: string; price?: number; sale_price?: number }>) {
  return { response: { docs } };
}

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.restoreAllMocks();
  mockFetch = vi.fn();
  vi.stubGlobal('fetch', mockFetch);
});

describe('lookupPrice', () => {
  it('returns sale_price when available', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(apiResponse([{ pid: 'F12345', sale_price: 19.99, price: 29.99 }])),
    });

    const price = await lookupPrice('F12345', config);
    expect(price).toBe(19.99);
  });

  it('returns price when sale_price is absent', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(apiResponse([{ pid: 'F12345', price: 29.99 }])),
    });

    const price = await lookupPrice('F12345', config);
    expect(price).toBe(29.99);
  });

  it('matches PID case-insensitively', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(apiResponse([{ pid: 'f12345', price: 29.99 }])),
    });

    const price = await lookupPrice('F12345', config);
    expect(price).toBe(29.99);
  });

  it('returns null when PID does not match (product not found)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(apiResponse([{ pid: 'WRONG', price: 10 }])),
    });

    const price = await lookupPrice('F12345', config);
    expect(price).toBeNull();
    // Should NOT attempt credential scrape — apiOk was true
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns null when API returns empty docs', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(apiResponse([])),
    });

    const price = await lookupPrice('F12345', config);
    expect(price).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns null when price is a non-number type', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(apiResponse([{ pid: 'F12345', price: 'N/A' as unknown as number }])),
    });

    const price = await lookupPrice('F12345', config);
    expect(price).toBeNull();
  });

  it('attempts credential scrape on API error (non-ok response)', async () => {
    // First call: API returns 401
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
    // Second call: homepage scrape
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(`
        <script>
          account_id: '9999',
          auth_key: 'freshkey',
          domain_key: 'freshdomain',
        </script>
      `),
    });
    // Third call: retry API with fresh credentials
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(apiResponse([{ pid: 'F12345', price: 42 }])),
    });

    const price = await lookupPrice('F12345', config);
    expect(price).toBe(42);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('attempts credential scrape on fetch exception', async () => {
    // First call: network error
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    // Homepage scrape
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(
        'account_id="5555" auth_key="newkey" domain_key="newdomain"'
      ),
    });
    // Retry with fresh credentials
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(apiResponse([{ pid: 'F12345', price: 33 }])),
    });

    const price = await lookupPrice('F12345', config);
    expect(price).toBe(33);
  });

  it('returns null when scrape fails to find credentials', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    // Homepage scrape returns page without Bloomreach config
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve('<html><body>No config here</body></html>'),
    });

    const price = await lookupPrice('F12345', config);
    expect(price).toBeNull();
    // Only 2 calls: API + homepage scrape (no retry since scrape failed)
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('returns null when homepage fetch fails', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    // Homepage returns non-ok
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

    const price = await lookupPrice('F12345', config);
    expect(price).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('returns null when retry also fails', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
    // Successful scrape
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(
        'account_id="9999" auth_key="freshkey" domain_key="freshdomain"'
      ),
    });
    // Retry also fails
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

    const price = await lookupPrice('F12345', config);
    expect(price).toBeNull();
  });

  it('sends correct query parameters to API', async () => {
    // Use a unique siteUrl to avoid collision with refreshedConfigs from prior tests
    const freshConfig: BloomreachRegionConfig = {
      ...config,
      siteUrl: 'https://www.params-test.com',
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(apiResponse([{ pid: 'F12345', price: 10 }])),
    });

    await lookupPrice('F12345', freshConfig);

    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe('https://core.dxpapi.com/api/v1/core/');
    expect(url.searchParams.get('account_id')).toBe('1234');
    expect(url.searchParams.get('auth_key')).toBe('testkey123');
    expect(url.searchParams.get('domain_key')).toBe('testdomain');
    expect(url.searchParams.get('q')).toBe('F12345');
    expect(url.searchParams.get('fl')).toBe('pid,price,sale_price');
  });

  it('scrapes homepage with credentials omit', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(
        'account_id="9999" auth_key="freshkey" domain_key="freshdomain"'
      ),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(apiResponse([{ pid: 'F12345', price: 10 }])),
    });

    await lookupPrice('F12345', config);

    // Second call is the homepage scrape
    expect(mockFetch.mock.calls[1][0]).toBe('https://www.example.com');
    expect(mockFetch.mock.calls[1][1]).toEqual({ credentials: 'omit' });
  });
});
