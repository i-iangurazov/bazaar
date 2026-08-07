import { businessDateOnlyToUtc } from "@/lib/timezone";

type SearchParamReader = Pick<URLSearchParams, "get">;

export const readPosEnumParam = <T extends string>(
  params: SearchParamReader,
  key: string,
  values: readonly T[],
  fallback: T,
) => {
  const value = params.get(key);
  return value && values.includes(value as T) ? (value as T) : fallback;
};

export const readPosPageParam = (params: SearchParamReader, key: string, fallback = 1) => {
  const value = Number(params.get(key));
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

export const readPosDateParam = (params: SearchParamReader, key: string, fallback: string) => {
  const value = params.get(key);
  if (!value) return fallback;
  try {
    businessDateOnlyToUtc(value);
    return value;
  } catch {
    return fallback;
  }
};

export const buildPosFilterHref = (
  pathname: string,
  currentSearch: string,
  updates: Record<string, string | number | null | undefined>,
) => {
  const params = new URLSearchParams(currentSearch);
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === undefined || value === "") {
      params.delete(key);
    } else {
      params.set(key, String(value));
    }
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
};
