console.log('[popup.js] script loaded');

const CACHE_KEY = 'exchangeRateData';
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours in ms
const FALLBACK_RATE = 4.6;

document.addEventListener('DOMContentLoaded', () => {
  console.log('[popup.js] DOMContentLoaded');
  main().catch(err => {
    console.error('[popup.js] Error:', err);
    document.getElementById('status').textContent = 'Error loading prices';
  });
});

async function fetchExchangeRate() {
  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=GBP&to=ILS');
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const data = await res.json();
    if (!data.rates || !data.rates.ILS) throw new Error('Invalid data from exchange API');
    console.log('[popup.js] Fetched exchange rate:', data.rates.ILS);

    // Save to cache with timestamp
    const cacheData = {
      rate: data.rates.ILS,
      timestamp: Date.now(),
      fallback: false,
    };
    await chrome.storage.local.set({ [CACHE_KEY]: cacheData });
    return cacheData;
  } catch (e) {
    console.error('[popup.js] Error fetching exchange rate:', e);

    // Try to use cached rate if available
    const cached = await chrome.storage.local.get(CACHE_KEY);
    if (cached && cached[CACHE_KEY]) {
      console.log('[popup.js] Using cached exchange rate');
      return cached[CACHE_KEY];
    }

    // No cached rate, return fallback
    return {
      rate: FALLBACK_RATE,
      timestamp: null,
      fallback: true,
    };
  }
}

function formatTimestamp(ts) {
  if (!ts) return 'never';
  const d = new Date(ts);
  return d.toLocaleString();
}

async function main() {
  const statusEl = document.getElementById('status');
  statusEl.textContent = 'Fetching prices...';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentUrl = new URL(tab.url);
  const isUK = currentUrl.hostname.endsWith('.co.uk');

  const siteEmoji = isUK ? '🇬🇧' : '🇮🇱';
  const altDomain = isUK ? 'www.next.co.il' : 'www.next.co.uk';
  const hasEnPath = currentUrl.pathname.startsWith('/en');
  const altPath = isUK
    ? '/en' + currentUrl.pathname  // UK -> IL site always gets /en prefix
    : currentUrl.pathname.startsWith('/en') ? currentUrl.pathname.slice(3) : currentUrl.pathname;  // IL -> UK removes /en if present
  const altUrl = `${currentUrl.protocol}//${altDomain}${altPath}${currentUrl.search}${currentUrl.hash}`;

  const priceSelector = '#pdp-item-title span, .pdp-css-4bh121 > div > span';

  const getPrice = async (tabId) => {
    return await chrome.scripting.executeScript({
      target: { tabId },
      func: (selector) => {
        const el = document.querySelector(selector);
        return el ? el.textContent.trim() : null;
      },
      args: [priceSelector]
    }).then(([res]) => res.result);
  };

  const currentPriceRaw = await getPrice(tab.id);

  const altTab = await chrome.tabs.create({ url: altUrl, active: false });
  const altTabId = altTab.id;

  await new Promise((resolve) => {
    chrome.tabs.onUpdated.addListener(function listener(updatedTabId, info) {
      if (updatedTabId === altTabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });

  // Wait to ensure price is rendered
  await new Promise((r) => setTimeout(r, 1000));

  let altPriceRaw;
  try {
    altPriceRaw = await getPrice(altTabId);
  } catch (e) {
    altPriceRaw = 'Error fetching price';
    console.error('[popup.js] Failed to get alt price:', e);
  }

  chrome.tabs.remove(altTabId);

  const parsePrice = s => parseFloat(s?.replace(/[^\d.]/g, '') || NaN);
  const priceCurrent = parsePrice(currentPriceRaw);
  const priceAlt = parsePrice(altPriceRaw);

  const exchangeData = await getCachedOrFetchRate();

  const exchangeRate = exchangeData.rate;
  const currentIsGBP = isUK;
  const usedFallback = exchangeData.fallback;
  const lastUpdated = exchangeData.timestamp;
  const lastFetchedStr = lastUpdated ? formatTimestamp(lastUpdated) : 'never';

  const formatPrice = (price, isGBP) =>
    isGBP ? `£${price}` : `₪${price}`;

  const approxInAlt = currentIsGBP
    ? `≈ ₪${(priceCurrent * exchangeRate).toFixed(2)}`
    : `≈ £${(priceCurrent / exchangeRate).toFixed(2)}`;

  const approxInCurrent = !currentIsGBP
    ? `≈ ₪${(priceAlt * exchangeRate).toFixed(2)}`
    : `≈ £${(priceAlt / exchangeRate).toFixed(2)}`;

  let verdict = '🔍 💸 Prices are about the same';

  if (!isNaN(priceCurrent) && !isNaN(priceAlt)) {
    // Convert both prices to GBP for comparison
    const currentPriceGBP = currentIsGBP ? priceCurrent : priceCurrent / exchangeRate;
    const altPriceGBP = currentIsGBP ? priceAlt / exchangeRate : priceAlt;
  
    const currentPriceILS = currentIsGBP ? priceCurrent * exchangeRate : priceCurrent;
    const altPriceILS = currentIsGBP ? priceAlt : priceAlt * exchangeRate;
  
    const diffGBP = currentPriceGBP - altPriceGBP;
    const diffILS = currentPriceILS - altPriceILS;
  
    // Use average of two prices in GBP for percentage base to be more balanced
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

    <a href="${altUrl}" target="_blank">Open alternate site</a>
  `;
}

async function getCachedOrFetchRate() {
  const data = await chrome.storage.local.get(CACHE_KEY);
  if (data && data[CACHE_KEY]) {
    const cached = data[CACHE_KEY];
    if ((Date.now() - cached.timestamp) < CACHE_DURATION_MS) {
      // Cache still valid
      return cached;
    }
  }
  // Fetch fresh rate and cache
  return fetchExchangeRate();
}
