import { type Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/prisma";
import { getSoldProductsAnalyticsExport, SOLD_PRODUCTS_EXPORT_ROW_LIMIT } from "@/server/services/salesAnalytics";

const scope = { organizationId: "export-org", storeIds: ["store-a"], registerId: "register-a", cashierId: "cashier-a", dateFrom: "2026-09-01", dateTo: "2026-09-01" };

// Temporary reporting projections only. No operational receipt/stock producer,
// persistent sales record, external provider, migration or database reset runs.
async function projection(run: (tx: Prisma.TransactionClient) => Promise<void>) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL search_path TO pg_temp, public");
    for (const ddl of [
      `CREATE TEMP TABLE "CustomerOrder" (id text PRIMARY KEY, "organizationId" text, "storeId" text, "registerId" text DEFAULT 'register-a', "createdById" text DEFAULT 'cashier-a', "isPosSale" boolean DEFAULT true, "isHeld" boolean DEFAULT false, status "CustomerOrderStatus" DEFAULT 'COMPLETED', "completedAt" timestamp) ON COMMIT DROP`,
      `CREATE TEMP TABLE "SaleReturn" (id text PRIMARY KEY, "organizationId" text, "storeId" text, "registerId" text DEFAULT 'register-a', "createdById" text DEFAULT 'cashier-a', "completedById" text DEFAULT 'cashier-a', status "PosReturnStatus" DEFAULT 'COMPLETED', "completedAt" timestamp) ON COMMIT DROP`,
      `CREATE TEMP TABLE "Product" (id text PRIMARY KEY, "organizationId" text DEFAULT 'export-org', name text, sku text, category text DEFAULT 'Food', categories text[] DEFAULT ARRAY['Hot drinks']) ON COMMIT DROP`,
      `CREATE TEMP TABLE "ProductVariant" (id text PRIMARY KEY, "productId" text, name text, sku text) ON COMMIT DROP`,
      `CREATE TEMP TABLE "ProductBarcode" (id text PRIMARY KEY, "productId" text, value text, "createdAt" timestamp) ON COMMIT DROP`,
      `CREATE TEMP TABLE "CustomerOrderLine" (id text PRIMARY KEY, "customerOrderId" text, "productId" text, "variantId" text, "variantKey" text DEFAULT 'BASE', qty integer, "lineTotalKgs" numeric(12,2)) ON COMMIT DROP`,
      `CREATE TEMP TABLE "SaleReturnLine" (id text PRIMARY KEY, "saleReturnId" text, "productId" text, "variantId" text, "variantKey" text DEFAULT 'BASE', qty integer, "lineTotalKgs" numeric(12,2)) ON COMMIT DROP`,
    ]) await tx.$executeRawUnsafe(ddl);
    const queryInTransaction = tx.$queryRaw.bind(tx);
    const query = vi.spyOn(prisma, "$queryRaw").mockImplementation((sql) => queryInTransaction(sql));
    const stock = vi.spyOn(prisma.inventorySnapshot, "groupBy").mockImplementation(() => { throw Error("Stock read forbidden in sales export"); });
    try { await run(tx); expect(stock).not.toHaveBeenCalled(); }
    finally { query.mockRestore(); stock.mockRestore(); }
  }, { timeout: 30_000 });
}

