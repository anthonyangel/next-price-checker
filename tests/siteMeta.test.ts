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

  it('treats non-.co.uk hostname as IL', () => {
    const meta = getSiteMeta('shop.next.co.il');
    expect(meta.isUK).toBe(false);
  });

  it('handles hostname without www prefix', () => {
    const meta = getSiteMeta('next.co.uk');
    expect(meta.isUK).toBe(true);
  });
});
