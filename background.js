// Utility to fetch a URL and extract price from HTML string
async function fetchPrice(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    // Parse HTML text
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'text/html');
    // Try to get price element - adjust selector if needed
    const priceEl = doc.querySelector('[data-testid="price"], .now-price, .product-price');
    if (!priceEl) return 'Price not found';
    return priceEl.textContent.trim();
  }
  
  // Given a URL from one site, return UK and IL URLs
  function getBothUrls(url) {
    let ukUrl, ilUrl;
    if (url.includes('next.co.uk')) {
      ukUrl = url;
      ilUrl = url.replace('next.co.uk', 'next.co.il').replace('/style/', '/en/style/');
    } else if (url.includes('next.co.il')) {
      ilUrl = url;
      ukUrl = url.replace('next.co.il', 'next.co.uk').replace('/en/style/', '/style/');
    } else {
      throw new Error('Not a Next product page');
    }
    return { ukUrl, ilUrl };
  }
  
  // Listen for messages from popup.js to fetch prices
  chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
    if (msg.action === 'comparePrices') {
      try {
        const { ukUrl, ilUrl } = getBothUrls(msg.url);
        const [ukPrice, ilPrice] = await Promise.all([fetchPrice(ukUrl), fetchPrice(ilUrl)]);
        sendResponse({ ukPrice, ilPrice, ukUrl, ilUrl });
      } catch (e) {
        sendResponse({ error: e.message });
      }
      return true; // keep message channel open for async
    }
  });
  