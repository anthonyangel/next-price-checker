// Logger utility for Next Price Checker
// -------------------------------------

const DEBUG = false; // Set to true for verbose logging

export function log(...args: unknown[]) {
  if (DEBUG) console.log('[NPC]', ...args);
}

export function warn(...args: unknown[]) {
  if (DEBUG) console.warn('[NPC]', ...args);
}

export function error(...args: unknown[]) {
  if (DEBUG) console.error('[NPC]', ...args);
}
