/**
 * Handles all popup UI logic for price comparison, verdicts, and messaging.
 */

import type { CatalogSummary } from './types';
import { log, warn, error } from './logger';
import { getCachedOrFetchRate, formatTimestamp } from './exchangeRate';
import { parsePrice, getPriceComparisonVerdict } from './priceUtils';
import { getAlternateUrl } from './urlUtils';
import { getSiteMeta } from './siteMeta';
import { getRetailerAndRegion } from './core/registry';
import { getCachedPrice, setCachedPrice } from './storageUtils';

/** Escape HTML special characters to prevent XSS in innerHTML assignments. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
      if (productsFetched) return true;
      productsFetched = true;
      log('Received npcProducts message:', msg.products);
      if (statusEl) {
        statusEl.innerHTML = `📄 Scanning ${msg.products.length} products...`;
      }
      return true;
    }
    // Product page logic
    if (msg.products && msg.products.length === 1 && !productPageHandled) {
      productPageHandled = true;
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

  if (msg.action === 'npcCatalogSummary' && msg.summary) {
    const statusEl = document.getElementById('status');
    if (statusEl) renderCatalogSummary(statusEl, msg.summary);
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
    await handleProductPage(tab, statusEl);
  }
}

function isListingPage(url: URL): boolean {
  const match = getRetailerAndRegion(url.hostname);
  if (match) return match.retailer.isCatalogPage(url);
  return false;
}

async function handleListingPage(tab: chrome.tabs.Tab, statusEl: HTMLElement) {
  if (tab.id == null) {
    statusEl.textContent = 'Cannot access this tab.';
    return;
  }
  const tabId = tab.id;
  statusEl.innerHTML = '📄 Scanning listing page...';

  chrome.scripting
    .executeScript({
      target: { tabId },
      files: ['contentScript.js'],
    })
    .catch(() => {})
    .finally(() => {
      chrome.tabs.sendMessage(tabId, { action: 'scanListingPage' });
    });
}

async function handleProductPage(tab: chrome.tabs.Tab, statusEl: HTMLElement) {
  if (tab.id == null) {
    statusEl.textContent = 'Cannot access this tab.';
    return;
  }
  const tabId = tab.id;

  await chrome.scripting
    .executeScript({
      target: { tabId },
      files: ['contentScript.js'],
    })
    .catch(() => {});

  chrome.tabs.sendMessage(tabId, { action: 'scanListingPage' });

  // The npcProducts message will be handled by the global listener above,
  // which calls handleProductPageVerdict for single-product pages.
}

async function handleProductPageVerdict(
  product: { link: string; price: string },
  statusEl: HTMLElement | null
) {
  if (!statusEl) return;
  const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab?.url) return;
  const currentUrl = new URL(tab.url);
  const altUrl = getAlternateUrl(currentUrl);

  const match = getRetailerAndRegion(currentUrl.hostname);
  const pid = match?.retailer.extractProductId(currentUrl) ?? null;
  const currentRegionId = match?.regionId ?? null;
  const altRegionId =
    match && currentRegionId ? match.retailer.getAlternateRegionId(currentRegionId) : null;

  // Cache the current page price
  if (pid && currentRegionId) {
    const currentPrice = parsePrice(product.price);
    if (currentPrice !== null) {
      setCachedPrice(pid, currentRegionId, currentPrice);
    }
  }

  // Check cache for alternate price
  if (pid && altRegionId) {
    const cached = await getCachedPrice(pid, altRegionId);
    if (cached) {
      log(`Using cached price for ${pid}:${altRegionId}`);
      renderPriceComparison(
        statusEl,
        product.price,
        { price: cached.price },
        currentUrl.hostname,
        altUrl
      );
      return;
    }
  }

  const resp = await chrome.runtime.sendMessage({
    action: 'getAlternatePrice',
    url: altUrl,
  });

  // Cache the alternate price
  if (resp?.price != null && pid && altRegionId) {
    const altPrice = typeof resp.price === 'number' ? resp.price : parseFloat(String(resp.price));
    if (!isNaN(altPrice)) {
      setCachedPrice(pid, altRegionId, altPrice);
    }
  }

  renderPriceComparison(statusEl, product.price, resp, currentUrl.hostname, altUrl);
}

function renderCatalogSummary(statusEl: HTMLElement, summary: CatalogSummary) {
  const { total, compared, cheaperHere, cheaperOnAlt, same, topSavingsAlt, topSavingsHere } =
    summary;

  let html = `📦 <strong>${total} products</strong> scanned, ${compared} compared<br>`;

  if (compared > 0) {
    const parts: string[] = [];
    if (cheaperHere > 0)
      parts.push(`<span style="color:#2e7d32">${cheaperHere} cheaper here</span>`);
    if (cheaperOnAlt > 0)
      parts.push(`<span style="color:#e67e00">${cheaperOnAlt} cheaper on alt site</span>`);
    if (same > 0) parts.push(`${same} same price`);
    html += parts.join(' · ') + '<br>';
  }

  if (topSavingsHere.length > 0) {
    html += '<br><strong style="color:#2e7d32">Best deals on this site:</strong><br>';
    for (const deal of topSavingsHere) {
      html +=
        `<a href="${escapeHtml(deal.url)}" target="_blank" rel="noopener noreferrer" style="text-decoration:none">` +
        `${escapeHtml(deal.pid.toUpperCase())}</a>` +
        ` — saving ${escapeHtml(deal.saving)} (${deal.percDiff.toFixed(1)}%)<br>`;
    }
  }

  if (topSavingsAlt.length > 0) {
    html += '<br><strong style="color:#e67e00">Cheaper on alternate site:</strong><br>';
    for (const deal of topSavingsAlt) {
      html +=
        `<a href="${escapeHtml(deal.url)}" target="_blank" rel="noopener noreferrer" style="text-decoration:none">` +
        `${escapeHtml(deal.pid.toUpperCase())}</a>` +
        ` — save ${escapeHtml(deal.saving)} (${deal.percDiff.toFixed(1)}%)<br>`;
    }
  }

  if (cheaperHere > 0 && cheaperOnAlt === 0) {
    html +=
      '<br><span style="color:#2e7d32"><strong>All products are cheapest on this site.</strong></span>';
  }

  // Filter checkbox — only useful when some items are more expensive here
  if (cheaperOnAlt > 0) {
    html +=
      '<br><label style="cursor:pointer;user-select:none">' +
      '<input type="checkbox" id="npc-filter-cheaper"> ' +
      'Only show products cheaper on this site' +
      '</label>';
  }

  statusEl.innerHTML = html;

  // Attach checkbox handler
  const checkbox = document.getElementById('npc-filter-cheaper') as HTMLInputElement | null;
  if (checkbox) {
    checkbox.addEventListener('change', async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'npcFilterCatalog',
          hide: checkbox.checked,
        });
      }
    });
  }
}

/**
 * Shared rendering logic for price comparison in the popup.
 * Used by both the product page handler and the message listener path.
 */
