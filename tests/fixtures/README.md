# Retailer Test Fixtures

This directory contains HTML fixture files used to test retailer-specific price extraction logic.

## Directory Structure

```
tests/fixtures/
  {retailer-id}/
    product-page-uk.html      # UK product page snapshot
    product-page-il.html      # IL product page snapshot
    listing-page-uk.html      # UK listing/catalog page snapshot (if supported)
    listing-page-il.html      # IL listing/catalog page snapshot (optional)
```

## Fixture Format

Each fixture is a minimal HTML snippet containing just enough DOM structure for the retailer's CSS selectors to resolve. Include a comment at the top with:

- The expected extracted price value
- The CSS selector used for extraction

Example:

```html
<!-- Next UK product page fixture -->
<!-- Expected price: £45.00 -->
<!-- Selector: #pdp-item-title > div > ... > span -->
<div id="pdp-item-title">
  ...
    <span>£45.00</span>
  ...
</div>
```

## Required Test Coverage Per Retailer

Once the `AbstractRetailer` base class is implemented, each retailer must have tests covering:

1. **Product page price extraction** — both UK and IL fixtures
2. **Catalog/listing page extraction** — at least one region (if `supportsCatalogPage: true`)
3. **URL transform UK → IL**
4. **URL transform IL → UK**
5. **URL round-trip** — UK → IL → UK returns the original URL

## Example Test Structure

```ts
// @vitest-environment jsdom
import { readFileSync } from 'fs';
import { resolve } from 'path';

function loadFixture(name: string): string {
  return readFileSync(resolve(__dirname, '../fixtures/next', name), 'utf-8');
}

describe('NextRetailer', () => {
  it('extracts price from UK product page', () => {
    document.body.innerHTML = loadFixture('product-page-uk.html');
    // const price = retailer.extractProductPagePrice(document);
    // expect(price).toBe(45.00);
  });

  it('transforms UK URL to IL', () => {
    // const alt = retailer.transformUrl(ukUrl, 'uk', 'il');
    // expect(alt.hostname).toBe('www.next.co.il');
  });
});
```

## How to Create Fixtures

1. Navigate to a product page on the retailer's site
2. Right-click the price element → Inspect
3. Copy the minimal DOM subtree that includes the price and its selector context
4. Save as an HTML file in the appropriate `tests/fixtures/{retailer-id}/` directory
5. Add a comment at the top noting the expected price and selector
