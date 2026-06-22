const internalOrigin = "https://bazaar.local";

const normalizeInternalPath = (value: string) => {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return null;
  }

  try {
    const url = new URL(value, internalOrigin);
    if (url.origin !== internalOrigin) {
      return null;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
};

export const resolveSafeReturnTo = (
  value: string | null | undefined,
  fallback = "/inventory/movements",
) => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return fallback;
  }

  const direct = normalizeInternalPath(trimmed);
  if (direct) {
    return direct;
  }

  try {
    const decoded = decodeURIComponent(trimmed);
    return normalizeInternalPath(decoded) ?? fallback;
  } catch {
    return fallback;
  }
};
