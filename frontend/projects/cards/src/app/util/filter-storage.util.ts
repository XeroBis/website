export function loadStoredFilters<T>(isBrowser: boolean, key: string): Partial<T> | null {
  if (!isBrowser) {
    return null;
  }
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Partial<T>) : null;
  } catch {
    return null;
  }
}

export function saveStoredFilters(isBrowser: boolean, key: string, value: unknown): void {
  if (!isBrowser) {
    return;
  }
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage unavailable (e.g. private browsing quota) - ignore
  }
}

/** Normalizes a persisted multi-select filter value (supertype/rarity/
 * variantType) to a `string[]` -- an empty array means "no explicit
 * selection" (nothing filtered out). Also upgrades pre-existing localStorage
 * entries saved back when these filters were a single-select string ('' or
 * one value). */
export function normalizeMultiFilter(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value as string[];
  }
  if (typeof value === 'string' && value) {
    return [value];
  }
  return [];
}
