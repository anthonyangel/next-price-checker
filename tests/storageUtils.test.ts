import { getFromStorage, setToStorage } from '../src/storageUtils';

describe('getFromStorage', () => {
  it('returns stored value for a given key', async () => {
    await chrome.storage.local.set({ testKey: 'testValue' });
    const result = await getFromStorage<string>('testKey');
    expect(result).toBe('testValue');
  });

  it('returns undefined when key does not exist', async () => {
    const result = await getFromStorage<string>('nonexistent');
    expect(result).toBeUndefined();
  });
});

describe('setToStorage', () => {
  it('stores a value retrievable by getFromStorage', async () => {
    await setToStorage('myKey', { data: 123 });
    const result = await getFromStorage<{ data: number }>('myKey');
    expect(result).toEqual({ data: 123 });
  });
});
