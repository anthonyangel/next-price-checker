import { log, warn, error } from './logger';
import { parsePrice } from './priceUtils';
import { getCachedOrFetchRate } from './exchangeRate';
import type { AlternatePriceMessage } from './types';

console.log('[background.ts] loaded');

/**
 * Handles messages for alternate price fetching and extraction in the background script.
 */
chrome.runtime.onMessage.addListener((msg: AlternatePriceMessage, sender, sendResponse) => {
  if (msg.action === 'getAlternatePrice') {
    (async () => {
      try {
        const { url } = msg;
        const res = await fetch(url, { credentials: 'omit' });
        if (!res.ok) {
          if (res.status === 404) {
            warn(`[background.ts] Alternate site not found (404): ${msg.url}`);
            (sendResponse as (response?: unknown) => void)({ error: '404', status: 404 });
            return;
          } else {
            (sendResponse as (response?: unknown) => void)({
              error: `HTTP error! status: ${res.status}`,
              status: res.status,
            });
            return;
          }
        }
        const html = await res.text();
        log(`[background.ts] Fetched HTML for: ${url} (length: ${html ? html.length : 0})`);
        const match = html.match(/([£₪]\s?\d+[,.]?\d*)/);
        const altPriceRaw = match ? match[1] : null;
        log(`[background.ts] Extracted altPriceRaw for ${url}:`, altPriceRaw);
        const price = parsePrice(altPriceRaw);
        log(`[background.ts] Parsed price for ${url}:`, price);
        const { rate } = await getCachedOrFetchRate();
        const responseObj = {
          price,
          converted: price !== null && !isNaN(price) ? price / rate : null,
        };
        // @ts-ignore
        (sendResponse as (response?: unknown) => void)(responseObj);
        return;
      } catch (err) {
        error('[background.ts] Error in getAlternatePrice:', err);
        (sendResponse as (response?: unknown) => void)({
          error: err?.toString?.() || 'Unknown error',
        });
      }
    })();
    return true;
  }
  return true; // Keep message channel open
});

console.log('[background.ts] Background script loaded');
