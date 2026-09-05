import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { prisma } from "@/server/db/prisma";
import { getSalesTrend, getTopProducts } from "@/server/services/analytics";

vi.mock("@/server/redis", () => ({ getRedisPublisher: () => null }));

const scope = { organizationId: "reporting-fixture-org", storeIds: ["store-a"], rangeDays: 30 };
const completedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
completedAt.setUTCHours(12, 0, 0, 0);

// These are reporting projections on a disposable database, not operational
// fixtures. TEMP tables shadow domain tables only on this transaction's
// connection, and disappear on commit. No order/POS/stock workflow is invoked.
const withReportingTables = async (run: (tx: Prisma.TransactionClient) => Promise<void>) => {
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`
      CREATE TEMP TABLE "CustomerOrder" (
        id text PRIMARY KEY, "organizationId" text NOT NULL, "storeId" text NOT NULL,
        status text NOT NULL, "completedAt" timestamp, "createdAt" timestamp,
        "totalKgs" numeric(12,2) NOT NULL, "isPosSale" boolean NOT NULL DEFAULT false
      ) ON COMMIT DROP
    `;
      await tx.$executeRaw`
      CREATE TEMP TABLE "Product" (
        id text PRIMARY KEY, "organizationId" text NOT NULL,
        sku text NOT NULL, name text NOT NULL, "basePriceKgs" numeric(12,2)
      ) ON COMMIT DROP
    `;
      await tx.$executeRaw`
      CREATE TEMP TABLE "CustomerOrderLine" (
        id text PRIMARY KEY, "customerOrderId" text NOT NULL,
        "productId" text NOT NULL, qty integer NOT NULL,
        "lineTotalKgs" numeric(12,2) NOT NULL,
        "lineCostTotalKgs" numeric(12,2), "unitCostKgs" numeric(12,2)
      ) ON COMMIT DROP
    `;
      const queryTransaction = tx.$queryRaw.bind(tx);
      const query = vi
        .spyOn(prisma, "$queryRaw")
        .mockImplementation((statement) => queryTransaction(statement));
      try {
        await run(tx);
      } finally {
        query.mockRestore();
      }
    },
    { timeout: 20_000 },
  );
};

const order = async (
  tx: Prisma.TransactionClient,
  input: {
    id: string;
    total?: number;
    organizationId?: string;
    storeId?: string;
    status?: string;
    date?: Date | null;
  },
) => {
  await tx.$executeRaw`
    INSERT INTO "CustomerOrder" (id, "organizationId", "storeId", status, "completedAt", "createdAt", "totalKgs")
    VALUES (${input.id}, ${input.organizationId ?? scope.organizationId}, ${input.storeId ?? "store-a"},
      ${input.status ?? "COMPLETED"}, ${input.date === undefined ? completedAt : input.date},
      ${new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)}, ${input.total ?? 0})
  `;
};

const line = async (
  tx: Prisma.TransactionClient,
  input: {
    id: string;
    orderId: string;
    productId: string;
    qty: number;
    revenue: number;
    cost?: number | null;
    unitCost?: number | null;
  },
) => {
  await tx.$executeRaw`
    INSERT INTO "CustomerOrderLine" (id, "customerOrderId", "productId", qty, "lineTotalKgs", "lineCostTotalKgs", "unitCostKgs")
    VALUES (${input.id}, ${input.orderId}, ${input.productId}, ${input.qty}, ${input.revenue},
      ${input.cost ?? null}, ${input.unitCost ?? null})
  `;
};

const product = async (tx: Prisma.TransactionClient, id: string, sku = id) => {
  await tx.$executeRaw`
    INSERT INTO "Product" (id, "organizationId", sku, name, "basePriceKgs")
    VALUES (${id}, ${scope.organizationId}, ${sku}, ${id}, 99999)
  `;
};

