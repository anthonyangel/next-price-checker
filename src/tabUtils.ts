/**
 * Waits for the tab to fully load (status === 'complete').
 */
export function waitForTabLoad(tabId: number): Promise<void> {
    return new Promise((resolve) => {
      function listener(updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      }
      chrome.tabs.onUpdated.addListener(listener);
    });
  }
  
  /**
   * Opens a new tab in background (active: false) and returns the tab object.
   */
  export async function openBackgroundTab(url: string): Promise<chrome.tabs.Tab> {
    const tab = await chrome.tabs.create({ url, active: false });
    return tab;
  }
  
  /**
   * Closes tab by ID.
   */
  export async function closeTab(tabId: number): Promise<void> {
    await chrome.tabs.remove(tabId);
  }
  
  /**
   * Attempts multiple selectors in the page context to find a price text.
   * Returns first non-null trimmed text or null if none found.
   */
  export async function getPriceFromTab(
    tabId: number,
    selectors: string[]
  ): Promise<string | null> {
    // Run script inside tab that tries each selector until a match is found
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (selectors: string[]) => {
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && el.textContent) return el.textContent.trim();
        }
        return null;
      },
      args: [selectors],
    });
  
    if (!results || results.length === 0) return null;
    return results[0].result ?? null;
  }
  