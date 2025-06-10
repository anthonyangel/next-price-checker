/**
 * Given a Next UK/IL product URL, returns the equivalent product URL on the alternate site.
 * - UK to IL: always adds /en prefix to the path.
 * - IL to UK: removes /en prefix if present.
 *
 * @param currentUrl The current product URL (as a URL object)
 * @returns The alternate site product URL as a string
 */
export function getAlternateUrl(currentUrl: URL): string {
  const isUK = currentUrl.hostname.endsWith('.co.uk');
  const altDomain = isUK ? 'www.next.co.il' : 'www.next.co.uk';

  // Adjust path for alternate site
  const hasEnPath = currentUrl.pathname.startsWith('/en');
  const altPath = isUK
    ? '/en' + currentUrl.pathname // UK to IL: always add /en prefix
    : hasEnPath
      ? currentUrl.pathname.slice(3)
      : currentUrl.pathname; // IL to UK: remove /en if present

  const altUrl = `${currentUrl.protocol}//${altDomain}${altPath}${currentUrl.search}${currentUrl.hash}`;
  // Remove debug logs for production cleanliness
  // console.log(`[urlUtils.ts] Current URL: ${currentUrl.href}`);
  // console.log(`[urlUtils.ts] Alternate URL: ${altUrl}`);
  return altUrl;
}
