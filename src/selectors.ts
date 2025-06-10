/**
 * Returns the main price selector for product pages.
 * @type {string}
 */
export const priceSelector =
  '#pdp-item-title > div > div.MuiBox-root.pdp-css-d4vbq4 > div.pdp-css-4bh121 > div > span';

/**
 * Main selector for product container on listing pages.
 * @type {string}
 */
export const productContainerSelector =
  '#plp > div.MuiGrid-root.MuiGrid-container.plp-13gwbx > div.MuiGrid-root.MuiGrid-container.plp-product-grid-wrapper.plp-wq7tal > div';

/**
 * Fallback selectors for product container on listing pages.
 * @type {string[]}
 */
export const productContainerFallbackSelectors = [
  '[data-testid="product-list"]',
  '.plp-product-grid-wrapper > div',
];
