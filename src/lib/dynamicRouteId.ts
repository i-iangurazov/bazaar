const dynamicRouteIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/**
 * Dynamic record IDs are opaque, but they must remain one safe URL segment.
 * This accepts current CUIDs, legacy UUIDs, and older alphanumeric IDs without
 * allowing whitespace, separators, control characters, or punctuation.
 */
export const normalizeDynamicRouteId = (value: unknown): string | null => {
  if (typeof value !== "string" || !dynamicRouteIdPattern.test(value)) {
    return null;
  }
  return value;
};
