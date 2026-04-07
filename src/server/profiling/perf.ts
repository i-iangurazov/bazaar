import type { Logger } from "pino";

import { isProductionRuntime } from "@/server/config/runtime";

type TrpcTimingRecord = {
  path: string;
  type: string;
  durationMs: number;
  inputSummary: Record<string, unknown> | null;
  outputSummary: Record<string, unknown> | null;
  status: "ok" | "error";
  recordedAt: number;
};

type SectionTimingRecord = {
  scope: string;
  section: string;
  durationMs: number;
  details: Record<string, unknown> | null;
  recordedAt: number;
};

type PrismaQueryTimingRecord = {
  fingerprint: string;
  operation: string;
  model: string | null;
  durationMs: number;
  target: string | null;
  recordedAt: number;
};

type PerfProfileState = {
  trpcTimings: TrpcTimingRecord[];
  sectionTimings: SectionTimingRecord[];
  prismaQueries: PrismaQueryTimingRecord[];
};

type GlobalWithPerfProfile = typeof globalThis & {
  __bazaarPerfProfileState?: PerfProfileState;
};

const globalWithPerfProfile = globalThis as GlobalWithPerfProfile;

const HOT_TRPC_PATHS = new Set([
  "dashboard.summary",
  "dashboard.bootstrap",
  "dashboard.activity",
  "products.bootstrap",
  "products.list",
  "inventory.list",
  "search.global",
  "products.previewImportCsv",
]);

const RUNTIME_OBSERVED_TRPC_PATHS = new Set([
  "dashboard.bootstrap",
  "dashboard.activity",
  "products.bootstrap",
  "search.global",
]);

const RUNTIME_OBSERVED_SECTION_SCOPES = new Set([
  "dashboard.bootstrap",
  "dashboard.activity",
  "dashboard.summary",
  "products.bootstrap",
  "search.global",
]);

const MAX_PROFILE_RECORDS = 300;

const createPerfProfileState = (): PerfProfileState => ({
  trpcTimings: [],
  sectionTimings: [],
  prismaQueries: [],
});

const getPerfProfileState = () => {
  if (!globalWithPerfProfile.__bazaarPerfProfileState) {
    globalWithPerfProfile.__bazaarPerfProfileState = createPerfProfileState();
  }
  return globalWithPerfProfile.__bazaarPerfProfileState;
};

