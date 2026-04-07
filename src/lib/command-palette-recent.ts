const maxRecentSearches = 8;

const normalizeRecentSearch = (value: string) => value.trim();

export const parseRecentCommandPaletteSearches = (raw: string): string[] => {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const seen = new Set<string>();
    return parsed
      .filter((value): value is string => typeof value === "string")
      .map(normalizeRecentSearch)
      .filter((value) => {
        if (!value || seen.has(value)) {
          return false;
        }
        seen.add(value);
        return true;
      })
      .slice(0, maxRecentSearches);
  } catch {
    return [];
  }
};

export const addRecentCommandPaletteSearch = (
  currentSearches: string[],
  nextSearch: string,
): string[] => {
  const normalized = normalizeRecentSearch(nextSearch);
  if (!normalized) {
    return currentSearches;
  }

  return [
    normalized,
    ...currentSearches.filter((value) => value !== normalized),
  ].slice(0, maxRecentSearches);
};
