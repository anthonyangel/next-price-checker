#!/usr/bin/env bash
#
# Creates all planned GitHub issues for the price-checker multi-retailer refactor.
# Prerequisites: gh CLI authenticated (gh auth login)
#
# Usage:
#   chmod +x scripts/create-github-issues.sh
#   ./scripts/create-github-issues.sh
#
set -euo pipefail

REPO="anthonyangel/next-price-checker"

echo "Creating labels..."

gh label create "bug"           --repo "$REPO" --color "d73a4a" --description "Something isn't working"                 --force
gh label create "architecture"  --repo "$REPO" --color "0075ca" --description "Structural refactor or design change"    --force
gh label create "new-retailer"  --repo "$REPO" --color "a2eeef" --description "Adding support for a new retailer"       --force
gh label create "testing"       --repo "$REPO" --color "bfd4f2" --description "Test coverage and infrastructure"        --force
gh label create "ci-cd"         --repo "$REPO" --color "fbca04" --description "Build pipeline and automation"           --force
gh label create "open-source"   --repo "$REPO" --color "7057ff" --description "Contributor experience and docs"         --force
gh label create "security"      --repo "$REPO" --color "e4e669" --description "Security hardening"                      --force
gh label create "high-priority" --repo "$REPO" --color "b60205" --description "Should be addressed first"               --force

echo ""
echo "Creating issues..."

# =============================================================================
# BUGS — from audit
# =============================================================================

gh issue create --repo "$REPO" \
  --title "Alternate price extraction uses regex on full HTML, ignores priceSelector" \
  --label "bug,high-priority" \
  --body "$(cat <<'EOF'
## Problem

`background.ts:32` extracts the alternate site price with a regex against the full HTML:

```ts
const match = html.match(/([£₪]\s?\d+[,.]?\d*)/);
```

This matches the **first** price-like string in the entire document — which could be a nav bar, sale banner, header, or unrelated element. The `priceSelector` sent in the message is completely ignored.

## Additional regex issues

- Doesn't handle thousands separators properly (`£1,234.99` → matches `£1,`)
- Doesn't handle price ranges (`£45.00 - £60.00`)
- Could match prices in JSON-LD, meta tags, or script blocks
- Hardcoded to `£` and `₪` only — blocks multi-retailer support

## Fix

Replace regex extraction with `DOMParser` + CSS selectors (or retailer-specific extraction logic once the `AbstractRetailer` pattern is in place).

## Files

- `background.ts:32`
- `contentScript.ts:148-149` (sends priceSelector)
- `popup.ts:124,193` (sends priceSelector)
EOF
)"
echo "  Created: Alternate price extraction"

gh issue create --repo "$REPO" \
  --title "Infinite scroll re-scan does not work when popup is closed" \
  --label "bug,high-priority" \
  --body "$(cat <<'EOF'
## Problem

`contentScript.ts:178-188` — the `MutationObserver` fires:

```ts
chrome.runtime.sendMessage({ action: 'scanListingPage' });
```

`chrome.runtime.sendMessage` sends from content script to the background/popup. But the content script's own `onMessage` listener only handles messages sent *to* it via `chrome.tabs.sendMessage`. So this message goes to the popup — which is almost certainly closed by the time the user scrolls.

**The infinite scroll mechanism is completely broken.**

## Fix

The content script should re-trigger its own scan directly (call its own scanning function) rather than sending a message that no one receives.

## Files

- `contentScript.ts:178-188`
EOF
)"
echo "  Created: Infinite scroll broken"

gh issue create --repo "$REPO" \
  --title "Percentage diff calculation mixes currencies" \
  --label "bug" \
  --body "$(cat <<'EOF'
## Problem

`popup.ts:160,226`:

```ts
const percDiff = (Math.abs(diff) / ((priceCurrent + priceAlt) / 2)) * 100;
```

`priceCurrent` is in one currency (e.g. GBP) and `priceAlt` is in another (e.g. ILS). Averaging `£50 + ₪230` makes no mathematical sense. The denominator should use prices converted to the same currency.

## Files

- `popup.ts:160`
- `popup.ts:226`
EOF
)"
echo "  Created: Percentage diff mixes currencies"

