import { processInBatches, SimpleCache } from '../src/batchUtils';

describe('processInBatches', () => {
  it('processes all items in a single batch when count <= batchSize', async () => {
    const items = [1, 2, 3];
    const batches: { batch: number[]; offset: number }[] = [];
    await processInBatches(items, 5, (batch, offset) => {
      batches.push({ batch, offset });
    });
    expect(batches).toHaveLength(1);
    expect(batches[0].batch).toEqual([1, 2, 3]);
    expect(batches[0].offset).toBe(0);
  });

  it('processes items in correct batch sizes with correct offsets', async () => {
    const items = [1, 2, 3, 4, 5];
    const batches: { batch: number[]; offset: number }[] = [];
    await processInBatches(items, 2, (batch, offset) => {
      batches.push({ batch, offset });
    });
    expect(batches).toHaveLength(3);
    expect(batches[0]).toEqual({ batch: [1, 2], offset: 0 });
    expect(batches[1]).toEqual({ batch: [3, 4], offset: 2 });
    expect(batches[2]).toEqual({ batch: [5], offset: 4 });
  });

  it('does not call callback for empty array', async () => {
    const callback = vi.fn();
    await processInBatches([], 5, callback);
    expect(callback).not.toHaveBeenCalled();
  });

  it('awaits async callbacks', async () => {
    const order: number[] = [];
    await processInBatches([1, 2], 1, async (_batch, offset) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push(offset);
    });
    expect(order).toEqual([0, 1]);
  });
});

describe('SimpleCache', () => {
  it('returns undefined for unset keys', () => {
    const cache = new SimpleCache<string>();
    expect(cache.get('missing')).toBeUndefined();
  });

  it('stores and retrieves a value', () => {
    const cache = new SimpleCache<number>();
    cache.set('key', 42);
    expect(cache.get('key')).toBe(42);
  });

  it('overwrites existing values', () => {
    const cache = new SimpleCache<string>();
    cache.set('key', 'first');
    cache.set('key', 'second');
    expect(cache.get('key')).toBe('second');
  });

  it('handles multiple independent keys', () => {
    const cache = new SimpleCache<number>();
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBe(2);
  });
});
