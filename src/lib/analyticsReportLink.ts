import { businessDateOnlyToUtc } from "@/lib/timezone";

export type AnalyticsReportScope = { dateFrom: string; dateTo: string; storeId?: string };
export type AnalyticsReportScopeResult =
  | { kind: "default" }
  | { kind: "valid"; scope: AnalyticsReportScope }
  | { kind: "invalid"; error: "invalidInput" };

const scopeKeys = new Set(["dateFrom", "dateTo", "storeId"]);
const dayMs = 24 * 60 * 60 * 1000;

/** The URL represents dates and one store, or explicitly all accessible stores when omitted. */
export const isValidAnalyticsReportScope = (scope: AnalyticsReportScope) => {
  try {
    const from = businessDateOnlyToUtc(scope.dateFrom).getTime();
    const to = businessDateOnlyToUtc(scope.dateTo).getTime();
    if (to < from || (to - from) / dayMs + 1 > 366) return false;
    return scope.storeId === undefined || (
      scope.storeId !== "all" && /^[A-Za-z0-9_-]{1,128}$/.test(scope.storeId)
    );
  } catch {
    return false;
  }
};

/** Reject partial scopes, repeated parameters and unknown keys instead of falling back to defaults. */
export const parseAnalyticsReportScope = (params: Pick<URLSearchParams, "get" | "getAll" | "forEach">): AnalyticsReportScopeResult => {
  let invalid = false;
  let count = 0;
  params.forEach((_value, key) => {
    count += 1;
    if (!scopeKeys.has(key) || params.getAll(key).length !== 1) invalid = true;
  });
  if (!count) return { kind: "default" };
  const dateFrom = params.get("dateFrom");
  const dateTo = params.get("dateTo");
  const rawStoreId = params.get("storeId");
  if (invalid || !dateFrom || !dateTo) return { kind: "invalid", error: "invalidInput" };
  const scope: AnalyticsReportScope = { dateFrom, dateTo, ...(rawStoreId !== null ? { storeId: rawStoreId } : {}) };
  return isValidAnalyticsReportScope(scope) ? { kind: "valid", scope } : { kind: "invalid", error: "invalidInput" };
};

/** Client and server share the same canonical link contract; authorization is checked by the report. */
export const buildAnalyticsReportHref = (scope: AnalyticsReportScope): string => {
  if (!isValidAnalyticsReportScope(scope)) throw new Error("invalidInput");
  const params = new URLSearchParams({ dateFrom: scope.dateFrom, dateTo: scope.dateTo });
  if (scope.storeId !== undefined) params.set("storeId", scope.storeId);
  return `/reports/analytics?${params.toString()}`;
};
