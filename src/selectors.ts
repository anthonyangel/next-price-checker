/**
 * Returns the main price selector for product pages.
 * @type {string}
 */
export const priceSelector = '#pdp-item-title .MuiTypography-h1 span';

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
