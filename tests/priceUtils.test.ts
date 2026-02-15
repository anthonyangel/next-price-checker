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

  it('parses zero', () => {
    expect(parsePrice('0')).toBe(0);
  });

  // Documents known bug: price ranges produce incorrect results (issue #17)
  it('incorrectly parses price range as single number (known bug #17)', () => {
    // "₪45.00 - ₪60.00" → strips non-numeric → "45.0060.00" → parseFloat → 45.006
    const result = parsePrice('₪45.00 - ₪60.00');
    expect(result).toBe(45.006);
  });
});

describe('getPriceComparisonVerdict', () => {
  const rate = 4.6; // GBP to ILS

  // Documents known bug: verdict text is inverted (issue #15)
  // When diff > 0, currentPrice > altConverted, meaning alt IS cheaper.
  // But the code says "${altFlag} more expensive" — which is backwards.
  it('returns inverted verdict when alt is cheaper (known bug #15)', async () => {
    // UK price £50, IL price ₪100. Converted: ₪100 / 4.6 ≈ £21.74. UK is more expensive.
    // diff = 50 - 21.74 = 28.26 > 0, so alt IS cheaper.
    // Bug: code says "🇮🇱 more expensive" with green highlight (should say cheaper with green)
    const result = await getPriceComparisonVerdict({
      currentPrice: '£50.00',
      altPrice: '₪100.00',
      isUK: true,
      rate,
    });
    expect(result.diff).toBeGreaterThan(0);
    expect(result.verdict).toContain('more expensive'); // Bug: should say "cheaper"
    expect(result.highlight).toBe('color: green;');
  });

  it('returns inverted verdict when alt is more expensive (known bug #15)', async () => {
    // UK price £10, IL price ₪200. Converted: ₪200 / 4.6 ≈ £43.48. Alt is more expensive.
    // diff = 10 - 43.48 = -33.48 < 0
    // Bug: code says "🇮🇱 cheaper" with red highlight (should say more expensive with red)
    const result = await getPriceComparisonVerdict({
      currentPrice: '£10.00',
      altPrice: '₪200.00',
      isUK: true,
      rate,
    });
    expect(result.diff).toBeLessThan(0);
    expect(result.verdict).toContain('cheaper'); // Bug: should say "more expensive"
    expect(result.highlight).toBe('color: red;');
  });

  it('returns "about the same" when prices are nearly equal', async () => {
    // UK price £21.74, IL price ₪100 → converted ≈ £21.74
    const result = await getPriceComparisonVerdict({
      currentPrice: '£21.74',
      altPrice: '₪100.00',
      isUK: true,
      rate,
    });
    expect(Math.abs(result.diff)).toBeLessThanOrEqual(0.01);
    expect(result.verdict).toBe('Prices are about the same');
    expect(result.highlight).toBe('');
  });

  it('returns empty verdict when alt price is invalid', async () => {
    const result = await getPriceComparisonVerdict({
      currentPrice: '£50.00',
      altPrice: 'N/A',
      isUK: true,
      rate,
    });
    expect(result.verdict).toBe('');
    expect(result.altPriceDisplay).toContain('Could not fetch');
  });

  it('converts correctly from IL perspective', async () => {
    // IL price ₪100, UK price £50. Converted: £50 * 4.6 = ₪230.
    // diff = 100 - 230 = -130 < 0
    const result = await getPriceComparisonVerdict({
      currentPrice: '₪100.00',
      altPrice: '£50.00',
      isUK: false,
      rate,
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
    });
    expect(result.percDiff).toBeGreaterThan(0);
  });
});
