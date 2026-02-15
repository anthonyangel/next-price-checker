# Price Checker Chrome Extension

A Chrome extension that compares product prices between UK and Israel versions of retail websites. It fetches alternate site prices, converts currencies, and injects a verdict and link for each product, helping you find the best deal.

## Supported Retailers

| Retailer | UK | Israel | Lookup method |
|---|---|---|---|
| **Next** | next.co.uk | next.co.il | Bloomreach Discovery API |
| **Zara** | zara.com/uk | zara.com/il | HTML scraping (product pages) |
| **H&M** | www2.hm.com/en_gb | www2.hm.com/hw_il | `__NEXT_DATA__` JSON parsing |

## Features
- Compares prices between UK and Israel for each product on supported retailers.
- Fetches alternate site prices via background service worker.
- Converts currencies using live GBP/ILS exchange rates.
- Injects a verdict and alternate site link on both product and catalog pages.
- Catalog page summary with "cheaper here" filtering.
- Handles infinite scroll and dynamically loaded products.
- Persistent price cache to reduce repeat lookups.

## Installation (Development)
1. Clone this repository.
2. Run `npm install` to install dependencies.
3. Build the extension: `npm run build`
4. Load the `dist/` directory as an unpacked extension in Chrome (`chrome://extensions` → Developer mode → Load unpacked).

## Usage
- Browse any supported retailer site (UK or Israel version).
- On product or catalog pages, the extension automatically injects price comparison verdicts.
- Click the verdict link to view the product on the alternate site.
- Use the popup for a summary and to trigger a scan on catalog pages.

## Development
- See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide on adding new retailers.
- `npm run typecheck` — TypeScript strict check
- `npm run lint` — ESLint (0 warnings enforced)
- `npm run format` — Prettier
- `npm test` — Run all unit tests

## Contributing
Pull requests and issues are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for the retailer checklist and code style guide.

## License
MIT
