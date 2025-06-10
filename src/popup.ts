/**
 * Handles all popup UI logic for price comparison, verdicts, and messaging.
 */

import { log, warn, error } from './logger';
import { getCachedOrFetchRate, formatTimestamp } from './exchangeRate';
import { parsePrice } from './priceUtils';
import { getAlternateUrl } from './urlUtils';
import { getSiteMeta } from './siteMeta';

document.addEventListener('DOMContentLoaded', () => {
  log('DOMContentLoaded');
  main().catch((err) => {
    error('Error in main():', err);
    const statusEl = document.getElementById('status');
    if (statusEl) statusEl.textContent = 'Error loading prices';
  });
});

let productsFetched = false;
let productPageHandled = false;

chrome.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
  if (msg.action === 'npcProducts') {
    const statusEl = document.getElementById('status');
    // Listing page logic
    if (msg.products && msg.products.length > 1) {
      if (productsFetched) return true; // Ignore duplicate messages
      productsFetched = true;
      log('Received npcProducts message:', msg.products);
      if (statusEl) {
        statusEl.innerHTML = `📦 Found ${msg.products.length} products on listing page.<br>Price comparison is shown directly on the page.`;
      }
      return true;
    }
    // Product page logic
    if (msg.products && msg.products.length === 1 && !productPageHandled) {
      productPageHandled = true;
      // Call the verdict/price logic directly here
      handleProductPageVerdict(msg.products[0], statusEl);
      return true;
    }
    // No products found
    if (statusEl && (!msg.products || msg.products.length === 0)) {
      statusEl.textContent = 'No products found.';
      warn('No products found in npcProducts message:', msg.products);
    }
    return true;
  }
});

async function main() {
  const statusEl = document.getElementById('status');
  if (!statusEl) {
    error('No #status element found');
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) {
    statusEl.textContent = 'No active tab detected';
    return;
  }

  const currentUrl = new URL(tab.url);

  if (isListingPage(currentUrl)) {
    await handleListingPage(tab, statusEl);
  } else {
    await handleProductPage(tab, currentUrl, statusEl);
  }
}

function isListingPage(url: URL): boolean {
  return url.pathname.includes('/shop');
}

async function handleListingPage(tab: chrome.tabs.Tab, statusEl: HTMLElement) {
  statusEl.innerHTML = '📄 Scanning listing page...';

  // Only inject the content script if it is not already present
  chrome.scripting
    .executeScript({
      target: { tabId: tab.id! },
      files: ['contentScript.js'],
    })
    .catch(() => {
      // Ignore errors if already injected
    })
    .finally(() => {
      // Always send the message after attempting injection
      chrome.tabs.sendMessage(tab.id!, { action: 'scanListingPage' });
    });
}

// Remove all tab-based logic and switch to fetch-based extraction for handleProductPage
async function handleProductPage(tab: chrome.tabs.Tab, currentUrl: URL, statusEl: HTMLElement) {
  const altUrl = getAlternateUrl(currentUrl);
  log('Alternate URL:', altUrl);

  // Always inject the content script before sending the message
  await chrome.scripting
    .executeScript({
      target: { tabId: tab.id! },
      files: ['contentScript.js'],
    })
    .catch(() => {
      // Ignore errors if already injected
    });

  // Now send the message to extract the current price
  chrome.tabs.sendMessage(tab.id!, { action: 'scanListingPage' });

  // Wait for npcProducts message
  function listener(
    msg: { action?: string; products?: Array<{ link: string; price: string }> },
    _sender: chrome.runtime.MessageSender,
    _sendResponse: () => void
  ): boolean | undefined {
    if (msg.action === 'npcProducts' && msg.products && msg.products.length === 1) {
      const currentPriceRaw = msg.products[0].price;
      (async () => {
        // Fetch alternate price via background script
        const priceSelector = (await import('./selectors')).priceSelector;
        // Use promise-based sendMessage for background fetch
        chrome.runtime
          .sendMessage({
            action: 'getAlternatePrice',
            url: altUrl,
            priceSelector,
          })
          .then(async (resp: { price?: string | number }) => {
            const priceCurrent = parsePrice(currentPriceRaw);
            const priceAlt =
              resp.price !== undefined && resp.price !== null
                ? parsePrice(resp.price.toString())
                : null;
            if (priceCurrent === null || priceAlt === null) {
              statusEl.textContent = 'Error: Unable to fetch or parse prices.';
              return;
            }
            const exchangeData = await getCachedOrFetchRate();
            const exchangeRate = exchangeData.rate;
            const usedFallback = exchangeData.fallback;
            const lastUpdated = exchangeData.timestamp;
            const siteMeta = getSiteMeta(currentUrl.hostname);
            const lastFetchedStr = formatTimestamp(lastUpdated);
            const formatPrice = (price: number, isGBP: boolean) =>
              isGBP ? `£${price.toFixed(2)}` : `₪${price.toFixed(2)}`;
            const approxInAlt = siteMeta.isUK
              ? `≈ ₪${(priceCurrent * exchangeRate).toFixed(2)}`
              : `≈ £${(priceCurrent / exchangeRate).toFixed(2)}`;
            const approxInCurrent = !siteMeta.isUK
              ? `≈ ₪${(priceAlt * exchangeRate).toFixed(2)}`
              : `≈ £${(priceAlt / exchangeRate).toFixed(2)}`;
            let verdict = '🔍 💸 Prices are about the same';
            const diff = siteMeta.isUK
              ? priceCurrent - priceAlt / exchangeRate
              : priceCurrent / exchangeRate - priceAlt;
            const percDiff = (Math.abs(diff) / ((priceCurrent + priceAlt) / 2)) * 100;
            if (Math.abs(diff) > 0.01) {
              verdict =
                diff > 0
                  ? `<strong style="color: red;">📉 Alternate site is cheaper by ${siteMeta.currentCurrency}${Math.abs(diff).toFixed(2)} (${percDiff.toFixed(1)}%)</strong>`
                  : `<strong style="color: green;">📈 Current site is cheaper by ${siteMeta.currentCurrency}${Math.abs(diff).toFixed(2)} (${percDiff.toFixed(1)}%)</strong>`;
            }
            statusEl.innerHTML = `
            💱 Exchange rate: 1 GBP = ${exchangeRate.toFixed(4)} ₪ ${usedFallback ? '(using fallback rate)' : ''}<br>
            📅 Last updated: ${lastFetchedStr}<br><br>
            ${siteMeta.currentFlag} Current site: ${formatPrice(priceCurrent, siteMeta.isUK)} (${approxInAlt})<br>
            ${siteMeta.altFlag} Alternate site: ${formatPrice(priceAlt, !siteMeta.isUK)} (${approxInCurrent})<br><br>
            ${verdict}<br><br>
            <a href="${altUrl}" target="_blank" rel="noopener noreferrer">Open alternate site</a>
          `;
          });
      })();
      chrome.runtime.onMessage.removeListener(listener);
      return true;
    }
    return false;
  }
  chrome.runtime.onMessage.addListener(listener);
}

