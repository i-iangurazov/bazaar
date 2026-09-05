import { vi } from "vitest";
import { prisma } from "@/server/db/prisma";

type RecordedSaleProjection = {
  organizationId: string; storeId: string; productId: string; sku: string; name: string;
  qty: number; revenueKgs: number; costKgs: number;
};

// A reporting-only fixture for consumers whose other fixtures contain stock
// activity but no recorded monetary sale. TEMP projections never create an
// operational receipt/payment or call a POS/inventory workflow.
export async function withRecordedSalesProjection<T>(rows: RecordedSaleProjection[], run: () => Promise<T>) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`CREATE TEMP TABLE "CustomerOrder" (
      id text PRIMARY KEY, "organizationId" text, "storeId" text, status text,
      "completedAt" timestamp, "totalKgs" numeric(12,2)
    ) ON COMMIT DROP`;
    await tx.$executeRaw`CREATE TEMP TABLE "Product" (
      id text PRIMARY KEY, "organizationId" text, sku text, name text
    ) ON COMMIT DROP`;
    await tx.$executeRaw`CREATE TEMP TABLE "CustomerOrderLine" (
      id text PRIMARY KEY, "customerOrderId" text, "productId" text, qty integer,
      "lineTotalKgs" numeric(12,2), "lineCostTotalKgs" numeric(12,2), "unitCostKgs" numeric(12,2)
    ) ON COMMIT DROP`;
    const completedAt = new Date(Date.now() - 86400000);
    for (const [index, row] of rows.entries()) {
      const id = `report-projection-${index}`;
      await tx.$executeRaw`INSERT INTO "CustomerOrder" (id,"organizationId","storeId",status,"completedAt","totalKgs")
        VALUES (${id},${row.organizationId},${row.storeId},'COMPLETED',${completedAt},${row.revenueKgs})`;
      await tx.$executeRaw`INSERT INTO "Product" (id,"organizationId",sku,name)
        VALUES (${row.productId},${row.organizationId},${row.sku},${row.name}) ON CONFLICT (id) DO NOTHING`;
      await tx.$executeRaw`INSERT INTO "CustomerOrderLine" (id,"customerOrderId","productId",qty,"lineTotalKgs","lineCostTotalKgs")
        VALUES (${id},${id},${row.productId},${row.qty},${row.revenueKgs},${row.costKgs})`;
    }
    const queryTransaction = tx.$queryRaw.bind(tx);
    const query = vi.spyOn(prisma, "$queryRaw").mockImplementation((statement) => queryTransaction(statement));
    try { return await run(); } finally { query.mockRestore(); }
  }, { timeout: 20_000 });
}
