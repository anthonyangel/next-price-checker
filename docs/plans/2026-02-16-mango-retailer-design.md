# Mango Retailer Design

## Overview

Add Mango as a new retailer supporting UK (`shop.mango.com/gb`) and Israel (`shop.mango.com/il`) price comparison. Follows the Zara pattern (shared hostname + path prefix) with an API-based provider (like Bloomreach for Next).

## Site Structure

- **Hostname**: `shop.mango.com` (shared, like Zara)
- **UK path prefix**: `/gb`
- **IL path prefix**: `/il`
- **Product URL**: `/{prefix}/en/p/{category}/{slug}_{productId}` (8-digit ID after `_`)
- **Catalog URL**: `/{prefix}/en/c/{category}/{slug}_{categoryId}`
- **Product IDs**: Consistent across regions (confirmed: same 8-digit ID on both UK and IL)

## Provider: API-based

Mango has a public REST API requiring no auth keys:

```
GET https://online-orchestrator.mango.com/v3/prices/products
  ?channelId=shop
  &countryIso={GB|IL}
  &productId={8-digit-id}
```

Response (JSON, keyed by 2-digit color code):
```json
{
  "99": {
    "price": 29.99,
    "previousPrices": { "originalShop": 79.99 },
    "discountRate": 63,
    "type": "SALE3"
  }
}
```

- Region mapping: `uk` -> `GB`, `il` -> `IL`
- Color code: extract from `?c=XX` URL param when available, otherwise take first key
- Use `price` field (current selling price)

## Price Selectors

- **Product page**: `meta[itemprop="price"]` (content attribute) -- stable Schema.org microdata
- **Catalog page**: same `meta[itemprop="price"]` within product card forms
- **Fallback**: `span[class*="SinglePrice_container"]` (CSS Module hashes make this fragile)
- **Product container**: `form[class*="ProductCard_productCard"]`

## Files

### Create
1. `src/retailers/mango/MangoRetailer.ts` -- retailer class
2. `src/providers/mango.ts` -- API price provider
3. `tests/MangoRetailer.test.ts` -- retailer unit tests
4. `tests/mango.test.ts` -- provider unit tests

### Modify
5. `src/core/registry.ts` -- register MangoRetailer
6. `manifest.json` -- add host permissions for `shop.mango.com` and `online-orchestrator.mango.com`

## Implementation Steps

1. Create `src/providers/mango.ts` with `lookupPrice(pid, regionId, colorCode?)` function
2. Create `src/retailers/mango/MangoRetailer.ts` extending AbstractRetailer
3. Register in `src/core/registry.ts`
4. Update `manifest.json` host permissions
5. Write `tests/mango.test.ts` (provider tests with mocked fetch)
6. Write `tests/MangoRetailer.test.ts` (retailer tests)
7. Run full verification: typecheck, lint, test, build
