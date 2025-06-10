/**
 * Returns site/currency/flag metadata for a Next UK or IL domain.
 *
 * @param hostname The hostname (e.g. www.next.co.uk or www.next.co.il)
 * @returns An object with isUK, currentFlag, altFlag, currentCurrency, altCurrency
 */
export function getSiteMeta(hostname: string) {
  const isUK = hostname.endsWith('.co.uk');
  return {
    isUK,
    currentFlag: isUK ? '🇬🇧' : '🇮🇱',
    altFlag: isUK ? '🇮🇱' : '🇬🇧',
    currentCurrency: isUK ? '£' : '₪',
    altCurrency: isUK ? '₪' : '£',
  };
}
