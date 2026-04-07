import { afterEach, describe, expect, it } from "vitest";

import {
  getPerfProfileSnapshot,
  recordPrismaQueryTiming,
  recordSectionTiming,
  recordTrpcTiming,
  resetPerfProfile,
  summarizeHotProcedureInput,
} from "@/server/profiling/perf";

describe("perf profiling helpers", () => {
  const previousProfileFlag = process.env.BAZAAR_PROFILE;

  afterEach(() => {
    process.env.BAZAAR_PROFILE = previousProfileFlag;
    resetPerfProfile();
  });

  it("summarizes hot procedure inputs for profiling logs", () => {
    const summary = summarizeHotProcedureInput("products.list", {
      search: "milk",
      category: "Dairy",
      page: 2,
      pageSize: 50,
      sortKey: "name",
      sortDirection: "asc",
      type: "product",
    });

    expect(summary).toEqual({
      searchLength: 4,
      hasCategory: true,
      hasStoreId: false,
      page: 2,
      pageSize: 50,
      sortKey: "name",
      sortDirection: "asc",
      type: "product",
    });
  });

  it("records grouped tRPC, section, and prisma timings when profiling is enabled", () => {
    process.env.BAZAAR_PROFILE = "1";
    resetPerfProfile();

    recordTrpcTiming({
      path: "products.list",
      type: "query",
      durationMs: 42,
      inputSummary: { pageSize: 25 },
      outputSummary: { items: 25 },
      status: "ok",
    });
    recordSectionTiming({
      scope: "products.list",
      section: "enrichmentReads",
      durationMs: 18,
      details: { productIds: 25 },
    });
    recordPrismaQueryTiming({
      query: 'SELECT "id" FROM "Product" WHERE "organizationId" = $1',
      durationMs: 9,
      target: "db",
    });

    const snapshot = getPerfProfileSnapshot();

    expect(snapshot.groupedTrpcTimings).toEqual([
      expect.objectContaining({
        key: "products.list",
        count: 1,
        avgMs: 42,
      }),
    ]);
    expect(snapshot.groupedSectionTimings).toEqual([
      expect.objectContaining({
        key: "products.list:enrichmentReads",
        count: 1,
        avgMs: 18,
      }),
    ]);
    expect(snapshot.groupedPrismaQueries).toEqual([
      expect.objectContaining({
        key: "SELECT Product",
        count: 1,
        avgMs: 9,
      }),
    ]);
  });
});