gh issue create --repo "$REPO" \
  --title "Verdict text is inverted in priceUtils.ts" \
  --label "bug" \
  --body "$(cat <<'EOF'
## Problem

`priceUtils.ts:55-60`:

```ts
if (diff > 0) {
  // diff > 0 means currentPrice > altConverted
  // so the CURRENT site is more expensive / ALT is cheaper
  verdict = `${altFlag} more expensive by ...`;  // ← says alt is MORE expensive (wrong)
  highlight = 'color: green;';
} else {
  verdict = `${altFlag} cheaper by ...`;  // ← says alt is CHEAPER (wrong)
  highlight = 'color: red;';
}
```

The labels are backwards. Currently masked because `contentScript.ts` builds its own verdict string, but anyone using `getPriceComparisonVerdict().verdict` gets the wrong answer.

## Files

- `priceUtils.ts:55-60`
EOF
)"
echo "  Created: Verdict text inverted"

gh issue create --repo "$REPO" \
  --title "background.ts conversion is wrong for IL→UK direction" \
  --label "bug" \
  --body "$(cat <<'EOF'
## Problem

`background.ts:40`:

```ts
converted: price !== null && !isNaN(price) ? price / rate : null,
```

The rate is GBP→ILS (e.g. 4.6). When browsing IL and fetching the UK price (in GBP):
- `price / rate` = `GBP / 4.6` = a tiny meaningless number
- Should be `GBP * rate` = ILS equivalent

This `converted` field is not currently consumed by the popup or content script (they recalculate), so it is dormant — but it is a landmine for future use.

## Files

- `background.ts:40`
EOF
)"
echo "  Created: Conversion wrong for IL→UK"

gh issue create --repo "$REPO" \
  --title "Price ranges parse incorrectly" \
  --label "bug" \
  --body "$(cat <<'EOF'
## Problem

`priceUtils.ts:11`:

```ts
const parsed = parseFloat(raw.replace(/[^\d.]/g, ''));
```

A price range like `"₪45.00 - ₪60.00"` becomes `"45.0060.00"` which `parseFloat` reads as `45.006`. This silently returns a wrong price.

## Fix

Either take the first price (split on `-` or similar delimiter) or explicitly handle ranges. Consider using a more robust `parsePrice` function that the `AbstractRetailer` base class provides.

## Files

- `priceUtils.ts:11`
EOF
)"
echo "  Created: Price ranges parse incorrectly"

# =============================================================================
# ARCHITECTURE — multi-retailer refactor
# =============================================================================

gh issue create --repo "$REPO" \
  --title "Define global region config (UK, IL) with currency and flag" \
  --label "architecture,high-priority" \
  --body "$(cat <<'EOF'
## Summary

Create a `core/regions.ts` module that defines regions as a global concept, independent of any retailer. Currency and flag are properties of a region, not of a retailer.

```ts
export interface Region {
  id: string;
  name: string;
  flag: string;
  currency: CurrencyCode;
  currencySymbol: string;
}

export const regions: Record<string, Region> = {
  uk: { id: 'uk', name: 'United Kingdom', flag: '🇬🇧', currency: 'GBP', currencySymbol: '£' },
  il: { id: 'il', name: 'Israel',         flag: '🇮🇱', currency: 'ILS', currencySymbol: '₪' },
};
```

Adding a new country later is a one-line addition here. Retailers never duplicate this information.

## Replaces

- `siteMeta.ts` — hardcoded `isUK ? '🇬🇧' : '🇮🇱'` and `isUK ? '£' : '₪'`
- Scattered `isUK ? ... : ...` ternaries across popup.ts, contentScript.ts, priceUtils.ts

## Depends on

Nothing — this is the foundation for the multi-retailer refactor.
EOF
)"
echo "  Created: Global region config"

gh issue create --repo "$REPO" \
  --title "Create AbstractRetailer base class and retailer registry" \
  --label "architecture,high-priority" \
  --body "$(cat <<'EOF'
## Summary