async function handleProductPageVerdict(
  product: { link: string; price: string },
  statusEl: HTMLElement | null
) {
  if (!statusEl) return;
  const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  const currentUrl = new URL(tab.url!);
  const altUrl = getAlternateUrl(currentUrl);
  const priceSelector = (await import('./selectors')).priceSelector;
  chrome.runtime
    .sendMessage({
      action: 'getAlternatePrice',
      url: altUrl,
      priceSelector,
    })
    .then(async (resp: { price?: string | number }) => {
      const priceCurrent = parsePrice(product.price);
      const priceAlt =
        resp.price !== undefined && resp.price !== null ? parsePrice(resp.price.toString()) : null;
      if (priceCurrent === null || priceAlt === null) {
        statusEl.textContent = 'Error: Unable to fetch or parse prices.';
        return;
      }
      const exchangeData = await getCachedOrFetchRate();
      const exchangeRate = exchangeData.rate;
      const usedFallback = exchangeData.fallback;
      const lastUpdated = exchangeData.timestamp;
      const siteMeta = getSiteMeta(currentUrl.hostname);
      const lastFetchedStr = formatTimestamp(lastUpdated);
      const formatPrice = (price: number, isGBP: boolean) =>
        isGBP ? `£${price.toFixed(2)}` : `₪${price.toFixed(2)}`;
      const approxInAlt = siteMeta.isUK
        ? `≈ ₪${(priceCurrent * exchangeRate).toFixed(2)}`
        : `≈ £${(priceCurrent / exchangeRate).toFixed(2)}`;
      const approxInCurrent = !siteMeta.isUK
        ? `≈ ₪${(priceAlt * exchangeRate).toFixed(2)}`
        : `≈ £${(priceAlt / exchangeRate).toFixed(2)}`;
      let verdict = '🔍 💸 Prices are about the same';
      const diff = siteMeta.isUK
        ? priceCurrent - priceAlt / exchangeRate
        : priceCurrent / exchangeRate - priceAlt;
      const percDiff = (Math.abs(diff) / ((priceCurrent + priceAlt) / 2)) * 100;
      if (Math.abs(diff) > 0.01) {
        verdict =
          diff > 0
            ? `<strong style="color: red;">📉 Alternate site is cheaper by ${siteMeta.currentCurrency}${Math.abs(diff).toFixed(2)} (${percDiff.toFixed(1)}%)</strong>`
            : `<strong style="color: green;">📈 Current site is cheaper by ${siteMeta.currentCurrency}${Math.abs(diff).toFixed(2)} (${percDiff.toFixed(1)}%)</strong>`;
      }
      statusEl.innerHTML = `
      💱 Exchange rate: 1 GBP = ${exchangeRate.toFixed(4)} ₪ ${usedFallback ? '(using fallback rate)' : ''}<br>
      📅 Last updated: ${lastFetchedStr}<br><br>
      ${siteMeta.currentFlag} Current site: ${formatPrice(priceCurrent, siteMeta.isUK)} (${approxInAlt})<br>
      ${siteMeta.altFlag} Alternate site: ${formatPrice(priceAlt, !siteMeta.isUK)} (${approxInCurrent})<br><br>
      ${verdict}<br><br>
      <a href="${altUrl}" target="_blank" rel="noopener noreferrer">Open alternate site</a>
    `;
    });
}
