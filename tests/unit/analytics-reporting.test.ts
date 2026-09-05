import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  findStores: vi.fn(),
  findStore: vi.fn(),
  redisGet: vi.fn(),
  redisSet: vi.fn(),
}));

vi.mock("@/server/db/prisma", () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    store: { findMany: mocks.findStores, findUnique: mocks.findStore },
  },
}));
vi.mock("@/server/redis", () => ({
  getRedisPublisher: () => ({ get: mocks.redisGet, set: mocks.redisSet }),
}));

import { getSalesTrend, getTopProducts } from "@/server/services/analytics";

const scope = { organizationId: "report-org", storeIds: ["report-store"], rangeDays: 30 };
const bucket = new Date("2026-09-01T00:00:00.000Z");
const product = {
  productId: "product-a",
  sku: "SKU-A",
  name: "Recorded sale",
  units: 5,
  revenue: "450.50",
  profit: "125.25",
  canProfit: true,
};

describe("historical analytics reporting contract", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T12:00:00.000Z"));
    mocks.redisGet.mockResolvedValue(null);
    mocks.queryRaw.mockResolvedValue([]);
  });

  afterEach(() => vi.useRealTimers());

  it("returns recorded monetary totals rather than unit counts or today's price", async () => {
    mocks.queryRaw.mockResolvedValue([{ bucket, salesKgs: "450.50" }]);

    const result = await getSalesTrend({ ...scope, granularity: "day" });

    expect(result).toEqual({
      series: [{ date: bucket.toISOString(), salesKgs: 450.5 }],
      usesFallback: false,
    });
    const query = mocks.queryRaw.mock.calls[0][0];
    expect(query.sql).toContain('SUM(o."totalKgs")');
    expect(query.sql).toContain("o.status = 'COMPLETED'");
    expect(query.sql).toContain('o."completedAt"');
    expect(query.sql).not.toMatch(/StockMovement|StorePrice|ProductCost|qtyDelta/);
    expect(query.values).toContain(scope.organizationId);
    expect(query.values).toContain(scope.storeIds[0]);
  });

  it("keeps an empty monetary series empty instead of counting unrelated movements", async () => {
    expect(await getSalesTrend({ ...scope, granularity: "day" })).toEqual({
      series: [],
      usesFallback: false,
    });
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
  });

  it("parameterizes weekly buckets and bounds the completed-order reporting range", async () => {
    await getSalesTrend({ ...scope, granularity: "week" });
    expect(mocks.queryRaw.mock.calls[0][0].values).toEqual([
      "week",
      "report-org",
      new Date("2026-08-06T12:00:00.000Z"),
      new Date("2026-09-05T12:00:00.000Z"),
      "report-store",
    ]);
  });

  it("does not query or cache when the accessible-store set is empty", async () => {
    expect(await getSalesTrend({ ...scope, storeIds: [], granularity: "day" })).toEqual({
      series: [],
      usesFallback: false,
    });
    expect(await getTopProducts({ ...scope, storeIds: [], metric: "revenue" })).toEqual({
      items: [],
      canProfit: false,
    });
    expect(mocks.queryRaw).not.toHaveBeenCalled();
    expect(mocks.redisGet).not.toHaveBeenCalled();
  });

  it("uses resolved organization stores and rejects a store from another organization", async () => {
    mocks.findStores.mockResolvedValue([{ id: "store-a" }, { id: "store-b" }]);
    await getSalesTrend({ organizationId: "report-org", rangeDays: 30, granularity: "day" });
    expect(mocks.findStores).toHaveBeenCalledWith({
      where: { organizationId: "report-org" },
      select: { id: true },
    });
    expect(mocks.queryRaw.mock.calls[0][0].values.slice(-2)).toEqual(["store-a", "store-b"]);

    mocks.findStore.mockResolvedValue({ id: "foreign-store", organizationId: "foreign-org" });
    await expect(
      getTopProducts({
        organizationId: "report-org",
        storeId: "foreign-store",
        rangeDays: 30,
        metric: "revenue",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["units", 5],
    ["revenue", 450.5],
    ["profit", 125.25],
  ] as const)("ranks by %s before choosing the top ten", async (metric, expected) => {
    mocks.queryRaw.mockResolvedValue([product]);

    expect(await getTopProducts({ ...scope, metric })).toEqual({
      items: [{ sku: "SKU-A", name: "Recorded sale", value: expected }],
      canProfit: true,
    });
    const query = mocks.queryRaw.mock.calls[0][0];
    expect(query.sql).toContain(
      `ORDER BY ${metric} DESC NULLS LAST, sku ASC, "productId" ASC\n    LIMIT 10`,
    );
    expect(query.sql).toContain('SUM(l."lineTotalKgs")');
    expect(query.sql).toContain('COALESCE(l."lineCostTotalKgs", l."unitCostKgs" * l.qty)');
    expect(query.sql).not.toMatch(/StockMovement|StorePrice|ProductCost|basePriceKgs|avgCostKgs/);
    expect(query.values).toContain("report-org");
    expect(query.values).toContain("report-store");
  });

  it("does not publish a partial profit ranking when any scoped product lacks historical cost", async () => {
    // The returned product itself has cost; a product below the LIMIT lacks it.
    mocks.queryRaw.mockResolvedValue([{ ...product, canProfit: false }]);

    expect(await getTopProducts({ ...scope, metric: "profit" })).toEqual({
      items: [],
      canProfit: false,
    });
    expect(mocks.queryRaw.mock.calls[0][0].sql).toContain(
      'BOOL_AND("hasCost") OVER () AS "canProfit"',
    );
  });

  it("keeps revenue available when costs are missing and preserves recorded losses", async () => {
    mocks.queryRaw.mockResolvedValueOnce([{ ...product, canProfit: false, profit: null }]);
    expect(await getTopProducts({ ...scope, metric: "revenue" })).toEqual({
      items: [{ sku: "SKU-A", name: "Recorded sale", value: 450.5 }],
      canProfit: false,
    });
    mocks.queryRaw.mockResolvedValueOnce([{ ...product, profit: "-15.25" }]);
    expect((await getTopProducts({ ...scope, metric: "profit" })).items[0].value).toBe(-15.25);
  });

  it("bypasses legacy quantity/estimated-money caches and caches the corrected response", async () => {
    mocks.redisGet.mockImplementation(async (key: string) =>
      key.includes(":v2:")
        ? null
        : JSON.stringify({
            series: [{ date: bucket.toISOString(), salesKgs: 5 }],
            usesFallback: true,
          }),
    );
    mocks.queryRaw.mockResolvedValueOnce([{ bucket, salesKgs: "450.50" }]);

    const result = await getSalesTrend({ ...scope, granularity: "day" });
    expect(result.series[0].salesKgs).toBe(450.5);
    expect(mocks.redisGet).toHaveBeenCalledWith(
      "analytics:sales:v2:report-org:stores:report-store:30:day",
    );
    expect(mocks.redisSet).toHaveBeenCalledWith(
      "analytics:sales:v2:report-org:stores:report-store:30:day",
      JSON.stringify(result),
      "EX",
      180,
    );
    await getTopProducts({ ...scope, metric: "revenue" });
    expect(mocks.redisGet).toHaveBeenLastCalledWith(
      "analytics:top:v2:report-org:stores:report-store:30:revenue",
    );
  });
});
