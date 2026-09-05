import { describe, expect, it, vi } from "vitest";
import { getSalesTrend, getTopProducts } from "@/server/services/analytics";
import { withRecordedSalesProjection } from "../helpers/recordedSalesProjection";

vi.mock("@/server/redis", () => ({ getRedisPublisher: () => null }));

describe("legacy report consumers use recorded-sale projections", () => {
  it("keeps monetary sales distinct from units and excludes ungranted store projections", async () => {
    await withRecordedSalesProjection([
      { organizationId: "legacy-org", storeId: "allowed", productId: "a", sku: "A", name: "Allowed", qty: 3, revenueKgs: 90, costKgs: 30 },
      { organizationId: "legacy-org", storeId: "denied", productId: "b", sku: "B", name: "Denied", qty: 999, revenueKgs: 9999, costKgs: 1 },
      { organizationId: "foreign-org", storeId: "allowed", productId: "c", sku: "C", name: "Foreign", qty: 888, revenueKgs: 8888, costKgs: 1 },
    ], async () => {
      const scope = { organizationId: "legacy-org", storeIds: ["allowed"], rangeDays: 30 };
      const sales = await getSalesTrend({ ...scope, granularity: "day" });
      expect(sales.series.map(point => point.salesKgs)).toEqual([90]);
      expect(sales.usesFallback).toBe(false);
      expect((await getTopProducts({ ...scope, metric: "units" })).items).toEqual([{ sku: "A", name: "Allowed", value: 3 }]);
      expect((await getTopProducts({ ...scope, metric: "profit" })).items).toEqual([{ sku: "A", name: "Allowed", value: 60 }]);
    });
  });
});
