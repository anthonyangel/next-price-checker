# Next Price Checker

Chrome MV3 extension that compares product prices between UK and Israel versions of retail websites. Currently supports **Next** (next.co.uk / next.co.il).

## Tech Stack

- **Chrome MV3** — service worker background, content scripts, popup
- **TypeScript** (strict) — all source in `src/`
- **Vite** — two build configs: one for content script (IIFE), one for background + popup (ESM)
- **Vitest** — unit tests in `tests/`

## Commands

```bash
npm run build          # Build extension to dist/
npm run typecheck      # TypeScript strict check
npm run lint           # ESLint (0 warnings enforced)
npm run format         # Prettier
npm test               # Run all unit tests (vitest)
```

Run tests for a single retailer:

```bash
npx vitest run --reporter=verbose tests/NextRetailer.test.ts
```

## Architecture

```
src/
  core/
    regions.ts          # Global region definitions (UK, IL) — currency, flag, symbol
    AbstractRetailer.ts # Base class all retailers extend
    registry.ts         # Looks up retailer by hostname
  retailers/
    next/
      NextRetailer.ts   # Next-specific: sites, selectors, URL transform
  background.ts         # Service worker — fetches alternate prices
  contentScript.ts      # Injected into retailer pages — extracts prices, injects verdicts
  popup.ts              # Extension popup — shows price comparison
  exchangeRate.ts       # Fetches/caches GBP↔ILS exchange rate
  siteMeta.ts           # Derives currency/flag metadata from hostname
  urlUtils.ts           # Transforms URL to alternate region
```

**Key concepts:**

- **Regions** are global (`src/core/regions.ts`). A region has an ID, currency, flag, and symbol. Retailers reference region IDs — they never duplicate region data.
- **Retailers** extend `AbstractRetailer` and define their sites (hostnames, path prefixes, catalog patterns), CSS selectors, and URL transformation logic.
- **Registry** (`src/core/registry.ts`) maps hostnames → retailers. Adding a new retailer means creating a class and registering it here.

## Adding a New Retailer

### 1. Create the retailer class

Create `src/retailers/{id}/{Name}Retailer.ts` extending `AbstractRetailer`:

```typescript
import { AbstractRetailer, type RetailerSite } from '../../core/AbstractRetailer';

export class ExampleRetailer extends AbstractRetailer {
  readonly id = 'example';
  readonly name = 'Example';

  readonly sites: Record<string, RetailerSite> = {
    uk: { hostnames: ['www.example.co.uk'], catalogPathPattern: /\/products/ },
    il: { hostnames: ['www.example.co.il'], catalogPathPattern: /\/products/ },
  };

  readonly supportsProductPage = true;
  readonly supportsCatalogPage = true;

  readonly priceSelector = '.product-price';
  readonly productContainerSelector = '.product-grid';
  readonly productContainerFallbackSelectors = ['[data-testid="product-list"]'];

  transformUrl(url: URL, fromRegion: string, toRegion: string): string {
    const toSite = this.sites[toRegion];
    return `${url.protocol}//${toSite.hostnames[0]}${url.pathname}${url.search}${url.hash}`;
  }
}
```

### 2. Register it

In `src/core/registry.ts`, import and add to the `retailers` array:

```typescript
import { ExampleRetailer } from '../retailers/example/ExampleRetailer';

const retailers: AbstractRetailer[] = [new NextRetailer(), new ExampleRetailer()];
```

### 3. Update manifest.json

Add host permissions under `optional_host_permissions`:

```json
"optional_host_permissions": [
  "https://www.example.co.uk/*",
  "https://www.example.co.il/*"
]
```

### 4. Add regions (if needed)

If your retailer operates in a region not yet in `src/core/regions.ts`, add it there. Existing regions: `uk` (GBP), `il` (ILS).

### 5. Write tests

Create `tests/{Name}Retailer.test.ts` covering:

- `getRegionForHostname` — each hostname returns correct region, unknown returns null
- `isCatalogPage` — catalog vs product URLs
- `transformUrl` — both directions (UK→IL, IL→UK), round-trip, query/hash preservation

### 6. Scaffolding script (optional)

```bash
npx tsx scripts/create-retailer.ts "Example Store"
```

This generates the boilerplate files. See `CONTRIBUTING.md` for the full checklist.

## Git Workflow

- **Never push directly to `main`.** All changes must go through a PR.
- Use [conventional commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, `style:`, `docs:`, `test:`, `refactor:`).
- CI runs on every push to `main` and on PRs: typecheck, lint, format check, validate-retailers, tests, build.
- Releases are automated via **release-please**. Merging a release-please PR bumps versions, updates the changelog, creates a GitHub release, and publishes to the Chrome Web Store.