Create the base class that all retailer implementations extend. Inspired by the [UKBinCollectionData](https://github.com/robbrad/UKBinCollectionData) pattern where each council extends `AbstractGetBinDataClass`.

```ts
export abstract class AbstractRetailer {
  abstract readonly id: string;
  abstract readonly name: string;

  abstract readonly sites: {
    [regionId: string]: {
      hostnames: string[];
      pathPrefix?: string;
      catalogPathPattern: RegExp;
    };
  };

  abstract readonly supportsProductPage: boolean;
  abstract readonly supportsCatalogPage: boolean;

  extractProductPagePrice?(doc: Document): PriceResult | null;
  extractCatalogProducts?(doc: Document): ProductEntry[];
  abstract transformUrl(url: URL, fromRegion: string, toRegion: string): URL;
}
```

Key design decisions:
- **`supportsProductPage` / `supportsCatalogPage`** — explicit booleans so the framework knows what to wire up
- **Human-readable names** — no PDP/PLP acronyms (`extractProductPagePrice`, `extractCatalogProducts`, `isCatalogPage`)
- **Regions are global** — retailers reference region IDs, never duplicate currency/flag
- **Optional methods tied to flags** — if `supportsCatalogPage` is false, `extractCatalogProducts` doesn't need to exist

Also create:
- `core/registry.ts` — looks up the correct retailer by hostname
- `retailers/retailers.json` — declarative registry of all retailers

## Depends on

- Global region config
EOF
)"
echo "  Created: AbstractRetailer base class"

gh issue create --repo "$REPO" \
  --title "Migrate existing Next logic into NextRetailer class" \
  --label "architecture,high-priority" \
  --body "$(cat <<'EOF'
## Summary

Extract all Next-specific logic from the current monolithic code into `retailers/next/NextRetailer.ts` extending `AbstractRetailer`.

### What moves into NextRetailer

| Current location | NextRetailer method |
|---|---|
| `selectors.ts` (all selectors) | `extractProductPagePrice()` + `extractCatalogProducts()` |
| `urlUtils.ts` (domain swap + /en path logic) | `transformUrl()` |
| `popup.ts:75` (`/shop` path check) | `sites.uk.catalogPathPattern` / `sites.il.catalogPathPattern` |

### What becomes generic core

| Current location | New core module |
|---|---|
| `siteMeta.ts` | `core/regions.ts` |
| `exchangeRate.ts` | `core/exchangeRate.ts` (dynamic currency pair) |
| `priceUtils.ts` (verdict logic) | `core/priceComparison.ts` |
| `contentScript.ts` (orchestration) | `core/contentScript.ts` (uses registry) |
| `background.ts` (fetch proxy) | `core/background.ts` (delegates to retailer's extractPriceFromHTML) |
| `popup.ts` (UI) | `core/popup.ts` (uses region config for display) |

### Acceptance criteria

- All existing functionality works identically after migration
- No Next-specific strings remain in core modules
- `exchangeRate.ts` accepts dynamic currency pairs instead of hardcoded GBP→ILS

## Depends on

- Global region config
- AbstractRetailer base class
EOF
)"
echo "  Created: Migrate Next to NextRetailer"

gh issue create --repo "$REPO" \
  --title "Make exchangeRate.ts support dynamic currency pairs" \
  --label "architecture" \
  --body "$(cat <<'EOF'
## Problem

`exchangeRate.ts:12` hardcodes GBP→ILS:

```ts
const res = await fetch('https://api.frankfurter.app/latest?from=GBP&to=ILS');
```

`constants.ts:6` hardcodes the fallback rate:

```ts
export const FALLBACK_RATE = 4.6;
```

## Fix

Accept `from` and `to` currency codes as parameters:

```ts
export async function getCachedOrFetchRate(from: CurrencyCode, to: CurrencyCode): Promise<RateResult>
```

Cache key should include the currency pair. Fallback rates should be a map:

```ts
const FALLBACK_RATES: Record<string, number> = {
  'GBP:ILS': 4.6,
  // future pairs added here
};
```

## Files

- `exchangeRate.ts`
- `constants.ts`
EOF
)"
echo "  Created: Dynamic currency pairs"

