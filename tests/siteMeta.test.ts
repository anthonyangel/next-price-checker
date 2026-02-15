import { getSiteMeta } from '../src/siteMeta';

describe('getSiteMeta', () => {
  it('returns UK metadata for www.next.co.uk', () => {
    const meta = getSiteMeta('www.next.co.uk');
    expect(meta.isUK).toBe(true);
    expect(meta.currentFlag).toBe('🇬🇧');
    expect(meta.altFlag).toBe('🇮🇱');
    expect(meta.currentCurrency).toBe('£');
    expect(meta.altCurrency).toBe('₪');
  });

  it('returns IL metadata for www.next.co.il', () => {
    const meta = getSiteMeta('www.next.co.il');
    expect(meta.isUK).toBe(false);
    expect(meta.currentFlag).toBe('🇮🇱');
    expect(meta.altFlag).toBe('🇬🇧');
    expect(meta.currentCurrency).toBe('₪');
    expect(meta.altCurrency).toBe('£');
  });

  it('throws for unrecognized hostname', () => {
    expect(() => getSiteMeta('shop.next.co.il')).toThrow('No retailer found');
  });

  it('throws for hostname without www prefix', () => {
    expect(() => getSiteMeta('next.co.uk')).toThrow('No retailer found');
  });
});
