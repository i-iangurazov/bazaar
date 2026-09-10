import { addBusinessDays, businessDateKey } from "@/lib/timezone";
import { isValidAnalyticsReportScope } from "@/lib/analyticsReportLink";

export const salesViews = [
  "products",
  "categories",
  "stores",
  "staff",
  "customers",
  "days",
  "documents",
  "costGaps",
] as const;
export const operationViews = [
  "receipts",
  "suppliers",
  "payments",
  "cash",
  "debts",
  "movements",
  "stock",
  "stockouts",
  "slowMovers",
  "writeOffs",
] as const;
export type SalesView = (typeof salesViews)[number];
export type OperationView = (typeof operationViews)[number];
export function reportError(
  t: { (key: string): string; has: (key: string) => boolean },
  error: unknown,
) {
  return error instanceof Error && t.has(error.message) ? t(error.message) : t("genericMessage");
}
const keys = new Set([
  "dateFrom",
  "dateTo",
  "storeId",
  "channel",
  "view",
  "registerId",
  "cashierId",
  "category",
  "search",
  "productId",
  "variantKey",
  "customerKey",
  "documentId",
  "kind",
  "sort",
  "direction",
  "page",
]);
const optional = (params: URLSearchParams, key: string) => params.get(key) || undefined;

export function reportUrlState(query: string, mode: "sales" | "hub", now = new Date()) {
  const params = new URLSearchParams(query);
  const today = businessDateKey(now);
  const dateFrom = params.has("dateFrom") ? params.get("dateFrom")! : addBusinessDays(today, -29);
  const dateTo = params.has("dateTo") ? params.get("dateTo")! : today;
  const storeId = optional(params, "storeId");
  let valid = isValidAnalyticsReportScope({ dateFrom, dateTo, storeId });
  params.forEach((value, key) => {
    if (!keys.has(key) || params.getAll(key).length !== 1 || !value || value.length > 300)
      valid = false;
  });
  if (query && (!params.has("dateFrom") || !params.has("dateTo"))) valid = false;
  // Existing BAAM links certify POS figures. Explicit new links choose their channel.
  const channel = optional(params, "channel") ?? (mode === "sales" && query ? "pos" : "all");
  const view = optional(params, "view") ?? (mode === "sales" ? "products" : "overview");
  const sort = optional(params, "sort") ?? (mode === "sales" ? "revenue" : "date");
  const direction = optional(params, "direction") ?? "desc";
  const kind = optional(params, "kind");
  const page = Number(optional(params, "page") ?? 1);
  if (
    !["all", "pos", "orders"].includes(channel) ||
    !["asc", "desc"].includes(direction) ||
    !(mode === "sales" ? salesViews : ["overview", ...operationViews]).includes(view as never) ||
    !(
      mode === "sales"
        ? ["revenue", "profit", "cost", "returns", "name", "date"]
        : ["date", "amount", "name"]
    ).includes(sort) ||
    (kind !== undefined && !["sale", "return"].includes(kind)) ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > 1_000_000
  )
    valid = false;
  return {
    valid,
    dateFrom,
    dateTo,
    storeId,
    channel: channel as "all" | "pos" | "orders",
    view,
    sort,
    direction: direction as "asc" | "desc",
    page,
    registerId: optional(params, "registerId"),
    cashierId: optional(params, "cashierId"),
    category: optional(params, "category"),
    search: optional(params, "search"),
    productId: optional(params, "productId"),
    variantKey: optional(params, "variantKey"),
    customerKey: optional(params, "customerKey"),
    documentId: optional(params, "documentId"),
    kind: kind as "sale" | "return" | undefined,
  };
}

export function reportHref(
  path: string,
  values: Record<string, string | number | undefined | null>,
) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null) params.set(key, String(value));
  });
  return `${path}?${params.toString()}`;
}