gh issue create --repo "$REPO" \
  --title "Deduplicate popup.ts verdict logic" \
  --label "architecture" \
  --body "$(cat <<'EOF'
## Problem

`popup.ts:97-183` (`handleProductPage`) and `popup.ts:185-242` (`handleProductPageVerdict`) contain nearly identical price comparison logic — exchange rate fetch, price formatting, verdict calculation, HTML rendering. ~80 lines duplicated.

This duplication means bugs diverge between the two code paths and makes the multi-retailer refactor harder.

## Fix

Extract shared logic into a single function or move it to `core/priceComparison.ts`. Both popup handlers should call the same rendering pipeline.

## Files

- `popup.ts:97-242`
EOF
)"
echo "  Created: Deduplicate popup verdict logic"

# =============================================================================
# NEW RETAILERS
# =============================================================================

gh issue create --repo "$REPO" \
  --title "Add H&M retailer support (UK + Israel)" \
  --label "new-retailer" \
  --body "$(cat <<'EOF'
## Overview

H&M is the best first candidate for multi-retailer support. Same currencies (GBP/ILS), stable extraction via `__NEXT_DATA__`, and known significant price gaps between UK and Israel.

## Site details

| Region | Domain | Locale prefix |
|---|---|---|
| UK | `www2.hm.com` | `/en_gb` |
| Israel | `www2.hm.com` | `/hw_il` (note: NOT `he_il`) |

Same domain, locale in path prefix.

## Product page (PDP)

- URL pattern: `/{locale}/productpage.{product_id}.html`
- Example: `https://www2.hm.com/en_gb/productpage.1247834001.html`
- Product ID: 10-digit numeric (first 7 = base product, last 3 = colour variant)
- Price extraction: parse `<script id="__NEXT_DATA__">` → `props.pageProps.productPageProps.aemData.productArticleDetails`
- `supportsProductPage: true`

## Catalog page (PLP)

- URL pattern: `/{locale}/{dept}/shop-by-product/{subcategory}.html`
- `__NEXT_DATA__` also contains product listings on category pages
- JSON path: `props.pageProps.srpProps.hits` → array of `{pdpUrl, regularPrice, title, ...}`
- `supportsCatalogPage: true`

## URL transform

Swap locale prefix: `/en_gb/` ↔ `/hw_il/`

## Deliverables

1. `src/retailers/hm/HMRetailer.ts`
2. `tests/fixtures/hm/product-page-uk.html`
3. `tests/fixtures/hm/product-page-il.html`
4. `tests/fixtures/hm/catalog-uk.html`
5. `tests/retailers/hm.test.ts`
6. Entry in `retailers.json`

## Depends on

- AbstractRetailer base class
- NextRetailer migration (proves the pattern)
EOF
)"
echo "  Created: H&M retailer"

gh issue create --repo "$REPO" \
  --title "Add Zara retailer support (UK + Israel)" \
  --label "new-retailer" \
  --body "$(cat <<'EOF'
## Overview

Zara has clear regional sites with path-based locale switching. Harder than H&M due to SPA rendering.

## Site details

| Region | Domain | Path prefix |
|---|---|---|
| UK | `www.zara.com` | `/uk/en` |
| Israel | `www.zara.com` | `/il/en` |

Same domain, region + language in path.

## Product page

- URL pattern: `/{country}/{lang}/{product-name}-p{product_id}.html`
- Example: `https://www.zara.com/uk/en/hooded-puffer-jacket-p04302501.html`
- `-p` prefix on ID distinguishes product pages from category pages (`-l`)
- **SPA-rendered** — content is API-fetched and client-rendered. Content script must wait for React render to complete before extracting.
- `supportsProductPage: true`

## Catalog page

- URL pattern: `/{country}/{lang}/{category-slug}-l{category_id}.html`
- Fully SPA-rendered with infinite scroll, product data loaded via AJAX
- **Initially set `supportsCatalogPage: false`** — can be upgraded later once a reliable extraction strategy is established (API interception, MutationObserver wait, etc.)

## URL transform

Swap country prefix: `/uk/en/` ↔ `/il/en/`

## Key challenge

