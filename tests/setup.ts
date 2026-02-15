import { vi, beforeEach } from 'vitest';

const storage = new Map<string, unknown>();

function getMock(keys?: string | string[] | Record<string, unknown>) {
  if (typeof keys === 'string') {
    return Promise.resolve({ [keys]: storage.get(keys) });
  }
  if (Array.isArray(keys)) {
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      result[key] = storage.get(key);
    }
    return Promise.resolve(result);
  }
  return Promise.resolve({});
}

function setMock(items: Record<string, unknown>) {
  for (const [k, v] of Object.entries(items)) {
    storage.set(k, v);
  }
  return Promise.resolve();
}

function removeMock(keys: string | string[]) {
  const k = Array.isArray(keys) ? keys : [keys];
  for (const key of k) {
    storage.delete(key);
  }
  return Promise.resolve();
}

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn(getMock),
      set: vi.fn(setMock),
      remove: vi.fn(removeMock),
    },
  },
});

beforeEach(() => {
  storage.clear();
  vi.mocked(chrome.storage.local.get).mockImplementation(getMock as typeof chrome.storage.local.get);
  vi.mocked(chrome.storage.local.set).mockImplementation(setMock as typeof chrome.storage.local.set);
  vi.mocked(chrome.storage.local.remove).mockImplementation(removeMock as typeof chrome.storage.local.remove);
});