describe("all-filtered sold-products export on actual reporting SQL", () => {
  it("reconciles discounted recorded sales, return-only rows, variants and local-midnight boundaries under every filter", async () => {
    await projection(async (tx) => {
      await tx.$executeRaw`INSERT INTO "Product" (id,name,sku) VALUES ('a','Filtered tea','BASE'),('b','Filtered prior sale','PRIOR'),('c','Outside category','OUTSIDE')`;
      await tx.$executeRaw`UPDATE "Product" SET category='Other', categories=ARRAY['Other'] WHERE id='c'`;
      await tx.$executeRaw`INSERT INTO "Product" (id,"organizationId",name,sku) VALUES ('foreign-product','foreign-org','Filtered foreign','FOREIGN')`;
      await tx.$executeRaw`INSERT INTO "ProductVariant" (id,"productId",name,sku) VALUES ('v','a','Red','VAR-RED')`;
      await tx.$executeRaw`INSERT INTO "ProductBarcode" (id,"productId",value,"createdAt") VALUES ('bc','a','00123','2026-01-01')`;
      await tx.$executeRaw`INSERT INTO "CustomerOrder" (id,"organizationId","storeId","completedAt") VALUES
        ('start','export-org','store-a','2026-08-31 18:00:00'),('last','export-org','store-a','2026-09-01 17:59:59.999'),
        ('before','export-org','store-a','2026-08-31 17:59:59.999'),('after','export-org','store-a','2026-09-01 18:00:00'),
        ('foreign','foreign-org','store-a','2026-09-01 10:00:00'),('store','export-org','store-b','2026-09-01 10:00:00'),
        ('register','export-org','store-a','2026-09-01 10:00:00'),('cashier','export-org','store-a','2026-09-01 10:00:00'),
        ('held','export-org','store-a','2026-09-01 10:00:00'),('draft','export-org','store-a','2026-09-01 10:00:00'),
        ('channel','export-org','store-a','2026-09-01 10:00:00')`;
      await tx.$executeRaw`UPDATE "CustomerOrder" SET "registerId"='other-register' WHERE id='register'`;
      await tx.$executeRaw`UPDATE "CustomerOrder" SET "createdById"='other-cashier' WHERE id='cashier'`;
      await tx.$executeRaw`UPDATE "CustomerOrder" SET "isHeld"=true WHERE id='held'`;
      await tx.$executeRaw`UPDATE "CustomerOrder" SET status='DRAFT' WHERE id='draft'`;
      await tx.$executeRaw`UPDATE "CustomerOrder" SET "isPosSale"=false WHERE id='channel'`;
      // Historical discounted line amounts are90 and40. No current price exists
      // in this projection, so recomputing from today's catalog is impossible.
      await tx.$executeRaw`INSERT INTO "CustomerOrderLine" (id,"customerOrderId","productId","variantId","variantKey",qty,"lineTotalKgs") VALUES
        ('a-start','start','a','v','RED',2,90),('a-last','last','a','v','RED',1,40),
        ('c','start','c',null,'BASE',1,500),('foreign-product','start','foreign-product',null,'BASE',1,700)`;
      await tx.$executeRaw`INSERT INTO "CustomerOrderLine" (id,"customerOrderId","productId","variantId","variantKey",qty,"lineTotalKgs")
        SELECT 'excluded-'||id,id,'a','v','RED',999,9999 FROM "CustomerOrder" WHERE id NOT IN ('start','last')`;
      await tx.$executeRaw`INSERT INTO "SaleReturn" (id,"organizationId","storeId","completedAt") VALUES
        ('returned','export-org','store-a','2026-09-01 10:00:00'),('foreign-return','foreign-org','store-a','2026-09-01 10:00:00'),
        ('late-return','export-org','store-a','2026-09-01 18:00:00'),('wrong-completer','export-org','store-a','2026-09-01 10:00:00')`;
      await tx.$executeRaw`UPDATE "SaleReturn" SET "completedById"='another-cashier' WHERE id='wrong-completer'`;
      await tx.$executeRaw`INSERT INTO "SaleReturnLine" (id,"saleReturnId","productId","variantId","variantKey",qty,"lineTotalKgs") VALUES
        ('a-return','returned','a','v','RED',1,45),('prior-return','returned','b',null,'BASE',2,30)`;
      await tx.$executeRaw`INSERT INTO "SaleReturnLine" (id,"saleReturnId","productId","variantId","variantKey",qty,"lineTotalKgs")
        SELECT id,id,'a','v','RED',999,9999 FROM "SaleReturn" WHERE id<>'returned'`;

      const result = await getSoldProductsAnalyticsExport({ ...scope, category: "Hot drinks", search: "filtered" });
      expect(result.range.fromUtc.toISOString()).toBe("2026-08-31T18:00:00.000Z");
      expect(result.range.toUtcExclusive.toISOString()).toBe("2026-09-01T18:00:00.000Z");
      expect(result.total).toBe(2);
      expect(result.items.map((row) => ({ sku:row.productSku, variant:row.variantName, sold:row.quantitySold, returned:row.quantityReturned, gross:row.grossRevenueKgs, refunds:row.returnedRevenueKgs, net:row.netRevenueKgs, average:row.averagePriceKgs, receipts:row.receiptCount }))).toEqual([
        {sku:"VAR-RED",variant:"Red",sold:3,returned:1,gross:130,refunds:45,net:85,average:43.33,receipts:2},
        {sku:"PRIOR",variant:null,sold:0,returned:2,gross:0,refunds:30,net:-30,average:0,receipts:0},
      ]);
      expect(result.items.reduce((sum,row)=>sum+row.netRevenueKgs,0)).toBe(55);
      expect(result.items.every(row => !("stockRemaining" in row))).toBe(true);
      for (const search of ["VAR-RED", "BASE", "00123"]) {
        expect((await getSoldProductsAnalyticsExport({ ...scope, category:"Hot drinks",search })).items.map(row=>row.productId)).toEqual(["a"]);
      }
    });
  });

  it("exports rows beyond every visible page and explicitly rejects overflow without truncating", async () => {
    await projection(async (tx) => {
      await tx.$executeRaw`INSERT INTO "CustomerOrder" (id,"organizationId","storeId","completedAt") VALUES ('bulk','export-org','store-a','2026-09-01 10:00:00')`;
      await tx.$executeRaw`INSERT INTO "Product" (id,name,sku) SELECT 'p-'||n,'Bulk '||LPAD(n::text,5,'0'),'SKU-'||n FROM generate_series(1,${SOLD_PRODUCTS_EXPORT_ROW_LIMIT + 1}) n`;
      await tx.$executeRaw`INSERT INTO "CustomerOrderLine" (id,"customerOrderId","productId",qty,"lineTotalKgs") SELECT id,'bulk',id,1,1 FROM "Product"`;
      await expect(getSoldProductsAnalyticsExport({ ...scope })).rejects.toThrow("analyticsExportRowLimit");
      await tx.$executeRaw`DELETE FROM "CustomerOrderLine" WHERE "productId"=${`p-${SOLD_PRODUCTS_EXPORT_ROW_LIMIT + 1}`}`;
      const full = await getSoldProductsAnalyticsExport(scope);
      expect(full.total).toBe(SOLD_PRODUCTS_EXPORT_ROW_LIMIT);
      expect(full.items).toHaveLength(SOLD_PRODUCTS_EXPORT_ROW_LIMIT);
      expect(full.items.at(-1)?.productId).toBe(`p-${SOLD_PRODUCTS_EXPORT_ROW_LIMIT}`);
      expect(full.items.reduce((sum,row)=>sum+row.netRevenueKgs,0)).toBe(SOLD_PRODUCTS_EXPORT_ROW_LIMIT);
      expect(full.meta).toMatchObject({ population:"all-filtered",rowLimit:10_000 });
      expect(new Set(full.items.map(row=>row.productId)).size).toBe(full.items.length);
    });
  });

  it("keeps empty grants empty without a query and validates the date range even then", async () => {
    const query = vi.spyOn(prisma,"$queryRaw").mockRejectedValue(Error("No database read expected"));
    try {
      expect(await getSoldProductsAnalyticsExport({ ...scope, storeIds:[] })).toMatchObject({items:[],total:0});
      await expect(getSoldProductsAnalyticsExport({ ...scope,storeIds:[],dateFrom:"2026-02-30" })).rejects.toThrow("invalidInput");
      expect(query).not.toHaveBeenCalled();
    } finally { query.mockRestore(); }
  });
});
