/**
 * Generic Bloomreach Discovery API client.
 *
 * Bloomreach (core.dxpapi.com) is a product search/discovery API used by
 * multiple retailers. This module provides config-driven price lookups —
 * each retailer supplies its own credentials via BloomreachRegionConfig.
 *
 * If the supplied credentials fail (key rotation), the client automatically
 * scrapes fresh keys from the retailer's homepage.
 */

import { log, warn } from '../logger';

export interface BloomreachRegionConfig {
  accountId: string;
  authKey: string;
  domainKey: string;
  siteUrl: string;
}

const API_BASE = 'https://core.dxpapi.com/api/v1/core/';

/** Scraped configs override supplied ones after a successful refresh. */
const refreshedConfigs = new Map<string, BloomreachRegionConfig>();

/**
 * Look up a single product price via the Bloomreach API.
 * Only retries with scraped credentials when the API itself fails (not when
 * the product simply isn't found in the catalog).
 */
export async function lookupPrice(
  pid: string,
  config: BloomreachRegionConfig
): Promise<number | null> {
  const effective = refreshedConfigs.get(config.siteUrl) ?? config;
  const result = await queryApi(pid, effective);
  if (result.price !== null) return result.price;

  // Only scrape fresh credentials if the API call itself failed
  if (result.apiOk) return null;

  log(`[bloomreach] API error for pid=${pid}, trying key refresh`);
  const freshConfig = await scrapeConfigFromHomepage(config.siteUrl);
  if (!freshConfig) return null;

  refreshedConfigs.set(config.siteUrl, freshConfig);
  const retry = await queryApi(pid, freshConfig);
  return retry.price;
}

interface QueryResult {
  price: number | null;
  /** Whether the API responded successfully (product may still not be found). */
  apiOk: boolean;
}

/** Core API query — returns price and whether the API responded. */
async function queryApi(
  pid: string,
  config: BloomreachRegionConfig
): Promise<QueryResult> {
  const params = new URLSearchParams({
    account_id: config.accountId,
    auth_key: config.authKey,
    domain_key: config.domainKey,
    request_type: 'search',
    search_type: 'keyword',
    url: config.siteUrl,
    q: pid,
    rows: '1',
    fl: 'pid,price,sale_price',
  });

  try {
    const res = await fetch(`${API_BASE}?${params}`);
    if (!res.ok) {
      warn(`[bloomreach] API returned ${res.status} for pid=${pid}`);
      return { price: null, apiOk: false };
    }
    const data = await res.json();
    const doc = data?.response?.docs?.[0];
    if (!doc || String(doc.pid).toLowerCase() !== String(pid).toLowerCase()) {
      log(`[bloomreach] No exact PID match for pid=${pid}`);
      return { price: null, apiOk: true };
    }
    const price = doc.sale_price ?? doc.price ?? null;
    log(`[bloomreach] pid=${pid} → price=${price}`);
    return { price: typeof price === 'number' ? price : null, apiOk: true };
  } catch (err) {
    warn(`[bloomreach] API error for pid=${pid}:`, err);
    return { price: null, apiOk: false };
  }
}

/**
 * Scrape Bloomreach API credentials from a retailer's homepage HTML.
 * The homepage typically contains the Bloomreach SDK config in a <script> block.
 */
async function scrapeConfigFromHomepage(
  siteUrl: string
): Promise<BloomreachRegionConfig | null> {
  try {
    const res = await fetch(siteUrl, { credentials: 'omit' });
    if (!res.ok) return null;
    const html = await res.text();

    const accountId = html.match(/account_id\s*[:=]\s*['"]?(\d+)/)?.[1];
    const authKey = html.match(/auth_key\s*[:=]\s*['"]([a-z0-9]+)['"]/)?.[1];
    const domainKey = html.match(/domain_key\s*[:=]\s*['"]([a-z0-9_]+)['"]/)?.[1];

    if (!accountId || !authKey || !domainKey) {
      warn('[bloomreach] Could not scrape config from homepage');
      return null;
    }

    const config: BloomreachRegionConfig = { accountId, authKey, domainKey, siteUrl };
    log(`[bloomreach] Scraped fresh config for ${siteUrl}: accountId=${accountId}`);
    return config;
  } catch (err) {
    warn('[bloomreach] Failed to scrape homepage:', err);
    return null;
  }
}
