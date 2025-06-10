// Centralized Chrome storage utilities for Next Price Checker
// ----------------------------------------------------------

/**
 * Gets a value from chrome.storage.local by key.
 * @param key The storage key
 * @returns The value, or undefined if not found
 */
export async function getFromStorage<T>(key: string): Promise<T | undefined> {
  const data = await chrome.storage.local.get(key);
  return data[key] as T | undefined;
}

/**
 * Sets a value in chrome.storage.local by key.
 * @param key The storage key
 * @param value The value to store
 */
export async function setToStorage<T>(key: string, value: T): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}
