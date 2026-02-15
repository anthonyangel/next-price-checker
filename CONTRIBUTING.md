# Contributing

Thanks for your interest in adding retailer support to Next Price Checker! This guide walks through the process.

## Development Setup

1. **Node.js 20+** and npm
2. Clone the repo and install dependencies:
   ```bash
   git clone https://github.com/<owner>/next-price-checker.git
   cd next-price-checker
   npm install
   ```
3. Build the extension:
   ```bash
   npm run build
   ```
4. Load it in Chrome: go to `chrome://extensions`, enable Developer mode, click "Load unpacked", select the `dist/` folder.

## Adding a New Retailer

### Before you start

- Check [open issues](../../issues) — someone may already be working on your retailer.
- Open an issue (or claim an existing one) with:
  - Retailer name
  - UK and IL URLs (e.g. `www.hm.com/en_gb/` and `www.hm.com/en_il/`)
  - Example product page URLs for both regions
  - Whether prices are in the initial HTML or JS-rendered

### Checklist

- [ ] **1. Scaffold files** (optional but recommended):
  ```bash
  npx tsx scripts/create-retailer.ts "RetailerName"
  ```
  This creates the retailer class and test file with TODOs.

- [ ] **2. Implement the retailer class** in `src/retailers/{id}/{Name}Retailer.ts`:
  - `sites` — hostnames and catalog URL patterns for each region
  - `priceSelector` — CSS selector that matches the price element on product pages
  - `productContainerSelector` — CSS selector for the catalog product grid
  - `transformUrl(url, fromRegion, toRegion)` — swap between region URLs

- [ ] **3. Register** in `src/core/registry.ts`:
  ```typescript
  import { YourRetailer } from '../retailers/yourretailer/YourRetailer';
  const retailers: AbstractRetailer[] = [new NextRetailer(), new YourRetailer()];
  ```

- [ ] **4. Add host permissions** in `manifest.json` under `optional_host_permissions`.

- [ ] **5. Add regions** (if needed) in `src/core/regions.ts`. Existing: `uk` (GBP), `il` (ILS).

- [ ] **6. Write tests** in `tests/{Name}Retailer.test.ts`:
  - `getRegionForHostname` — each hostname returns correct region, unknown returns null
  - `isCatalogPage` — catalog vs product URLs
  - `transformUrl` — UK→IL, IL→UK, round-trip, query/hash preserved
  - Run: `npx vitest run tests/{Name}Retailer.test.ts`

- [ ] **7. Verify everything passes**:
  ```bash
  npm run typecheck
  npm run lint
  npm test
  npm run build
  ```

- [ ] **8. Submit PR** linking the issue.

## Finding CSS Selectors

To find the right `priceSelector` for a retailer:

1. Open a product page in Chrome
2. Right-click the price → Inspect
3. Find a CSS selector that uniquely targets the price element
4. Test it in the console: `document.querySelector('your-selector')?.textContent`
5. Check both UK and IL versions of the page — the selector should work on both

For `productContainerSelector`, find the element whose direct children are individual product cards on listing/catalog pages.

## Code Style

- TypeScript strict mode
- ESLint with 0 warnings enforced
- Prettier for formatting
- Run `npm run format` before committing

## Testing

```bash
npm test                    # All unit tests
npx vitest run tests/X.ts   # Single test file
```