describe("analytics reporting SQL on isolated temporary projections", () => {
  it("sums recorded completed-order money by completion day/week, with strict organization/store/date scope", async () => {
    await withReportingTables(async (tx) => {
      await order(tx, { id: "recorded-discounted", total: 450.5 });
      await order(tx, { id: "second", total: 100.25 });
      await order(tx, { id: "other-store", total: 9000, storeId: "store-b" });
      await order(tx, { id: "other-org", total: 8000, organizationId: "foreign-org" });
      await order(tx, { id: "draft", total: 7000, status: "DRAFT" });
      await order(tx, { id: "canceled", total: 6000, status: "CANCELED" });
      await order(tx, { id: "undated", total: 5000, date: null });
      await order(tx, { id: "old", total: 4000, date: new Date(Date.now() - 60 * 86400000) });
      await order(tx, { id: "future", total: 3000, date: new Date(Date.now() + 60 * 86400000) });

      const day = new Date(completedAt);
      day.setUTCHours(0, 0, 0, 0);
      expect(await getSalesTrend({ ...scope, granularity: "day" })).toEqual({
        series: [{ date: day.toISOString(), salesKgs: 550.75 }],
        usesFallback: false,
      });
      const week = new Date(day);
      week.setUTCDate(week.getUTCDate() - ((week.getUTCDay() + 6) % 7));
      expect(await getSalesTrend({ ...scope, granularity: "week" })).toEqual({
        series: [{ date: week.toISOString(), salesKgs: 550.75 }],
        usesFallback: false,
      });
      expect(
        await getSalesTrend({ ...scope, storeIds: ["empty-store"], granularity: "day" }),
      ).toEqual({
        series: [],
        usesFallback: false,
      });
    });
  });

  it("selects the actual top ten for each metric rather than re-sorting a units-limited subset", async () => {
    await withReportingTables(async (tx) => {
      await order(tx, { id: "sales" });
      for (let index = 0; index < 11; index += 1) {
        const id = `bulk-${String(index).padStart(2, "0")}`;
        await product(tx, id);
        await line(tx, {
          id,
          orderId: "sales",
          productId: id,
          qty: 100 - index,
          revenue: 100 - index,
          cost: 90 - index,
        });
      }
      await product(tx, "valuable");
      await line(tx, {
        id: "valuable",
        orderId: "sales",
        productId: "valuable",
        qty: 1,
        revenue: 1000.5,
        cost: 0,
      });

      const units = await getTopProducts({ ...scope, metric: "units" });
      expect(units.items).toHaveLength(10);
      expect(units.items.map((item) => item.sku)).not.toContain("valuable");
      expect(units.items[0].value).toBe(100);
      const revenue = await getTopProducts({ ...scope, metric: "revenue" });
      expect(revenue.items).toHaveLength(10);
      expect(revenue.items[0]).toEqual({ sku: "valuable", name: "valuable", value: 1000.5 });
      const profit = await getTopProducts({ ...scope, metric: "profit" });
      expect(profit.items[0]).toEqual({ sku: "valuable", name: "valuable", value: 1000.5 });
      expect(profit.canProfit).toBe(true); // Recorded zero cost is known, not missing.
      expect(profit.items.slice(1).map((item) => item.sku)).toEqual(
        Array.from({ length: 9 }, (_, index) => `bulk-${String(index).padStart(2, "0")}`),
      );
      await tx.$executeRaw`UPDATE "Product" SET "basePriceKgs" = 0`;
      expect(await getTopProducts({ ...scope, metric: "revenue" })).toEqual(revenue);
    });
  });

  it("aggregates historical line costs, keeps losses and excludes foreign/noncompleted sales from product rankings", async () => {
    await withReportingTables(async (tx) => {
      await product(tx, "aggregated");
      await order(tx, { id: "included" });
      await line(tx, {
        id: "a",
        orderId: "included",
        productId: "aggregated",
        qty: 2,
        revenue: 20,
        unitCost: 15,
      });
      await line(tx, {
        id: "b",
        orderId: "included",
        productId: "aggregated",
        qty: 1,
        revenue: 15,
        cost: 20,
        unitCost: 1000,
      });
      for (const input of [
        { id: "store", storeId: "store-b" },
        { id: "organization", organizationId: "foreign-org" },
        { id: "status", status: "DRAFT" },
        { id: "date", date: new Date(Date.now() - 60 * 86400000) },
      ]) {
        await order(tx, input);
        await line(tx, {
          id: input.id,
          orderId: input.id,
          productId: "aggregated",
          qty: 999,
          revenue: 99999,
          cost: null,
        });
      }
      expect(await getTopProducts({ ...scope, metric: "profit" })).toEqual({
        items: [{ sku: "aggregated", name: "aggregated", value: -15 }],
        canProfit: true,
      });
      expect((await getTopProducts({ ...scope, metric: "units" })).items[0].value).toBe(3);
      expect((await getTopProducts({ ...scope, metric: "revenue" })).items[0].value).toBe(35);
    });
  });

  it("withholds profit when historical cost is missing even on a product below the top-ten limit", async () => {
    await withReportingTables(async (tx) => {
      await order(tx, { id: "sales" });
      for (let index = 0; index < 11; index += 1) {
        const id = `product-${index}`;
        await product(tx, id);
        await line(tx, {
          id,
          orderId: "sales",
          productId: id,
          qty: 1,
          revenue: 100 - index,
          cost: index === 10 ? null : 0,
        });
      }
      const revenue = await getTopProducts({ ...scope, metric: "revenue" });
      expect(revenue.items).toHaveLength(10);
      expect(revenue.items.map((item) => item.sku)).not.toContain("product-10");
      expect(revenue.canProfit).toBe(false);
      expect(await getTopProducts({ ...scope, metric: "profit" })).toEqual({
        items: [],
        canProfit: false,
      });
    });
  });
});