const trimRecords = <T>(records: T[]) => {
  if (records.length <= MAX_PROFILE_RECORDS) {
    return records;
  }
  return records.slice(records.length - MAX_PROFILE_RECORDS);
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const summarizeArray = (value: unknown[]) => ({
  count: value.length,
});

const summarizeValue = (value: unknown): Record<string, unknown> | null => {
  if (Array.isArray(value)) {
    return summarizeArray(value);
  }
  if (!isPlainRecord(value)) {
    return null;
  }

  if (Array.isArray(value.items)) {
    return {
      items: value.items.length,
      total: typeof value.total === "number" ? value.total : undefined,
      page: typeof value.page === "number" ? value.page : undefined,
      pageSize: typeof value.pageSize === "number" ? value.pageSize : undefined,
    };
  }
  if (Array.isArray(value.results)) {
    return { results: value.results.length };
  }
  if (Array.isArray(value.rows) && isPlainRecord(value.summary)) {
    return {
      rows: value.rows.length,
      ...value.summary,
    };
  }
  if (Array.isArray(value.stores) && "selectedStoreId" in value && "summary" in value) {
    return {
      stores: value.stores.length,
      selectedStoreId: typeof value.selectedStoreId === "string" ? "selected" : null,
      lowStock: Array.isArray((value.summary as Record<string, unknown>)?.lowStock)
        ? ((value.summary as Record<string, unknown>).lowStock as unknown[]).length
        : undefined,
    };
  }
  if (Array.isArray(value.stores) && Array.isArray(value.categories) && isPlainRecord(value.list)) {
    return {
      stores: value.stores.length,
      categories: value.categories.length,
      selectedStoreId: typeof value.selectedStoreId === "string" ? "selected" : null,
      items: Array.isArray((value.list as Record<string, unknown>).items)
        ? ((value.list as Record<string, unknown>).items as unknown[]).length
        : undefined,
      total:
        typeof (value.list as Record<string, unknown>).total === "number"
          ? ((value.list as Record<string, unknown>).total as number)
          : undefined,
    };
  }
  if (Array.isArray(value.lowStock) || Array.isArray(value.recentActivity)) {
    return {
      lowStock: Array.isArray(value.lowStock) ? value.lowStock.length : undefined,
      recentActivity: Array.isArray(value.recentActivity) ? value.recentActivity.length : undefined,
      pendingPurchaseOrders: Array.isArray(value.pendingPurchaseOrders)
        ? value.pendingPurchaseOrders.length
        : undefined,
    };
  }
  return null;
};

export const isPerfProfilingEnabled = () =>
  (process.env.BAZAAR_PROFILE === "1" || process.env.BAZAAR_PROFILE === "true") &&
  process.env.NODE_ENV !== "production";

export const isPrismaQueryProfilingEnabled = () => isPerfProfilingEnabled();

export const isHotTrpcPath = (path: string) => HOT_TRPC_PATHS.has(path);

export const summarizeHotProcedureInput = (path: string, input: unknown) => {
  if (!isPlainRecord(input)) {
    return null;
  }

  switch (path) {
    case "dashboard.summary":
    case "dashboard.bootstrap":
    case "dashboard.activity":
      return {
        hasStoreId: typeof input.storeId === "string" && input.storeId.length > 0,
        includeRecentActivity:
          typeof input.includeRecentActivity === "boolean" ? input.includeRecentActivity : undefined,
        includeRecentMovements:
          typeof input.includeRecentMovements === "boolean"
            ? input.includeRecentMovements
            : undefined,
      };
    case "products.bootstrap":
    case "products.list":
      return {
        searchLength: typeof input.search === "string" ? input.search.length : 0,
        hasCategory: typeof input.category === "string" && input.category.length > 0,
        hasStoreId: typeof input.storeId === "string" && input.storeId.length > 0,
        page: typeof input.page === "number" ? input.page : 1,
        pageSize: typeof input.pageSize === "number" ? input.pageSize : 25,
        sortKey: typeof input.sortKey === "string" ? input.sortKey : "name",
        sortDirection: typeof input.sortDirection === "string" ? input.sortDirection : "asc",
        type: typeof input.type === "string" ? input.type : "all",
      };
    case "inventory.list":
      return {
        searchLength: typeof input.search === "string" ? input.search.length : 0,
        page: typeof input.page === "number" ? input.page : 1,
        pageSize: typeof input.pageSize === "number" ? input.pageSize : 25,
        hasStoreId: typeof input.storeId === "string" && input.storeId.length > 0,
      };
    case "search.global":
      return {
        queryLength: typeof input.q === "string" ? input.q.length : 0,
      };
    case "products.previewImportCsv":
      return {
        rows: Array.isArray(input.rows) ? input.rows.length : 0,
        hasStoreId: typeof input.storeId === "string" && input.storeId.length > 0,
        mode: typeof input.mode === "string" ? input.mode : "full",
        updateMaskCount: Array.isArray(input.updateMask) ? input.updateMask.length : 0,
      };
    default:
      return null;
  }
};

const normalizeQueryText = (query: string) => query.replace(/\s+/g, " ").trim();

const buildQueryFingerprint = (query: string) => {
  const normalized = normalizeQueryText(query);
  const operationMatch = normalized.match(/^([A-Z]+)/);
  const operation = operationMatch?.[1] ?? "QUERY";
  const modelMatch = normalized.match(
    /\b(?:FROM|INTO|UPDATE)\s+(?:"?[A-Za-z_][\w$]*"?\.)?"?([A-Za-z_][\w$]*)"?/i,
  );
  const model = modelMatch?.[1] ?? null;
  return {
    operation,
    model,
    fingerprint: model ? `${operation} ${model}` : normalized.slice(0, 120),
  };
};

const parseThreshold = (raw: string | undefined, fallback: number) => {
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const getRuntimeHotPathThresholdMs = () =>
  parseThreshold(process.env.HOT_PATH_LOG_THRESHOLD_MS, 250);

export const shouldLogRuntimeHotPathTiming = ({
  path,
  durationMs,
}: {
  path: string;
  durationMs: number;
}) =>
  isProductionRuntime() &&
  RUNTIME_OBSERVED_TRPC_PATHS.has(path) &&
  durationMs >= getRuntimeHotPathThresholdMs();

export const shouldElevateRuntimeSectionLog = (scope: string) =>
  isProductionRuntime() && RUNTIME_OBSERVED_SECTION_SCOPES.has(scope);

const groupRecords = <T extends { durationMs: number }>(
  records: T[],
  getKey: (record: T) => string,
) => {
  const grouped = new Map<
    string,
    {
      count: number;
      totalMs: number;
      maxMs: number;
      avgMs: number;
    }
  >();

  records.forEach((record) => {
    const key = getKey(record);
    const current = grouped.get(key) ?? {
      count: 0,
      totalMs: 0,
      maxMs: 0,
      avgMs: 0,
    };
    current.count += 1;
    current.totalMs += record.durationMs;
    current.maxMs = Math.max(current.maxMs, record.durationMs);
    current.avgMs = current.totalMs / current.count;
    grouped.set(key, current);
  });

  return Array.from(grouped.entries())
    .map(([key, value]) => ({
      key,
      ...value,
    }))
    .sort((left, right) => right.totalMs - left.totalMs);
};

export const resetPerfProfile = () => {
  globalWithPerfProfile.__bazaarPerfProfileState = createPerfProfileState();
};

export const recordTrpcTiming = ({
  path,
  type,
  durationMs,
  inputSummary,
  outputSummary,
  status,
}: Omit<TrpcTimingRecord, "recordedAt">) => {
  if (!isPerfProfilingEnabled() || !isHotTrpcPath(path)) {
    return;
  }
  const state = getPerfProfileState();
  state.trpcTimings = trimRecords([
    ...state.trpcTimings,
    {
      path,
      type,
      durationMs,
      inputSummary,
      outputSummary,
      status,
      recordedAt: Date.now(),
    },
  ]);
};

export const recordSectionTiming = ({
  scope,
  section,
  durationMs,
  details,
}: Omit<SectionTimingRecord, "recordedAt">) => {
  if (!isPerfProfilingEnabled()) {
    return;
  }
  const state = getPerfProfileState();
  state.sectionTimings = trimRecords([
    ...state.sectionTimings,
    {
      scope,
      section,
      durationMs,
      details,
      recordedAt: Date.now(),
    },
  ]);
};

export const recordPrismaQueryTiming = ({
  query,
  durationMs,
  target,
}: {
  query: string;
  durationMs: number;
  target?: string | null;
}) => {
  if (!isPrismaQueryProfilingEnabled()) {
    return;
  }
  const state = getPerfProfileState();
  const { fingerprint, model, operation } = buildQueryFingerprint(query);
  state.prismaQueries = trimRecords([
    ...state.prismaQueries,
    {
      fingerprint,
      operation,
      model,
      durationMs,
      target: target ?? null,
      recordedAt: Date.now(),
    },
  ]);
};

export const logProfileSection = ({
  logger,
  scope,
  section,
  startedAt,
  details,
  slowThresholdMs = 150,
}: {
  logger: Logger;
  scope: string;
  section: string;
  startedAt: number;
  details?: Record<string, unknown>;
  slowThresholdMs?: number;
}) => {
  const durationMs = Date.now() - startedAt;
  recordSectionTiming({
    scope,
    section,
    durationMs,
    details: details ?? null,
  });
  if (isPerfProfilingEnabled()) {
    logger.info({ scope, section, durationMs, ...details }, "profile section timing");
    return;
  }
  if (durationMs >= slowThresholdMs) {
    const logPayload = { scope, section, durationMs, ...details };
    if (shouldElevateRuntimeSectionLog(scope)) {
      logger.warn(logPayload, "slow section timing");
    } else {
      logger.info(logPayload, "slow section timing");
    }
  }
};

export const logRuntimeHotPathTiming = ({
  logger,
  path,
  type,
  durationMs,
  status,
  inputSummary,
  outputSummary,
}: {
  logger: Logger;
  path: string;
  type: string;
  durationMs: number;
  status: "ok" | "error";
  inputSummary: Record<string, unknown> | null;
  outputSummary: Record<string, unknown> | null;
}) => {
  if (!shouldLogRuntimeHotPathTiming({ path, durationMs })) {
    return;
  }

  logger.warn(
    {
      path,
      type,
      durationMs,
      status,
      inputSummary,
      outputSummary,
    },
    "slow hot path timing",
  );
};

export const getPerfProfileSnapshot = () => {
  const state = getPerfProfileState();
  return {
    trpcTimings: [...state.trpcTimings],
    sectionTimings: [...state.sectionTimings],
    prismaQueries: [...state.prismaQueries],
    groupedTrpcTimings: groupRecords(state.trpcTimings, (record) => record.path),
    groupedSectionTimings: groupRecords(
      state.sectionTimings,
      (record) => `${record.scope}:${record.section}`,
    ),
    groupedPrismaQueries: groupRecords(state.prismaQueries, (record) => record.fingerprint),
  };
};

export const summarizeHotProcedureOutput = (value: unknown) => summarizeValue(value);
