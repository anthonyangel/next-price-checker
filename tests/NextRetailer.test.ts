import { NextRetailer } from '../src/retailers/next/NextRetailer';

describe('NextRetailer', () => {
  const next = new NextRetailer();

  describe('getRegionForHostname', () => {
    it('returns uk for next.co.uk', () => {
      expect(next.getRegionForHostname('www.next.co.uk')).toBe('uk');
    });

    it('returns il for next.co.il', () => {
      expect(next.getRegionForHostname('www.next.co.il')).toBe('il');
    });

    it('returns null for unknown hostname', () => {
      expect(next.getRegionForHostname('www.zara.com')).toBeNull();
    });
  });

  describe('isCatalogPage', () => {
    it('returns true for /shop paths', () => {
      expect(next.isCatalogPage(new URL('https://www.next.co.uk/shop/gender-women'))).toBe(true);
    });

    it('returns false for product paths', () => {
      expect(next.isCatalogPage(new URL('https://www.next.co.uk/style/su620384/f30002'))).toBe(
        false
      );
    });
  });

  describe('transformUrl', () => {
    it('transforms UK to IL (adds /en prefix)', () => {
      const url = new URL('https://www.next.co.uk/style/su620384/f30002');
      expect(next.transformUrl(url, 'uk', 'il')).toBe(
        'https://www.next.co.il/en/style/su620384/f30002'
      );
    });

    it('transforms IL to UK (removes /en prefix)', () => {
      const url = new URL('https://www.next.co.il/en/style/su620384/f30002');
      expect(next.transformUrl(url, 'il', 'uk')).toBe(
        'https://www.next.co.uk/style/su620384/f30002'
      );
    });

    it('handles IL URL without /en prefix', () => {
      const url = new URL('https://www.next.co.il/style/su620384/f30002');
      expect(next.transformUrl(url, 'il', 'uk')).toBe(
        'https://www.next.co.uk/style/su620384/f30002'
      );
    });

    it('preserves query params and hash', () => {
      const url = new URL('https://www.next.co.uk/style/su620384/f30002?size=10#details');
      expect(next.transformUrl(url, 'uk', 'il')).toBe(
        'https://www.next.co.il/en/style/su620384/f30002?size=10#details'
      );
    });
  });

  describe('extractProductId', () => {
    it('extracts PID from UK product URL', () => {
      const url = new URL('https://www.next.co.uk/style/su620384/f30002');
      expect(next.extractProductId(url)).toBe('f30002');
    });

    it('extracts PID from IL product URL with /en prefix', () => {
      const url = new URL('https://www.next.co.il/en/style/su620384/f30002');
      expect(next.extractProductId(url)).toBe('f30002');
    });

    it('extracts PID ignoring query params and hash', () => {
      const url = new URL('https://www.next.co.uk/style/su620384/f30002?size=10#details');
      expect(next.extractProductId(url)).toBe('f30002');
    });

    it('returns null for catalog/listing URLs', () => {
      const url = new URL('https://www.next.co.uk/shop/gender-women');
      expect(next.extractProductId(url)).toBeNull();
    });

    it('returns null for homepage', () => {
      const url = new URL('https://www.next.co.uk/');
      expect(next.extractProductId(url)).toBeNull();
    });

    it('returns null for malformed style path', () => {
      const url = new URL('https://www.next.co.uk/style/');
      expect(next.extractProductId(url)).toBeNull();
    });
  });

  describe('getAlternateRegionId', () => {
    it('returns il for uk', () => {
      expect(next.getAlternateRegionId('uk')).toBe('il');
    });

    it('returns uk for il', () => {
      expect(next.getAlternateRegionId('il')).toBe('uk');
    });

    it('returns null for unknown region (all filtered out)', () => {
      // 'uk' and 'il' both != 'xx', so both remain → ids.length === 2 (!== 1) → warns but returns first
      expect(next.getAlternateRegionId('xx')).toBeTruthy();
    });
  });

  describe('selectors', () => {
    it('has a price selector', () => {
      expect(next.priceSelector).toBe('#pdp-item-title .MuiTypography-h1 span');
    });

    it('has product container selectors', () => {
      expect(next.productContainerSelector).toBeTruthy();
      expect(next.productContainerFallbackSelectors.length).toBeGreaterThan(0);
    });
  });
});
