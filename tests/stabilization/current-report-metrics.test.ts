import { CustomerOrderStatus, PosPaymentMethod, PosReturnStatus, type Prisma, PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it, vi } from "vitest";

import { prisma } from "@/server/db/prisma";
import {
  getSalesAnalyticsOverview,
  getSalesAnalyticsFilterOptions,
  getSoldProductsAnalytics,
  resolveSalesAnalyticsDateRange,
} from "@/server/services/salesAnalytics";
import { stabilizationDatabaseUrl } from "../../scripts/stabilization/environment";

// The ORM is also bound to pg_temp so its relation filters read only the same
// temporary reporting projection as the raw SQL. No operational row is inserted.
const tempClient = new PrismaClient({
  datasourceUrl: `${stabilizationDatabaseUrl}?schema=pg_temp`,
});
afterAll(async () => tempClient.$disconnect());

const scope = { organizationId: "metric-org", storeIds: ["store-a"] };
const period = { dateFrom: "2026-09-01", dateTo: "2026-09-02" };
const at = (value: string) => new Date(value);

async function withProjection(run: (tx: Prisma.TransactionClient) => Promise<void>) {
  await tempClient.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL search_path TO pg_temp, public");
    await tx.$executeRawUnsafe('CREATE TEMP TABLE "MetricProjectionAnchor" (id integer) ON COMMIT DROP');
    // Enum fixtures exist only in this connection's temporary namespace. Prisma
    // qualifies casts with pg_temp as well as table names.
    for (const [name, values] of [
      ["CustomerOrderStatus", Object.values(CustomerOrderStatus)],
      ["PosReturnStatus", Object.values(PosReturnStatus)],
      ["PosPaymentMethod", Object.values(PosPaymentMethod)],
    ] as const) {
      await tx.$executeRawUnsafe(`DROP TYPE IF EXISTS pg_temp."${name}"`);
      await tx.$executeRawUnsafe(`CREATE TYPE pg_temp."${name}" AS ENUM (${values.map(value => "'" + value + "'").join(",")})`);
    }
    const ddl = [
      `CREATE TEMP TABLE "CustomerOrder" (id text PRIMARY KEY, "organizationId" text NOT NULL, "storeId" text NOT NULL, "registerId" text, "createdById" text, "isPosSale" boolean NOT NULL DEFAULT true, "isHeld" boolean NOT NULL DEFAULT false, status pg_temp."CustomerOrderStatus" NOT NULL DEFAULT 'COMPLETED', "completedAt" timestamp, "createdAt" timestamp DEFAULT CURRENT_TIMESTAMP, "totalKgs" numeric(12,2) NOT NULL DEFAULT 0, "discountKgs" numeric(12,2) NOT NULL DEFAULT 0) ON COMMIT DROP`,
      `CREATE TEMP TABLE "SaleReturn" (id text PRIMARY KEY, "organizationId" text NOT NULL, "storeId" text NOT NULL, "registerId" text, "createdById" text, "completedById" text, status pg_temp."PosReturnStatus" NOT NULL DEFAULT 'COMPLETED', "completedAt" timestamp, "totalKgs" numeric(12,2) NOT NULL DEFAULT 0) ON COMMIT DROP`,
      `CREATE TEMP TABLE "SalePayment" (id text PRIMARY KEY, "organizationId" text NOT NULL, "customerOrderId" text, "saleReturnId" text, method pg_temp."PosPaymentMethod" NOT NULL, "amountKgs" numeric(12,2) NOT NULL, "isRefund" boolean NOT NULL) ON COMMIT DROP`,
      `CREATE TEMP TABLE "Product" (id text PRIMARY KEY, "organizationId" text NOT NULL, sku text NOT NULL, name text NOT NULL, category text, categories text[] NOT NULL DEFAULT '{}') ON COMMIT DROP`,
      `CREATE TEMP TABLE "ProductVariant" (id text PRIMARY KEY, "productId" text, name text, sku text) ON COMMIT DROP`,
      `CREATE TEMP TABLE "ProductBarcode" (id text PRIMARY KEY, "productId" text, value text, "createdAt" timestamp) ON COMMIT DROP`,
      `CREATE TEMP TABLE "CustomerOrderLine" (id text PRIMARY KEY, "customerOrderId" text NOT NULL, "productId" text NOT NULL, "variantId" text, "variantKey" text NOT NULL DEFAULT 'BASE', qty integer NOT NULL, "lineTotalKgs" numeric(12,2) NOT NULL, "lineCostTotalKgs" numeric(12,2), "unitCostKgs" numeric(12,2)) ON COMMIT DROP`,
      `CREATE TEMP TABLE "SaleReturnLine" (id text PRIMARY KEY, "saleReturnId" text NOT NULL, "productId" text NOT NULL, "variantId" text, "variantKey" text NOT NULL DEFAULT 'BASE', qty integer NOT NULL, "lineTotalKgs" numeric(12,2) NOT NULL) ON COMMIT DROP`,
    ];
    for (const statement of ddl) await tx.$executeRawUnsafe(statement);
    const query = vi.spyOn(prisma, "$queryRaw").mockImplementation((statement) => tx.$queryRaw(statement));
    const payments = vi.spyOn(prisma.salePayment, "groupBy").mockImplementation((args) => tx.salePayment.groupBy(args as never) as never);
    // This existing supporting read is outside monetary certification. It never
    // reaches the operational stock projection, and BAAM does not expose it.
    const stock = vi.spyOn(prisma.inventorySnapshot, "groupBy").mockResolvedValue([]);
    try { await run(tx); }
    finally { query.mockRestore(); payments.mockRestore(); stock.mockRestore(); }
  }, {timeout: 30_000});
}

