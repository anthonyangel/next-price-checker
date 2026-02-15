import { parsePrice, getPriceComparisonVerdict } from '../src/priceUtils';

describe('parsePrice', () => {
  it('parses a GBP price', () => {
    expect(parsePrice('£12.99')).toBe(12.99);
  });

  it('parses an ILS price', () => {
    expect(parsePrice('₪45.00')).toBe(45.0);
  });

  it('parses a price with thousands separator', () => {
    // Known issue: comma is stripped, but "1,234.56" becomes "1234.56" which is correct
    expect(parsePrice('£1,234.56')).toBe(1234.56);
  });

  it('parses a plain numeric string', () => {
    expect(parsePrice('42.5')).toBe(42.5);
  });

  it('returns null for null input', () => {
    expect(parsePrice(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parsePrice('')).toBeNull();
  });

  it('returns null for non-numeric string', () => {
    expect(parsePrice('abc')).toBeNull();
  });

  it('returns null for N/A (regression: catalog fallback price)', () => {
    // When the price selector doesn't match on catalog pages, product.price
    // is 'N/A'. parsePrice must return null so the comparison logic shows
    // the alternate price without a misleading "Same price" verdict.
    expect(parsePrice('N/A')).toBeNull();
  });

  it('parses zero', () => {
    expect(parsePrice('0')).toBe(0);
  });

  it('parses price range by taking the first price', () => {
    expect(parsePrice('₪45.00 - ₪60.00')).toBe(45.0);
  });

  it('parses price range with en-dash', () => {
    expect(parsePrice('£12.99 – £19.99')).toBe(12.99);
  });
});

describe('getPriceComparisonVerdict', () => {
  const rate = 4.6; // GBP to ILS

  it('says alt is cheaper when current price is higher', async () => {
    // UK price £50, IL price ₪100. Converted: ₪100 / 4.6 ≈ £21.74. Alt IS cheaper.
    // diff = 50 - 21.74 = 28.26 > 0
    const result = await getPriceComparisonVerdict({
      currentPrice: '£50.00',
      altPrice: '₪100.00',
      isUK: true,
      rate,
      url: new URL('https://www.next.co.uk/'),
    });
    expect(result.diff).toBeGreaterThan(0);
    expect(result.verdict).toContain('Save');
    expect(result.highlight).toBe('color: #e67e00;');
  });

  it('says cheaper here when alt is more expensive', async () => {
    // UK price £10, IL price ₪200. Converted: ₪200 / 4.6 ≈ £43.48. Alt is more expensive.
    // diff = 10 - 43.48 = -33.48 < 0
    const result = await getPriceComparisonVerdict({
      currentPrice: '£10.00',
      altPrice: '₪200.00',
      isUK: true,
      rate,
      url: new URL('https://www.next.co.uk/'),
    });
    expect(result.diff).toBeLessThan(0);
    expect(result.verdict).toContain('Cheaper here');
    expect(result.highlight).toBe('color: #2e7d32;');
  });

  it('returns "same price" when prices are nearly equal', async () => {
    // UK price £21.74, IL price ₪100 → converted ≈ £21.74
    const result = await getPriceComparisonVerdict({
      currentPrice: '£21.74',
      altPrice: '₪100.00',
      isUK: true,
      rate,
      url: new URL('https://www.next.co.uk/'),
    });
    expect(Math.abs(result.diff)).toBeLessThanOrEqual(0.01);
    expect(result.verdict).toBe('Same price on both sites');
    expect(result.highlight).toBe('color: #888;');
  });

  it('returns empty verdict when alt price is invalid', async () => {
    const result = await getPriceComparisonVerdict({
      currentPrice: '£50.00',
      altPrice: 'N/A',
      isUK: true,
      rate,
      url: new URL('https://www.next.co.uk/'),
    });
    expect(result.verdict).toBe('');
    expect(result.diff).toBe(0);
  });

  it('converts correctly from IL perspective', async () => {
    // IL price ₪100, UK price £50. Converted: £50 * 4.6 = ₪230.
    // diff = 100 - 230 = -130 < 0
    const result = await getPriceComparisonVerdict({
      currentPrice: '₪100.00',
      altPrice: '£50.00',
      isUK: false,
      rate,
      url: new URL('https://www.next.co.il/en/'),
    });
    expect(result.altPriceConverted).toBeCloseTo(230);
    expect(result.diff).toBeLessThan(0);
  });

  it('computes percentage difference', async () => {
    const result = await getPriceComparisonVerdict({
      currentPrice: '£50.00',
      altPrice: '₪100.00',
      isUK: true,
      rate,
      url: new URL('https://www.next.co.uk/'),
    });
    expect(result.percDiff).toBeGreaterThan(0);
  });
});