async function renderPriceComparison(
  statusEl: HTMLElement,
  currentPriceRaw: string,
  resp: { price?: string | number; error?: string; status?: number },
  hostname: string,
  altUrl: string
) {
  if (resp.error) {
    const safeUrl = escapeHtml(altUrl);
    const altLink = `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">Open alternate site</a>`;
    if (resp.status === 403) {
      statusEl.innerHTML = `Alternate site blocked the request (403 Forbidden).<br>Try opening the alternate site manually:<br>${altLink}`;
    } else if (resp.status === 404) {
      statusEl.innerHTML = `Product not found on alternate site (404).<br>${altLink}`;
    } else {
      statusEl.innerHTML = `Could not fetch alternate price: ${escapeHtml(String(resp.error))}<br>${altLink}`;
    }
    return;
  }

  const priceCurrent = parsePrice(currentPriceRaw);
  const priceAlt =
    resp.price !== undefined && resp.price !== null ? parsePrice(resp.price.toString()) : null;

  if (priceCurrent === null && priceAlt === null) {
    statusEl.textContent = 'Unable to parse prices on either site.';
    return;
  }
  if (priceCurrent === null) {
    statusEl.textContent = 'Could not read the price on this page.';
    return;
  }
  if (priceAlt === null) {
    const altLink = `<a href="${escapeHtml(altUrl)}" target="_blank" rel="noopener noreferrer">Check manually</a>`;
    statusEl.innerHTML = `Price not found on alternate site. ${altLink}`;
    return;
  }

  const exchangeData = await getCachedOrFetchRate();
  const exchangeRate = exchangeData.rate;
  const usedFallback = exchangeData.fallback;
  const lastUpdated = exchangeData.timestamp;
  const siteMeta = getSiteMeta(hostname);
  const lastFetchedStr = formatTimestamp(lastUpdated);

  const result = await getPriceComparisonVerdict({
    currentPrice: currentPriceRaw,
    altPrice: resp.price!.toString(),
    isUK: siteMeta.isUK,
    rate: exchangeRate,
    hostname,
  });

  const approxInAlt = `≈ ${siteMeta.altCurrency}${(siteMeta.isUK ? priceCurrent * exchangeRate : priceCurrent / exchangeRate).toFixed(2)}`;
  const approxInCurrent = `≈ ${siteMeta.currentCurrency}${(siteMeta.isUK ? priceAlt / exchangeRate : priceAlt * exchangeRate).toFixed(2)}`;

  const verdict = result.verdict
    ? `<strong style="${result.highlight}">${result.verdict}</strong>`
    : '🔍 💸 Prices are about the same';

  const safeAltUrl = escapeHtml(altUrl);
  statusEl.innerHTML = `
    💱 Exchange rate: 1 GBP = ${exchangeRate.toFixed(4)} ILS ${usedFallback ? '(using fallback rate)' : ''}<br>
    📅 Last updated: ${escapeHtml(lastFetchedStr)}<br><br>
    ${siteMeta.currentFlag} Current site: ${siteMeta.currentCurrency}${priceCurrent.toFixed(2)} (${approxInAlt})<br>
    ${siteMeta.altFlag} Alternate site: ${siteMeta.altCurrency}${priceAlt.toFixed(2)} (${approxInCurrent})<br><br>
    ${verdict}<br><br>
    <a href="${safeAltUrl}" target="_blank" rel="noopener noreferrer">Open alternate site</a>
  `;
}
