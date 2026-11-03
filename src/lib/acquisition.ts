// Campaign labels only: never store arbitrary URLs, click IDs, email or phone.
export const acquisitionCookieName = "bazaar_acquisition";
export const acquisitionMaxAge = 30 * 24 * 60 * 60;
export const campaignKeys = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;
export type Acquisition = Partial<Record<(typeof campaignKeys)[number], string>> & {
  capturedAt: string;
};

export function acquisitionFromSearch(
  search: URLSearchParams,
  now = new Date(),
): Acquisition | undefined {
  const result: Partial<Record<(typeof campaignKeys)[number], string>> = {};
  for (const key of campaignKeys) {
    const value = search.get(key);
    if (value && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value)) result[key] = value.toLowerCase();
  }
  if (!result.utm_source || !result.utm_medium || !result.utm_campaign) return undefined;
  return { ...result, capturedAt: now.toISOString() };
}

export function parseAcquisition(value?: string, now = new Date()): Acquisition | undefined {
  if (!value || value.length > 1200) return undefined;
  try {
    const input = JSON.parse(value);
    if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
    const capturedAt = new Date(input.capturedAt);
    const age = now.getTime() - capturedAt.getTime();
    if (!Number.isFinite(age) || age < 0 || age >= acquisitionMaxAge * 1000) return undefined;
    const search = new URLSearchParams();
    for (const key of campaignKeys) if (typeof input[key] === "string") search.set(key, input[key]);
    return acquisitionFromSearch(search, capturedAt);
  } catch {
    return undefined;
  }
}
