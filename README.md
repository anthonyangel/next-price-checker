# Next Price Checker Chrome Extension

A Chrome extension to compare product prices between Next UK and Next IL, directly on product and listing pages. It fetches alternate site prices, converts currencies, and injects a verdict and link for each product, helping you find the best deal.

## Features
- Compares prices between Next UK and Next IL for each product.
- Fetches alternate site prices via background script for accuracy.
- Converts currencies using live exchange rates.
- Injects a verdict and alternate site link on both product and listing pages.
- Handles infinite scroll and dynamically loaded products.
- Robust, type-safe, and maintainable codebase.

## Installation (Development)
1. Clone this repository.
2. Run `npm install` to install dependencies.
3. Build the extension:
   - For development: `npm run build`
   - For production: `npm run build:prod`
4. Load the `dist/` or `build/` directory as an unpacked extension in Chrome.

## Usage
- Browse Next UK or Next IL.
- On product or listing pages, the extension will automatically inject price comparison verdicts.
- Click the verdict link to view the product on the alternate site.
- Use the popup for a summary and to trigger a scan if needed.

## Development
- Main logic in `src/contentScript.ts` and `src/background.ts`.
- Shared utilities and types in `src/`.
- All code is type-safe and linted with ESLint.
- To lint: `npm run lint`
- To format: `npm run format`

## Contributing
Pull requests and issues are welcome! Please ensure code is type-safe and passes linting before submitting.

## License
MIT
