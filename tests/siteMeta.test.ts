import { getSiteMeta } from '../src/siteMeta';

describe('getSiteMeta', () => {
  it('returns UK metadata for www.next.co.uk', () => {
    const meta = getSiteMeta(new URL('https://www.next.co.uk/'));
    expect(meta.isUK).toBe(true);
    expect(meta.currentFlag).toBe('\u{1F1EC}\u{1F1E7}');
    expect(meta.altFlag).toBe('\u{1F1EE}\u{1F1F1}');
    expect(meta.currentCurrency).toBe('\u00A3');
    expect(meta.altCurrency).toBe('\u20AA');
    // Different hostnames — use hostname as site name
    expect(meta.currentSiteName).toBe('next.co.uk');
    expect(meta.altSiteName).toBe('next.co.il');
  });

  it('returns IL metadata for www.next.co.il', () => {
    const meta = getSiteMeta(new URL('https://www.next.co.il/en/'));
    expect(meta.isUK).toBe(false);
    expect(meta.currentFlag).toBe('\u{1F1EE}\u{1F1F1}');
    expect(meta.altFlag).toBe('\u{1F1EC}\u{1F1E7}');
    expect(meta.currentCurrency).toBe('\u20AA');
    expect(meta.altCurrency).toBe('\u00A3');
    expect(meta.currentSiteName).toBe('next.co.il');
    expect(meta.altSiteName).toBe('next.co.uk');
  });

  it('uses retailer + region name for shared-hostname retailers (Zara)', () => {
    const meta = getSiteMeta(new URL('https://www.zara.com/uk/en/dress-p12345678.html'));
    expect(meta.currentSiteName).toBe('Zara United Kingdom');
    expect(meta.altSiteName).toBe('Zara Israel');
  });

  it('throws for unrecognized hostname', () => {
    expect(() => getSiteMeta(new URL('https://shop.next.co.il/'))).toThrow('No retailer found');
  });

  it('throws for hostname without www prefix', () => {
    expect(() => getSiteMeta(new URL('https://next.co.uk/'))).toThrow('No retailer found');
  });
});
