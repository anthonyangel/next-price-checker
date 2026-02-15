import { regions, getRegion } from '../src/core/regions';

describe('regions', () => {
  it('defines UK region with GBP', () => {
    expect(regions.uk.currency).toBe('GBP');
    expect(regions.uk.currencySymbol).toBe('£');
    expect(regions.uk.flag).toBe('🇬🇧');
  });

  it('defines IL region with ILS', () => {
    expect(regions.il.currency).toBe('ILS');
    expect(regions.il.currencySymbol).toBe('₪');
    expect(regions.il.flag).toBe('🇮🇱');
  });

  it('getRegion returns the correct region', () => {
    expect(getRegion('uk').currency).toBe('GBP');
    expect(getRegion('il').currency).toBe('ILS');
  });

  it('getRegion throws for unknown region', () => {
    expect(() => getRegion('xx')).toThrow('Unknown region: xx');
  });
});
