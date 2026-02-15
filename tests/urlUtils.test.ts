import { getAlternateUrl } from '../src/urlUtils';

describe('getAlternateUrl', () => {
  describe('UK to IL', () => {
    it('swaps domain and adds /en prefix', () => {
      const url = new URL('https://www.next.co.uk/style/abc123');
      expect(getAlternateUrl(url)).toBe('https://www.next.co.il/en/style/abc123');
    });

    it('preserves query params', () => {
      const url = new URL('https://www.next.co.uk/style/abc123?size=10&color=blue');
      expect(getAlternateUrl(url)).toBe(
        'https://www.next.co.il/en/style/abc123?size=10&color=blue'
      );
    });

    it('preserves hash fragment', () => {
      const url = new URL('https://www.next.co.uk/style/abc123#details');
      expect(getAlternateUrl(url)).toBe('https://www.next.co.il/en/style/abc123#details');
    });
  });

  describe('IL to UK', () => {
    it('swaps domain and removes /en prefix', () => {
      const url = new URL('https://www.next.co.il/en/style/abc123');
      expect(getAlternateUrl(url)).toBe('https://www.next.co.uk/style/abc123');
    });

    it('keeps path as-is when no /en prefix', () => {
      const url = new URL('https://www.next.co.il/style/abc123');
      expect(getAlternateUrl(url)).toBe('https://www.next.co.uk/style/abc123');
    });

    it('preserves query params', () => {
      const url = new URL('https://www.next.co.il/en/style/abc123?size=10');
      expect(getAlternateUrl(url)).toBe('https://www.next.co.uk/style/abc123?size=10');
    });
  });

  describe('round-trip', () => {
    it('UK → IL → UK returns original URL', () => {
      const original = 'https://www.next.co.uk/style/abc123';
      const il = getAlternateUrl(new URL(original));
      const backToUk = getAlternateUrl(new URL(il));
      expect(backToUk).toBe(original);
    });

    it('IL → UK → IL returns original URL', () => {
      const original = 'https://www.next.co.il/en/style/abc123';
      const uk = getAlternateUrl(new URL(original));
      const backToIl = getAlternateUrl(new URL(uk));
      expect(backToIl).toBe(original);
    });
  });
});