async function sale(tx: Prisma.TransactionClient, input: {id: string; total?: number; discount?: number; date?: string; org?: string; store?: string; cashier?: string; held?: boolean; pos?: boolean; status?: string}) {
  await tx.$executeRaw`INSERT INTO "CustomerOrder" (id, "organizationId", "storeId", "registerId", "createdById", "totalKgs", "discountKgs", "completedAt", "isHeld", "isPosSale", status)
    VALUES (${input.id}, ${input.org ?? scope.organizationId}, ${input.store ?? "store-a"}, 'register-a', ${input.cashier ?? "cashier-a"}, ${input.total ?? 0}, ${input.discount ?? 0}, ${at(input.date ?? "2026-09-01T08:00:00Z")}, ${input.held ?? false}, ${input.pos ?? true}, ${input.status ?? "COMPLETED"}::pg_temp."CustomerOrderStatus")`;
}
async function returned(tx: Prisma.TransactionClient, input: {id: string; total?: number; date?: string; org?: string; store?: string; createdBy?: string; completedBy?: string | null}) {
  await tx.$executeRaw`INSERT INTO "SaleReturn" (id, "organizationId", "storeId", "registerId", "createdById", "completedById", "totalKgs", "completedAt")
    VALUES (${input.id}, ${input.org ?? scope.organizationId}, ${input.store ?? "store-a"}, 'register-a', ${input.createdBy ?? "cashier-a"}, ${input.completedBy === undefined ? "cashier-a" : input.completedBy}, ${input.total ?? 0}, ${at(input.date ?? "2026-09-02T08:00:00Z")})`;
}
async function payment(tx: Prisma.TransactionClient, input: {id: string; orderId?: string; returnId?: string; amount: number; method?: string; org?: string}) {
  await tx.$executeRaw`INSERT INTO "SalePayment" (id, "organizationId", "customerOrderId", "saleReturnId", method, "amountKgs", "isRefund")
    VALUES (${input.id}, ${input.org ?? scope.organizationId}, ${input.orderId ?? null}, ${input.returnId ?? null}, ${input.method ?? "CASH"}::pg_temp."PosPaymentMethod", ${input.amount}, ${Boolean(input.returnId)})`;
}
async function product(tx: Prisma.TransactionClient, id: string) {
  await tx.$executeRaw`INSERT INTO "Product" (id, "organizationId", sku, name, category) VALUES (${id}, ${scope.organizationId}, ${id}, ${id}, 'Food')`;
}