Since Zara is a full SPA, the content script cannot extract from static HTML. Strategies:
1. Wait for DOM to settle after React render (MutationObserver + debounce)
2. Intercept `fetch`/`XMLHttpRequest` calls to Zara's product API
3. Look for structured data (`JSON-LD`) if present after JS execution

## Deliverables

1. `src/retailers/zara/ZaraRetailer.ts`
2. `tests/fixtures/zara/product-page-uk.html` (post-render snapshot)
3. `tests/fixtures/zara/product-page-il.html`
4. `tests/retailers/zara.test.ts`
5. Entry in `retailers.json`

## Depends on

- AbstractRetailer base class
- NextRetailer migration (proves the pattern)
EOF
)"
echo "  Created: Zara retailer"

# =============================================================================
# TESTING
# =============================================================================

gh issue create --repo "$REPO" \
  --title "Add unit tests for core utility functions" \
  --label "testing,high-priority" \
  --body "$(cat <<'EOF'
## Problem

Zero test coverage. The following pure functions have confirmed bugs that tests would have caught:

- `parsePrice` — fails on price ranges (B7)
- `getPriceComparisonVerdict` — inverted verdict text (B5)
- `getAlternateUrl` — no coverage for edge cases
- `getSiteMeta` — trivial but foundational

## Deliverables

Set up vitest and write tests for:

### `priceUtils.ts`
- Parse simple prices (`£45.00`, `₪230`)
- Parse prices with thousands separators (`£1,234.99`)
- Handle price ranges (`£45.00 - £60.00`) — currently broken
- Reject non-price strings
- Verdict direction (when current > alt, when alt > current, when equal)

### `urlUtils.ts`
- UK → IL transform
- IL → UK transform
- Round-trip (UK → IL → UK preserves URL)
- Query params and hash preserved

### `exchangeRate.ts`
- Returns cached rate within TTL
- Fetches fresh rate after TTL expires
- Falls back to default rate on network error

### `siteMeta.ts`
- Returns correct currency/flag for UK hostname
- Returns correct currency/flag for IL hostname

## Test infrastructure

- Add `vitest` as dev dependency
- Add `test` script to `package.json`
- Add test step to CI workflow

## Files

- `tests/core/priceUtils.test.ts`
- `tests/core/urlUtils.test.ts`
- `tests/core/exchangeRate.test.ts`
- `tests/core/siteMeta.test.ts`
EOF
)"
echo "  Created: Unit tests for core utilities"

gh issue create --repo "$REPO" \
  --title "Establish retailer test pattern with fixtures" \
  --label "testing" \
  --body "$(cat <<'EOF'
## Summary

Define the standard test pattern that all retailer submissions must follow. Each retailer needs:

### Required test coverage

1. **Product page price extraction** — both regions (UK fixture + IL fixture)
2. **Catalog product extraction** — at least one region (if `supportsCatalogPage` is true)
3. **URL transform UK→IL**
4. **URL transform IL→UK**
5. **URL round-trip** — UK→IL→UK should produce the original URL

### Fixture pattern

```
tests/fixtures/{retailer-id}/
  product-page-uk.html      # saved HTML snapshot of a UK product page
  product-page-il.html      # saved HTML snapshot of an IL product page
  catalog-uk.html            # saved HTML snapshot of a UK catalog page (if supported)
  catalog-il.html            # (optional)
```

### Example test structure

```ts
describe('H&M', () => {
  const retailer = new HMRetailer();

  describe('product page extraction', () => {
    it('extracts price from UK product page', () => { ... });
    it('extracts price from IL product page', () => { ... });
    it('returns null for non-product page', () => { ... });
  });

  describe('URL transforms', () => {
    it('transforms UK to IL', () => { ... });
    it('transforms IL to UK', () => { ... });
    it('round-trips without data loss', () => { ... });
  });
});
```

### CI validation

Add a step to the GitHub Actions workflow that validates:
- Every retailer in `retailers.json` has a matching test file
- Every retailer has fixture files for all declared regions
- All tests pass

## Depends on

- AbstractRetailer base class
- Unit tests for core utilities (vitest setup)
EOF
)"
echo "  Created: Retailer test pattern"

