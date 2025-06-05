export function parsePrice(raw: string | null): number | null {
    if (!raw) return null;
    const parsed = parseFloat(raw.replace(/[^\d.]/g, ''));
    return isNaN(parsed) ? null : parsed;
  }
  