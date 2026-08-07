export const historyPageSizeOptions = [10, 25, 50, 100] as const;

export type StockCountHistoryStatus = "ALL" | "DRAFT" | "IN_PROGRESS" | "APPLIED" | "CANCELLED";

const stockCountStatuses = new Set<StockCountHistoryStatus>([
  "ALL",
  "DRAFT",
  "IN_PROGRESS",
  "APPLIED",
  "CANCELLED",
]);

const parsePositiveInteger = (value: string | null, fallback: number) => {
  if (!value || !/^\d+$/.test(value)) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const readHistoryPagination = (params: Pick<URLSearchParams, "get">) => {
  const page = parsePositiveInteger(params.get("page"), 1);
  const requestedPageSize = parsePositiveInteger(params.get("pageSize"), 25);
  const pageSize = historyPageSizeOptions.includes(
    requestedPageSize as (typeof historyPageSizeOptions)[number],
  )
    ? requestedPageSize
    : 25;
  return { page, pageSize };
};

export const readStockCountHistoryRouteState = (params: Pick<URLSearchParams, "get">) => {
  const rawStatus = params.get("status") as StockCountHistoryStatus | null;
  return {
    ...readHistoryPagination(params),
    storeId: params.get("storeId")?.trim() ?? "",
    status: rawStatus && stockCountStatuses.has(rawStatus) ? rawStatus : "ALL",
  };
};

export const writeHistoryPagination = (
  currentQuery: string,
  input: { page: number; pageSize: number },
) => {
  const params = new URLSearchParams(currentQuery);
  params.set("page", String(input.page));
  params.set("pageSize", String(input.pageSize));
  return params.toString();
};

export const writeStockCountHistoryRouteState = (
  currentQuery: string,
  input: {
    page: number;
    pageSize: number;
    storeId: string;
    status: StockCountHistoryStatus;
  },
) => {
  const params = new URLSearchParams(writeHistoryPagination(currentQuery, input));
  params.set("storeId", input.storeId);
  if (input.status === "ALL") {
    params.delete("status");
  } else {
    params.set("status", input.status);
  }
  return params.toString();
};
