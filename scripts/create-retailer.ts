#!/usr/bin/env npx tsx
/**
 * Scaffolding script — generates boilerplate files for a new retailer.
 *
 * Usage:
 *   npx tsx scripts/create-retailer.ts "H&M"
 *   npx tsx scripts/create-retailer.ts "Zara"
 */

import fs from 'fs';
import path from 'path';

const name = process.argv[2];
if (!name) {
  console.error('Usage: npx tsx scripts/create-retailer.ts "RetailerName"');
  process.exit(1);
}

// Derive identifiers from the name
const id = name.toLowerCase().replace(/[^a-z0-9]/g, '');
const className = name.replace(/[^a-zA-Z0-9]/g, '') + 'Retailer';

const root = path.resolve(import.meta.dirname, '..');
const retailerDir = path.join(root, 'src', 'retailers', id);
const testFile = path.join(root, 'tests', `${className}.test.ts`);

if (fs.existsSync(retailerDir)) {
  console.error(`Retailer directory already exists: src/retailers/${id}/`);
  process.exit(1);
}

// 1. Create retailer class
fs.mkdirSync(retailerDir, { recursive: true });

const retailerSource = `/**
 * ${name} retailer implementation.
 * TODO: Fill in hostnames, selectors, and URL transform logic.
 */

import { AbstractRetailer, type RetailerSite } from '../../core/AbstractRetailer';

export class ${className} extends AbstractRetailer {
  readonly id = '${id}';
  readonly name = '${name}';

  readonly sites: Record<string, RetailerSite> = {
    uk: {
      hostnames: ['TODO'],
      catalogPathPattern: /TODO/,
    },
    il: {
      hostnames: ['TODO'],
      catalogPathPattern: /TODO/,
    },
  };

  readonly supportsProductPage = true;
  readonly supportsCatalogPage = false;

  readonly priceSelector = 'TODO';
  readonly productContainerSelector = 'TODO';
  readonly productContainerFallbackSelectors: string[] = [];

  transformUrl(url: URL, fromRegion: string, toRegion: string): string {
    const toSite = this.sites[toRegion];
    if (!toSite) throw new Error(\`Unknown region: \${toRegion}\`);
    return \`\${url.protocol}//\${toSite.hostnames[0]}\${url.pathname}\${url.search}\${url.hash}\`;
  }

  extractProductId(url: URL): string | null {
    // TODO: Extract product ID from URL path
    void url;
    return null;
  }

  async lookupPrice(pid: string, regionId: string): Promise<number | null> {
    // TODO: Implement price lookup for this retailer
    void pid;
    void regionId;
    return null;
  }
}
`;

fs.writeFileSync(path.join(retailerDir, `${className}.ts`), retailerSource);
console.log(`Created src/retailers/${id}/${className}.ts`);

// 2. Create test file
const testSource = `import { ${className} } from '../src/retailers/${id}/${className}';

describe('${className}', () => {
  const retailer = new ${className}();

  describe('getRegionForHostname', () => {
    it.todo('returns uk for UK hostname');
    it.todo('returns il for IL hostname');

    it('returns null for unknown hostname', () => {
      expect(retailer.getRegionForHostname('www.unknown.com')).toBeNull();
    });
  });

  describe('isCatalogPage', () => {
    it.todo('returns true for catalog paths');
    it.todo('returns false for product paths');
  });

  describe('transformUrl', () => {
    it.todo('transforms UK to IL');
    it.todo('transforms IL to UK');
    it.todo('round-trip preserves URL');
  });

  describe('selectors', () => {
    it('has a price selector', () => {
      expect(retailer.priceSelector).toBeTruthy();
    });
  });
});
`;

fs.writeFileSync(testFile, testSource);
console.log(`Created tests/${className}.test.ts`);

// 3. Print next steps
console.log(`
Next steps:
  1. Fill in hostnames, selectors, and transformUrl in src/retailers/${id}/${className}.ts
  2. Register the retailer in src/core/registry.ts:
       import { ${className} } from '../retailers/${id}/${className}';
       // Add to retailers array
  3. Add host permissions to manifest.json under optional_host_permissions
  4. Complete the .todo() tests in tests/${className}.test.ts
  5. Run: npx vitest run tests/${className}.test.ts
`);
