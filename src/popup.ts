console.log('[popup.ts] script loaded');

const CACHE_KEY = 'exchangeRateData';
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours in ms
const FALLBACK_RATE = 4.6;

document.addEventListener('DOMContentLoaded', () => {
  console.log('[popup.ts] DOMContentLoaded');
  main().catch(err => {
    console.error('[popup.ts] Error in main():', err);
    const statusEl = document.getElementById('status');
    if (statusEl) statusEl.textContent = 'Error loading prices';
  });
});

async function fetchExchangeRate(): Promise<{ rate: number; timestamp: number | null; fallback: boolean }> {
  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=GBP&to=ILS');
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const data = await res.json();
    if (!data.rates || !data.rates.ILS) throw new Error('Invalid data from exchange API');
    console.log('[popup.ts] Fetched exchange rate:', data.rates.ILS);

    const cacheData = {
      rate: data.rates.ILS,
      timestamp: Date.now(),
      fallback: false,
    };
    await chrome.storage.local.set({ [CACHE_KEY]: cacheData });
    return cacheData;
  } catch (e) {
    console.error('[popup.ts] Error fetching exchange rate:', e);

    // Try cached rate
    const cached = await chrome.storage.local.get(CACHE_KEY);
    if (cached && cached[CACHE_KEY]) {
      console.log('[popup.ts] Using cached exchange rate');
      return cached[CACHE_KEY];
    }

    return {
      rate: FALLBACK_RATE,
      timestamp: null,
      fallback: true,
    };
  }
}

function formatTimestamp(ts: number | null): string {
  if (!ts) return 'never';
  const d = new Date(ts);
  return d.toLocaleString();
}

async function getCachedOrFetchRate() {
  const data = await chrome.storage.local.get(CACHE_KEY);
  if (data && data[CACHE_KEY]) {
    const cached = data[CACHE_KEY];
    if ((Date.now() - cached.timestamp) < CACHE_DURATION_MS) {
      console.log('[popup.ts] Using fresh cached exchange rate');
      return cached;
    }
  }
  return fetchExchangeRate();
}

async function waitForTabLoad(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    const listener = (updatedTabId: number, info: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function getPriceFromTab(tabId: number, selector: string): Promise<string | null> {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        const el = document.querySelector(sel);
        return el ? el.textContent.trim() : null;
      },
      args: [selector]
    });
    return result.result;
  } catch (e) {
    console.error('[popup.ts] Error executing script in tab:', e);
    return null;
  }
}

function parsePrice(priceStr: string | null): number {
  if (!priceStr) return NaN;
  return parseFloat(priceStr.replace(/[^\d.]/g, ''));
}

async function main() {
  const statusEl = document.getElementById('status');
  if (!statusEl) {
    console.error('[popup.ts] No #status element found');
    return;
  }

  statusEl.textContent = 'Fetching prices...';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) {
    statusEl.textContent = 'No active tab detected';
    return;
  }

  const currentUrl = new URL(tab.url);
  const isUK = currentUrl.hostname.endsWith('.co.uk');

  const siteEmoji = isUK ? '🇬🇧' : '🇮🇱';
  const altDomain = isUK ? 'www.next.co.il' : 'www.next.co.uk';

  // Adjust path for alt site: UK to IL always add /en, IL to UK remove /en if present
  const hasEnPath = currentUrl.pathname.startsWith('/en');
  const altPath = isUK
    ? '/en' + currentUrl.pathname // UK to IL: always /en prefix
    : (hasEnPath ? currentUrl.pathname.slice(3) : currentUrl.pathname); // IL to UK: remove /en

  const altUrl = `${currentUrl.protocol}//${altDomain}${altPath}${currentUrl.search}${currentUrl.hash}`;

  const priceSelector = '#pdp-item-title span, .pdp-css-4bh121 > div > span';

  // Get price from current tab
  const currentPriceRaw = await getPriceFromTab(tab.id!, priceSelector);
  console.log('[popup.ts] Current price raw:', currentPriceRaw);

  // Open alternate site in background tab and wait for load
  const altTab = await chrome.tabs.create({ url: altUrl, active: false });
  await waitForTabLoad(altTab.id!);

  // Wait extra second for page scripts to render price
  await new Promise(r => setTimeout(r, 1000));

  const altPriceRaw = await getPriceFromTab(altTab.id!, priceSelector);
  console.log('[popup.ts] Alternate price raw:', altPriceRaw);

  await chrome.tabs.remove(altTab.id!);

  const priceCurrent = parsePrice(currentPriceRaw);
  const priceAlt = parsePrice(altPriceRaw);

  const exchangeData = await getCachedOrFetchRate();

  const exchangeRate = exchangeData.rate;
  const usedFallback = exchangeData.fallback;
  const lastUpdated = exchangeData.timestamp;

  const currentIsGBP = isUK;
  const lastFetchedStr = formatTimestamp(lastUpdated);

  const formatPrice = (price: number, isGBP: boolean) =>
    isGBP ? `£${price.toFixed(2)}` : `₪${price.toFixed(2)}`;

  const approxInAlt = currentIsGBP
    ? `≈ ₪${(priceCurrent * exchangeRate).toFixed(2)}`
    : `≈ £${(priceCurrent / exchangeRate).toFixed(2)}`;

  const approxInCurrent = !currentIsGBP
    ? `≈ ₪${(priceAlt * exchangeRate).toFixed(2)}`
    : `≈ £${(priceAlt / exchangeRate).toFixed(2)}`;

  let verdict = '🔍 💸 Prices are about the same';

  if (!isNaN(priceCurrent) && !isNaN(priceAlt)) {
    const currentPriceGBP = currentIsGBP ? priceCurrent : priceCurrent / exchangeRate;
    const altPriceGBP = currentIsGBP ? priceAlt / exchangeRate : priceAlt;

    const currentPriceILS = currentIsGBP ? priceCurrent * exchangeRate : priceCurrent;
    const altPriceILS = currentIsGBP ? priceAlt : priceAlt * exchangeRate;

    const diffGBP = currentPriceGBP - altPriceGBP;
    const diffILS = currentPriceILS - altPriceILS;

    const percDiff = (Math.abs(diffGBP) / ((currentPriceGBP + altPriceGBP) / 2)) * 100;

    if (Math.abs(diffGBP) > 0.01) {
      if (diffGBP > 0) {
        verdict = `<strong style="color: red;">📉 Alternate site is cheaper by £${Math.abs(diffGBP).toFixed(2)} / ₪${Math.abs(diffILS).toFixed(2)} (${percDiff.toFixed(1)}%)</strong>`;
      } else {
        verdict = `<strong style="color: green;">📈 Current site is cheaper by £${Math.abs(diffGBP).toFixed(2)} / ₪${Math.abs(diffILS).toFixed(2)} (${percDiff.toFixed(1)}%)</strong>`;
      }
    }
  }

  statusEl.innerHTML = `
    💱 Exchange rate: 1 GBP = ${exchangeRate.toFixed(4)} ₪ ${usedFallback ? '(using fallback rate)' : ''}<br>
    📅 Last updated: ${lastFetchedStr}<br><br>

    ${siteEmoji} Current site: ${formatPrice(priceCurrent, currentIsGBP)} (${approxInAlt})<br>
    ${isUK ? '🇮🇱' : '🇬🇧'} Alternate site: ${formatPrice(priceAlt, !currentIsGBP)} (${approxInCurrent})<br><br>
    
    ${verdict}<br><br>

    <a href="${altUrl}" target="_blank" rel="noopener noreferrer">Open alternate site</a>
  `;
}
