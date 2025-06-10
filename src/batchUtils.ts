// Batching and caching utilities for Next Price Checker
// -----------------------------------------------------

/**
 * Processes an array in batches, calling the callback for each batch.
 * @param items The array of items
 * @param batchSize The batch size
 * @param callback The function to call for each batch (receives batch, offset)
 */
export async function processInBatches<T>(
  items: T[],
  batchSize: number,
  callback: (batch: T[], offset: number) => Promise<void> | void
) {
  let offset = 0;
  while (offset < items.length) {
    const batch = items.slice(offset, offset + batchSize);
    await callback(batch, offset);
    offset += batchSize;
  }
}

/**
 * Simple in-memory cache utility (per session).
 */
export class SimpleCache<T> {
  private cache: Record<string, T> = {};
  get(key: string): T | undefined {
    return this.cache[key];
  }
  set(key: string, value: T) {
    this.cache[key] = value;
  }
}
