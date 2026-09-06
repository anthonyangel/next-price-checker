import { vi, beforeEach } from 'vitest';
import { lookupPrice } from '../src/providers/mango';

vi.mock('../src/logger', () => ({
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.restoreAllMocks();
  mockFetch = vi.fn();
  vi.stubGlobal('fetch', mockFetch);
});

/** Helper to build a Mango price API response. */
function priceResponse(entries: Record<string, { price: number; type?: string }>) {
  return entries;
}

describe('lookupPrice', () => {
  it('returns the price for the first color when no color code specified', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(priceResponse({ '99': { price: 29.99, type: 'PVP' } })),
    });

    const price = await lookupPrice('87070630', 'uk');
    expect(price).toBe(29.99);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('countryIso=GB')
    );
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('productId=87070630')
    );
  });

  it('returns the price for IL region', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(priceResponse({ '99': { price: 579.9, type: 'PVP' } })),
    });

    const price = await lookupPrice('87070630', 'il');
    expect(price).toBe(579.9);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('countryIso=IL')
    );
  });

  it('returns the matching color price when color code is provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve(
          priceResponse({
            '99': { price: 29.99, type: 'SALE3' },
            '16': { price: 39.99, type: 'PVP' },
          })
        ),
    });

    const price = await lookupPrice('87070630', 'uk', '16');
    expect(price).toBe(39.99);
  });

  it('falls back to first color when requested color is not in response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(priceResponse({ '99': { price: 29.99, type: 'PVP' } })),
    });

    const price = await lookupPrice('87070630', 'uk', '77');
    expect(price).toBe(29.99);
  });

  it('returns null for unknown region', async () => {
    const price = await lookupPrice('87070630', 'us');
    expect(price).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns null when API returns HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const price = await lookupPrice('87070630', 'uk');
    expect(price).toBeNull();
  });

  it('returns null when API returns empty response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(priceResponse({})),
    });

    const price = await lookupPrice('87070630', 'uk');
    expect(price).toBeNull();
  });

  it('returns null on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const price = await lookupPrice('87070630', 'uk');
    expect(price).toBeNull();
  });

  it('uses channelId=shop in the request', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(priceResponse({ '99': { price: 10 } })),
    });

    await lookupPrice('87070630', 'uk');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('channelId=shop')
    );
  });
});
