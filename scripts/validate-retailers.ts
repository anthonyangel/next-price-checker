#!/usr/bin/env npx tsx
/**
 * CI validation script — checks that every retailer under src/retailers/
 * has the required structure: a Retailer class file and a matching test file.
 *
 * Usage:
 *   npx tsx scripts/validate-retailers.ts
 *
 * Exit code 0 = all valid, 1 = errors found.
 */

import fs from 'fs';
import path from 'path';

const root = path.resolve(import.meta.dirname, '..');
const retailersDir = path.join(root, 'src', 'retailers');
const testsDir = path.join(root, 'tests');
const registryFile = path.join(root, 'src', 'core', 'registry.ts');

const errors: string[] = [];

// 1. Find all retailer directories
const retailerDirs = fs
  .readdirSync(retailersDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

if (retailerDirs.length === 0) {
  errors.push('No retailer directories found under src/retailers/');
}

for (const id of retailerDirs) {
  const dir = path.join(retailersDir, id);
  const files = fs.readdirSync(dir);

  // 2. Check for a *Retailer.ts file
  const retailerFile = files.find((f) => f.endsWith('Retailer.ts'));
  if (!retailerFile) {
    errors.push(`src/retailers/${id}/ — missing *Retailer.ts file`);
    continue;
  }

  const className = retailerFile.replace('.ts', '');

  // 3. Check the class file contains required patterns
  const source = fs.readFileSync(path.join(dir, retailerFile), 'utf-8');

  if (!source.includes('extends AbstractRetailer')) {
    errors.push(`src/retailers/${id}/${retailerFile} — does not extend AbstractRetailer`);
  }

  if (!source.includes('readonly id')) {
    errors.push(`src/retailers/${id}/${retailerFile} — missing 'readonly id'`);
  }

  if (!source.includes('readonly priceSelector')) {
    errors.push(`src/retailers/${id}/${retailerFile} — missing 'readonly priceSelector'`);
  }

  if (!source.includes('transformUrl')) {
    errors.push(`src/retailers/${id}/${retailerFile} — missing transformUrl method`);
  }

  // 4. Check for a matching test file
  const testFile = path.join(testsDir, `${className}.test.ts`);
  if (!fs.existsSync(testFile)) {
    errors.push(`tests/${className}.test.ts — missing test file for ${className}`);
  }

  // 5. Check the retailer is registered in registry.ts
  const registrySource = fs.readFileSync(registryFile, 'utf-8');
  if (!registrySource.includes(className)) {
    errors.push(`src/core/registry.ts — ${className} is not registered`);
  }

  console.log(`  ✓ ${className} (src/retailers/${id}/)`);
}

// Report
if (errors.length > 0) {
  console.error(`\n✗ ${errors.length} error(s) found:\n`);
  for (const err of errors) {
    console.error(`  - ${err}`);
  }
  process.exit(1);
} else {
  console.log(`\n✓ All ${retailerDirs.length} retailer(s) validated successfully.`);
}