describe("current sales reporting certification on temporary SQL projections", () => {
  it("rejects impossible calendar dates rather than silently moving their reporting range", () => {
    for (const date of ["2026-02-29", "2026-02-31", "2026-13-01", "2026-00-01", "2026-09-00"]) {
      expect(() => resolveSalesAnalyticsDateRange({dateFrom: date, dateTo: date})).toThrow("invalidInput");
    }
    expect(resolveSalesAnalyticsDateRange({dateFrom: "2024-02-29", dateTo: "2024-02-29"}).dayCount).toBe(1);
  });

  it("reconciles dated discounted sales, cross-period returns, split payments and business-midnight scope", async () => {
    await withProjection(async (tx) => {
      await sale(tx, {id: "first", total: 90, discount: 10, date: "2026-08-31T18:00:00Z"});
      await sale(tx, {id: "second", total: 50.25, discount: 4.75, date: "2026-09-01T17:59:59.999Z"});
      await sale(tx, {id: "next-day", total: 20, date: "2026-09-01T18:00:00Z"});
      for (const input of [{id:"before",date:"2026-08-31T17:59:59.999Z"},{id:"after",date:"2026-09-02T18:00:00Z"},{id:"foreign",org:"foreign-org"},{id:"store",store:"store-b"},{id:"held",held:true},{id:"channel",pos:false},{id:"draft",status:"DRAFT"}]) await sale(tx,{...input,total:9999});
      await returned(tx, {id: "prior-period-return", total: 35.5});
      await payment(tx, {id:"cash",orderId:"first",amount:30});
      await payment(tx, {id:"card",orderId:"first",amount:60,method:"CARD"});
      await payment(tx, {id:"second-payment",orderId:"second",amount:50.25,method:"TRANSFER"});
      await payment(tx, {id:"next-payment",orderId:"next-day",amount:20});
      await payment(tx, {id:"refund",returnId:"prior-period-return",amount:35.5});
      const result = await getSalesAnalyticsOverview({...scope,...period});
      expect(result.range.fromUtc.toISOString()).toBe("2026-08-31T18:00:00.000Z");
      expect(result.range.toUtcExclusive.toISOString()).toBe("2026-09-02T18:00:00.000Z");
      expect(result.series.map(({date,grossSalesKgs,returnsKgs,netSalesKgs}) => ({date,grossSalesKgs,returnsKgs,netSalesKgs}))).toEqual([
        {date:"2026-09-01",grossSalesKgs:140.25,returnsKgs:0,netSalesKgs:140.25},
        {date:"2026-09-02",grossSalesKgs:20,returnsKgs:35.5,netSalesKgs:-15.5},
      ]);
      expect(result.totals).toMatchObject({grossSalesKgs:160.25,discountKgs:14.75,returnsKgs:35.5,netSalesKgs:124.75,receiptCount:3,returnCount:1,averageReceiptKgs:53.42,paymentBreakdown:{CASH:50,CARD:60,TRANSFER:50.25,OTHER:0},refundBreakdown:{CASH:35.5,CARD:0,TRANSFER:0,OTHER:0}});
      expect(result.series.reduce((sum,row)=>sum+row.netSalesKgs,0)).toBe(result.totals.netSalesKgs);
    });
  });

  it("uses the return completer, falling back to creator only when absent, for both totals and payment methods", async () => {
    await withProjection(async (tx) => {
      await returned(tx,{id:"different-completer",total:90,createdBy:"cashier-a",completedBy:"cashier-b"});
      await returned(tx,{id:"creator-fallback",total:10,createdBy:"cashier-a",completedBy:null});
      await returned(tx,{id:"same-completer",total:20,createdBy:"cashier-b",completedBy:"cashier-a"});
      for (const [id,amount] of [["different-completer",90],["creator-fallback",10],["same-completer",20]] as const) await payment(tx,{id:"payment-"+id,returnId:id,amount});
      const result=await getSalesAnalyticsOverview({...scope,...period,cashierId:"cashier-a"});
      expect(result.totals.returnsKgs).toBe(30);
      expect(result.totals.refundBreakdown.CASH).toBe(30);
    });
  });

  it("does not include payment rows whose linked sale or return belongs to another organization", async () => {
    await withProjection(async(tx)=>{
      await sale(tx,{id:"foreign-sale",org:"foreign-org",total:500});
      await returned(tx,{id:"foreign-return",org:"foreign-org",total:200});
      await payment(tx,{id:"bad-link-sale",orderId:"foreign-sale",amount:500});
      await payment(tx,{id:"bad-link-refund",returnId:"foreign-return",amount:200});
      const result=await getSalesAnalyticsOverview({...scope,...period});
      expect(result.totals.grossSalesKgs).toBe(0);
      expect(result.totals.returnsKgs).toBe(0);
      expect(result.totals.paymentBreakdown.CASH).toBe(0);
      expect(result.totals.refundBreakdown.CASH).toBe(0);
    });
  });

  it("includes return-only products so product net totals can reconcile across periods", async () => {
    await withProjection(async(tx)=>{
      await product(tx,"current-sale"); await product(tx,"prior-sale");
      await tx.$executeRaw`UPDATE "Product" SET category = 'Returns category' WHERE id = 'prior-sale'`;
      await sale(tx,{id:"new",total:90,discount:10});
      await tx.$executeRaw`INSERT INTO "CustomerOrderLine" (id,"customerOrderId","productId",qty,"lineTotalKgs") VALUES ('line','new','current-sale',2,90)`;
      await returned(tx,{id:"old-return",total:30});
      await tx.$executeRaw`INSERT INTO "SaleReturnLine" (id,"saleReturnId","productId",qty,"lineTotalKgs") VALUES ('return-line','old-return','prior-sale',1,30)`;
      const result=await getSoldProductsAnalytics({...scope,...period,pageSize:100});
      expect(result.total).toBe(2);
      expect(result.items.map(row=>({sku:row.productSku,sold:row.quantitySold,returned:row.quantityReturned,net:row.netRevenueKgs}))).toEqual([
        {sku:"current-sale",sold:2,returned:0,net:90},{sku:"prior-sale",sold:0,returned:1,net:-30},
      ]);
      expect(result.items.reduce((sum,row)=>sum+row.netRevenueKgs,0)).toBe((await getSalesAnalyticsOverview({...scope,...period})).totals.netSalesKgs);
      const filtered=await getSoldProductsAnalytics({...scope,...period,search:"prior-sale",pageSize:1});
      expect(filtered.total).toBe(1); expect(filtered.items[0].netQuantity).toBe(-1);
      const secondPage = await getSoldProductsAnalytics({...scope,...period,page:2,pageSize:1});
      expect(secondPage.total).toBe(2); expect(secondPage.items[0].productId).toBe("prior-sale");
      expect((await getSalesAnalyticsFilterOptions({...scope,...period})).categories).toEqual(["Food", "Returns category"]);
    });
  });
});
