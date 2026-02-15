# Contributing

Thanks for your interest in adding retailer support to Price Checker! This guide walks through the process, with examples from the existing Next and Zara implementations.

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
  - Whether there's a public product API (like Bloomreach) or if HTML scraping is needed

### Key decision: same hostname or different hostnames?

This affects how region detection works:

| Pattern | Example | Region detection |
|---|---|---|
| **Different hostnames** | Next: `www.next.co.uk` / `www.next.co.il` | Hostname alone is sufficient |
| **Same hostname, different paths** | Zara: `www.zara.com/uk/` / `www.zara.com/il/` | Requires `pathPrefix` in site config |

When multiple regions share a hostname, you **must** set `pathPrefix` on each site so the registry can disambiguate. When hostnames are unique per region, `pathPrefix` is optional (used only for URL transformation, not matching).

### Checklist

- [ ] **1. Scaffold files** (optional but recommended):
  ```bash
  npx tsx scripts/create-retailer.ts "RetailerName"
  ```
  This creates the retailer class and test file with TODOs.

- [ ] **2. Implement the retailer class** in `src/retailers/{id}/{Name}Retailer.ts`:

  ```typescript
  import { AbstractRetailer, type RetailerSite } from '../../core/AbstractRetailer';

  export class ExampleRetailer extends AbstractRetailer {
    readonly id = 'example';
    readonly name = 'Example';

    readonly sites: Record<string, RetailerSite> = {
      uk: {
        hostnames: ['www.example.com'],
        pathPrefix: '/uk',              // Required when hostname is shared
        catalogPathPattern: /^\/uk\/.*-l\d+\.html/,
      },
      il: {
        hostnames: ['www.example.com'],
        pathPrefix: '/il',
        catalogPathPattern: /^\/il\/.*-l\d+\.html/,
      },
    };

    readonly supportsProductPage = true;
    readonly supportsCatalogPage = true;
    readonly priceSelector = '.product-price';
    readonly productContainerSelector = '.product-grid';
    readonly productContainerFallbackSelectors = ['[data-testid="product-list"]'];

    extractProductId(url: URL): string | null {
      const match = url.pathname.match(/-p(\d{8,})\.html/);
      return match ? match[1] : null;
    }

    async lookupPrice(pid: string, regionId: string): Promise<number | null> {
      // Delegate to your provider (see step 3)
      return yourProvider.lookupPrice(pid, regionId, this.sites);
    }

    transformUrl(url: URL, fromRegion: string, toRegion: string): string {
      // Swap path prefixes, keeping the rest of the URL intact
      const fromPrefix = this.sites[fromRegion].pathPrefix ?? '';
      const toPrefix = this.sites[toRegion].pathPrefix ?? '';
      let path = url.pathname;
      if (fromPrefix && path.startsWith(fromPrefix)) {
        path = path.slice(fromPrefix.length) || '/';
      }
      path = toPrefix + path;
      return `${url.protocol}//${url.hostname}${path}${url.search}${url.hash}`;
    }
  }
  ```

  Key methods to implement:
  - **`sites`** — hostnames, optional `pathPrefix`, and catalog URL pattern per region
  - **`priceSelector`** — CSS selector for the price element on product pages
  - **`productContainerSelector`** — CSS selector for the catalog product grid
  - **`extractProductId(url)`** — extract a unique product ID from the URL (for API/cache lookups)
  - **`lookupPrice(pid, regionId)`** — fetch the price for a product in a given region
  - **`transformUrl(url, from, to)`** — convert a URL from one region to another

- [ ] **3. Create a price provider** in `src/providers/{name}.ts`:

  The provider handles the actual price fetching logic. Two patterns exist:

  **API-based** (like Next/Bloomreach): Query a product search API with the product ID.
  See `src/providers/bloomreach.ts` for a full example.

  **HTML scraping** (like Zara): Fetch the product page and parse the price from HTML.
  This works because the Chrome extension's service worker sends browser-like requests via `host_permissions`.

  ```typescript
  // src/providers/example.ts
  export async function lookupPrice(
    pid: string,
    regionId: string,
    sites: Record<string, RetailerSite>
  ): Promise<number | null> {
    const site = sites[regionId];
    if (!site) return null;

    const url = `https://www.example.com${site.pathPrefix}/en/-p${pid}.html`;
    const resp = await fetch(url, { credentials: 'omit' });
    if (!resp.ok) return null;

    const html = await resp.text();
    // Parse price from HTML
    const match = html.match(/price-element[^>]*>([\s\S]*?)<\/span>/);
    if (!match) return null;

    const price = parseFloat(match[1].replace(/[^\d.]/g, ''));
    return isNaN(price) ? null : price;
  }
  ```

- [ ] **4. Register** in `src/core/registry.ts`:
  ```typescript
  import { ExampleRetailer } from '../retailers/example/ExampleRetailer';
  const retailers: AbstractRetailer[] = [new NextRetailer(), new ZaraRetailer(), new ExampleRetailer()];
  ```

- [ ] **5. Add host permissions** in `manifest.json` under `host_permissions`:
  ```json
  "host_permissions": [
    "https://www.example.com/*"
  ]
  ```

- [ ] **6. Add regions** (if needed) in `src/core/regions.ts`. Existing: `uk` (GBP), `il` (ILS).

- [ ] **7. Write tests**:

  **Retailer tests** in `tests/{Name}Retailer.test.ts`:
  - `getRegionForUrl` — each URL returns correct region, unknown returns null
  - `isCatalogPage` — catalog vs product URLs
  - `transformUrl` — UK→IL, IL→UK, round-trip, query/hash preserved
  - `extractProductId` — product URLs, catalog URLs (null), homepage (null)
  - `getAlternateRegionId` — uk→il, il→uk
  - `selectors` — priceSelector and productContainerSelector are defined

  **Provider tests** in `tests/{name}.test.ts`:
  - Mock `fetch` and test: valid response, 404, missing price element, network error, unknown region

  Run a single test file:
  ```bash
  npx vitest run --reporter=verbose tests/{Name}Retailer.test.ts
  ```

- [ ] **8. Verify everything passes**:
  ```bash
  npm run typecheck          # TypeScript strict check
  npm run lint               # ESLint (0 warnings enforced)
  npm run format:check       # Prettier formatting check
  npm run validate-retailers # Checks each retailer has class, tests, and registry entry
  npm test                   # All unit tests
  npm run build              # Build extension to dist/
  ```

- [ ] **9. Submit PR** linking the issue. Use conventional commits (`feat: add {retailer} retailer support`).

## Finding CSS Selectors

To find the right `priceSelector` for a retailer:

1. Open a product page in Chrome
2. Right-click the price → Inspect
3. Find a CSS selector that uniquely targets the price element
4. Test it in the console: `document.querySelector('your-selector')?.textContent`
5. Check both UK and IL versions of the page — the selector should work on both

For `productContainerSelector`, find the element whose direct children are individual product cards on listing/catalog pages.

## Determining the Price Lookup Strategy

1. **Check for a public API first**: Open DevTools Network tab, browse the retailer site, and look for JSON API calls that return product data with prices. Bloomreach (`core.dxpapi.com`) and Algolia are common.
2. **If no API exists**: The extension can fetch product pages directly from the service worker. As a Chrome extension with `host_permissions`, `fetch()` behaves like a normal browser request — no CORS issues.
3. **JS-rendered prices**: If prices are only present after JavaScript execution (not in initial HTML), you'll need to either find the underlying API that populates them, or use `chrome.scripting.executeScript` to extract from the rendered page.

## Common Pitfalls

Lessons learned from the Zara implementation — check these before submitting your retailer PR.

### Product IDs must be consistent across regions
If a retailer uses region-specific internal IDs (e.g. Zara's `data-productid` is different on UK vs IL for the same product), cross-region catalog matching will silently fail. Verify that `extractProductIdFromElement(domElement)` returns the same value as `extractProductId(productUrl)` for the same product. If the IDs differ, find a universal identifier (Zara uses the 8-digit URL reference from `data-productkey`).

### SPA content script DOM ≠ service worker HTML
The content script sees the fully-rendered SPA DOM (all products loaded by JavaScript). The service worker's `fetch()` gets the initial server-rendered HTML, which may be an empty SPA shell with no product data. Don't assume catalog HTML parsed in the background will have the same content the content script sees. Always fall back to individual product lookups when catalog parsing fails.

### Slug-less URLs may redirect to homepage
Constructed URLs like `example.com/product/-p12345.html` (without the product name slug) may silently redirect to the homepage (HTTP 200, not 404). Use `resp.redirected` and `resp.url` to detect this instead of relying solely on status codes.

### Shared hostnames need `pathPrefix`
When multiple regions share a hostname (like `www.zara.com` for both UK and IL), you **must** set `pathPrefix` (e.g. `/uk`, `/il`) on each site so region detection works. See Zara's implementation for the pattern.

### Bot protection may block service worker fetches
Some retailers use bot protection (Akamai, Cloudflare). Service worker fetches may get challenge pages instead of product data. Use `credentials: 'include'` to send the browser's cookies. Detect challenge markers in the response HTML (e.g. `bm-verify` for Akamai) and handle gracefully.

### Verdict positioning matters
Inject verdicts near the price element (`priceEl.parentElement` as parent, `priceEl` as afterEl), not at the top-level product div. Using relative font sizes like `em` will compound if the verdict is inside a price wrapper with a larger base font. Current font size is `0.85em`.

## Code Style

- TypeScript strict mode
- ESLint with 0 warnings enforced
- Prettier for formatting
- Run `npm run format` before committing

## Testing

```bash
npm test                    # All unit tests
npx vitest run tests/X.ts   # Single test file
npm run validate-retailers   # Structural validation of all retailers
```