# =============================================================================
# CI/CD
# =============================================================================

gh issue create --repo "$REPO" \
  --title "Scope CI workflow to main branch and PRs" \
  --label "ci-cd" \
  --body "$(cat <<'EOF'
## Problem

`.github/workflows/release-please.yaml` triggers on every push to every branch:

```yaml
on:
  push:
```

Every push to any branch runs the full pipeline (install, typecheck, lint, format, build, artifact upload).

## Fix

Scope to main and pull requests:

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
```

## Files

- `.github/workflows/release-please.yaml`
EOF
)"
echo "  Created: Scope CI to main"

gh issue create --repo "$REPO" \
  --title "Add retailer submission validation to CI" \
  --label "ci-cd,open-source" \
  --body "$(cat <<'EOF'
## Summary

When a PR adds a new retailer, CI should automatically validate the submission is complete:

### Checks

1. Every entry in `retailers.json` has a matching class file at the declared module path
2. Every retailer class extends `AbstractRetailer`
3. Every retailer has fixture files for all declared regions
4. Every retailer has a test file
5. All retailer tests pass
6. TypeScript compiles, lint clean

### Implementation

Add a validation script (`scripts/validate-retailers.ts`) and a CI step that runs it. The script reads `retailers.json`, verifies file existence, and runs a basic structural check.

## Depends on

- AbstractRetailer base class
- Retailer test pattern
EOF
)"
echo "  Created: Retailer submission validation"

# =============================================================================
# SECURITY / QUALITY
# =============================================================================

gh issue create --repo "$REPO" \
  --title "Replace innerHTML with safe DOM APIs" \
  --label "security" \
  --body "$(cat <<'EOF'
## Problem

URLs derived from page content are interpolated into HTML strings and injected via `innerHTML`:

```ts
verdictDiv.innerHTML = html; // domUtils.ts:22
```

Where `html` contains:

```ts
`<a href="${getAlternateUrl(...)}" target="_blank">View alternate site</a>`
```

Low risk since this only runs on known retailer domains, but using `textContent` + `createElement('a')` would be safer and aligns with MV3 CSP best practices.

## Files

- `domUtils.ts:22`
- `contentScript.ts:219,249`
- `popup.ts:167,233`
EOF
)"
echo "  Created: Replace innerHTML"

gh issue create --repo "$REPO" \
  --title "Remove dead code and fix minor quality issues" \
  --label "bug" \
  --body "$(cat <<'EOF'
## Items

### Dead code
- `batchUtils.ts` — `processInBatches` and `SimpleCache` are exported but never imported anywhere. The content script implements its own batching inline. Remove or consolidate.

### Deprecated API
- `contentScript.ts:101` — `unescape()` is deprecated. Replace `btoa(unescape(encodeURIComponent(product.link)))` with a modern equivalent.

### Missing regex flag
- `contentScript.ts:103` — `.replace(/\/+/, '_')` is missing the `g` flag. Only replaces the first run of slashes. Should be `.replace(/\/+/g, '_')`.

### Suppressed type safety
- `background.ts:42` — `@ts-ignore` on `sendResponse`. Fix with a proper type assertion on the listener callback signature.

### Unconditional return true
- `background.ts:54` — `return true` for all messages, not just `getAlternatePrice`. Keeps async channel open for unhandled messages. Should be conditional.
EOF
)"
echo "  Created: Dead code and quality fixes"

# =============================================================================
# OPEN SOURCE
# =============================================================================

gh issue create --repo "$REPO" \
  --title "Add CLAUDE.md with project overview and contributor instructions" \
  --label "open-source" \
  --body "$(cat <<'EOF'
## Summary

Add a `CLAUDE.md` file that serves as the primary reference for AI-assisted and human contributors.

### Contents

1. **Project overview** — what the extension does, tech stack (Chrome MV3, TypeScript, Vite)
2. **Adding a new retailer** — step-by-step:
   - Files to create (retailer class, fixtures, tests)
   - Registry entry in `retailers.json`
   - What methods to implement (`extractProductPagePrice`, `extractCatalogProducts`, `transformUrl`)
   - Required tests (both URL directions + round-trip)
   - Reference to optional scaffolding script
3. **Commands** — build, typecheck, lint, test, test single retailer
4. **Architecture notes** — regions are global, retailers reference region IDs, extraction strategy varies per retailer

### References

- Inspired by [UKBinCollectionData](https://github.com/robbrad/UKBinCollectionData) contributor model
- The scaffolding script (`scripts/create-retailer.ts`) is optional but referenced from CLAUDE.md
EOF
)"
echo "  Created: CLAUDE.md"

gh issue create --repo "$REPO" \
  --title "Add CONTRIBUTING.md with submission checklist" \
  --label "open-source" \
  --body "$(cat <<'EOF'
## Summary

Add a `CONTRIBUTING.md` with a clear checklist for retailer submissions, modeled on the [UKBinCollectionData contributing guide](https://github.com/robbrad/UKBinCollectionData/blob/master/CONTRIBUTING.md).

### Checklist for adding a new retailer

1. Check existing issues — someone may already be working on it
2. Claim the issue or open a new one with retailer name, UK + IL URLs, example product URLs, and whether prices are in HTML or JS-rendered
3. Optionally run the scaffolding script: `npx tsx scripts/create-retailer.ts "RetailerName"`
4. Implement required methods:
   - `extractProductPagePrice(doc)` — price from a product page
   - `extractCatalogProducts(doc)` — product list from a catalog page (if supported)
   - `transformUrl(url, from, to)` — swap between regions
5. Save HTML fixtures for both regions
6. Write tests — all must pass:
   - Product page price extraction (both regions)
   - Catalog extraction (if `supportsCatalogPage: true`)
   - URL transform in both directions + round-trip
7. Run `npm test -- --filter={retailer}`
8. Submit PR

### Also include

- Dev environment setup (Node version, `npm install`, loading unpacked extension)
- How to save HTML fixtures (view source, save page, or DevTools)
- Code style expectations (TypeScript strict, ESLint, Prettier)
EOF
)"
echo "  Created: CONTRIBUTING.md"

gh issue create --repo "$REPO" \
  --title "Add retailer scaffolding script" \
  --label "open-source" \
  --body "$(cat <<'EOF'
## Summary

Create `scripts/create-retailer.ts` — a scaffolding script that generates the skeleton files for a new retailer submission.

### Usage

```
npx tsx scripts/create-retailer.ts "H&M"
```

### What it does

1. Derives an ID from the name (`hm`)
2. Copies `retailers/_template/TemplateRetailer.ts` → `retailers/hm/HMRetailer.ts`
3. Replaces template class name with `HMRetailer`
4. Adds entry to `retailers.json`
5. Creates empty fixture dirs: `tests/fixtures/hm/`
6. Creates skeleton test file: `tests/retailers/hm.test.ts`

### Referenced from CLAUDE.md

The script is optional — contributors can create files manually following the CLAUDE.md instructions. But it saves time and ensures the file structure is correct.
EOF
)"
echo "  Created: Scaffolding script"

gh issue create --repo "$REPO" \
  --title "Update manifest.json for multi-retailer host permissions" \
  --label "architecture" \
  --body "$(cat <<'EOF'
## Problem

`manifest.json` hardcodes host permissions for Next only:

```json
"host_permissions": [
  "https://www.next.co.uk/*",
  "https://www.next.co.il/*"
]
```

## Fix

Use `optional_host_permissions` for retailer domains beyond Next. The extension requests permissions at runtime when the user enables a new retailer.

```json
"host_permissions": [
  "https://www.next.co.uk/*",
  "https://www.next.co.il/*"
],
"optional_host_permissions": [
  "https://www2.hm.com/*",
  "https://www.zara.com/*"
]
```

The popup or options page should include a retailer toggle that triggers `chrome.permissions.request()` for the selected retailer's domains.

## Depends on

- AbstractRetailer base class (needs to know which retailers are available)
EOF
)"
echo "  Created: Multi-retailer host permissions"

echo ""
echo "Done! All issues created."
echo ""
echo "View them at: https://github.com/anthonyangel/next-price-checker/issues"
