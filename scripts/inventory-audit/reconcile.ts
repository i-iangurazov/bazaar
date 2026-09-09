/** Read-only, reproducible inventory diagnosis. Never prints connection credentials. */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { stockAuditEnvironment } from "./environment";

const production = process.argv.includes("--production");
const source = production
  ? parseEnv(await readFile(".vercel/.env.production.local", "utf8"))
  : stockAuditEnvironment();
if (!source.DATABASE_URL) throw new Error("No configured database connection");
const db = new PrismaClient({ datasourceUrl: source.DATABASE_URL });
const output = production
  ? "artifacts/bazaar-stock-audit/production-reconciliation.json"
  : "artifacts/bazaar-stock-audit/local-reconciliation.json";
try {
  const report = await db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '55s'");
      const stock = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(`
      WITH journal AS (
        SELECT "storeId", "productId", COALESCE("variantId", 'BASE') AS "variantKey",
          SUM("qtyDelta")::int AS "ledgerOnHand", COUNT(*)::int AS "movementCount",
          COUNT(*) FILTER (WHERE "qtyDelta" <> 0 AND "stockLotId" IS NULL)::int AS "unallocatedMovements"
        FROM "StockMovement" GROUP BY 1,2,3
      ), incoming AS (
        SELECT po."storeId", l."productId", l."variantKey",
          SUM(GREATEST(l."qtyOrdered" - l."qtyReceived",0))::int AS "expectedOnOrder",
          md5(string_agg(concat_ws(':',po.id,po.status,l.id,l."qtyOrdered",l."qtyReceived"), ',' ORDER BY po.id,l.id)) AS "sourceFingerprint"
        FROM "PurchaseOrderLine" l JOIN "PurchaseOrder" po ON po.id=l."purchaseOrderId"
        WHERE po.status IN ('SUBMITTED','APPROVED','PARTIALLY_RECEIVED') GROUP BY 1,2,3
      ), lots AS (
        SELECT "storeId", "productId", "variantKey", SUM("onHandQty")::int AS "lotOnHand", COUNT(*)::int AS "lotCount"
        FROM "StockLot" GROUP BY 1,2,3
      ), identities AS (
        SELECT "storeId","productId","variantKey" FROM "InventorySnapshot"
        UNION SELECT "storeId","productId","variantKey" FROM journal
        UNION SELECT "storeId","productId","variantKey" FROM incoming
        UNION SELECT "storeId","productId","variantKey" FROM lots
      )
      SELECT k.*, s.id AS "snapshotId", st."organizationId", p."isDeleted", st."trackExpiryLots",
        s."onHand", s."onOrder", s."updatedAt", COALESCE((to_jsonb(s)->>'version')::int,0) AS version,
        COALESCE(j."ledgerOnHand",0) AS "ledgerOnHand", COALESCE(j."movementCount",0) AS "movementCount",
        COALESCE(j."unallocatedMovements",0) AS "unallocatedMovements", COALESCE(i."expectedOnOrder",0) AS "expectedOnOrder",
        i."sourceFingerprint", COALESCE(l."lotOnHand",0) AS "lotOnHand", COALESCE(l."lotCount",0) AS "lotCount",
        (st."organizationId" IS DISTINCT FROM p."organizationId") AS "tenantMismatch"
      FROM identities k
      JOIN "Store" st ON st.id=k."storeId" JOIN "Product" p ON p.id=k."productId"
      LEFT JOIN "InventorySnapshot" s USING ("storeId","productId","variantKey")
      LEFT JOIN journal j USING ("storeId","productId","variantKey")
      LEFT JOIN incoming i USING ("storeId","productId","variantKey")
      LEFT JOIN lots l USING ("storeId","productId","variantKey")
      ORDER BY k."storeId", k."productId", k."variantKey"
    `);
      const documentMismatches = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(`
      WITH expected AS (
        SELECT 'PURCHASE_ORDER'::text AS kind, po.id AS "documentId", po."storeId", l."productId", COALESCE(l."variantId",'BASE') AS "variantKey",
          SUM(l."qtyReceived")::int AS qty
        FROM "PurchaseOrder" po JOIN "PurchaseOrderLine" l ON l."purchaseOrderId"=po.id GROUP BY 1,2,3,4,5
        UNION ALL
        SELECT 'CustomerOrder', o.id, o."storeId", l."productId", COALESCE(l."variantId",'BASE'),
          CASE WHEN o.status='CANCELED' THEN 0 ELSE -SUM(l.qty)::int END
        FROM "CustomerOrder" o JOIN "CustomerOrderLine" l ON l."customerOrderId"=o.id
        WHERE o.status='COMPLETED' OR EXISTS (SELECT 1 FROM "StockMovement" m WHERE m."referenceType"='CustomerOrder' AND m."referenceId"=o.id)
        GROUP BY 1,2,3,4,5,o.status
        UNION ALL
        SELECT 'SaleReturn', r.id, r."storeId", l."productId", COALESCE(l."variantId",'BASE'), SUM(l.qty)::int
        FROM "SaleReturn" r JOIN "SaleReturnLine" l ON l."saleReturnId"=r.id WHERE r.status='COMPLETED' GROUP BY 1,2,3,4,5
        UNION ALL
        SELECT 'STOCK_COUNT', c.id, c."storeId", l."productId", l."variantKey", SUM(l."deltaQty")::int
        FROM "StockCount" c JOIN "StockCountLine" l ON l."stockCountId"=c.id WHERE c.status='APPLIED' GROUP BY 1,2,3,4,5
      ), actual AS (
        SELECT "referenceType" AS kind, "referenceId" AS "documentId", "storeId", "productId", COALESCE("variantId",'BASE') AS "variantKey", SUM("qtyDelta")::int AS qty
        FROM "StockMovement" WHERE "referenceType" IN ('PURCHASE_ORDER','CustomerOrder','SaleReturn','STOCK_COUNT') GROUP BY 1,2,3,4,5
      )
      SELECT COALESCE(e.kind,a.kind) AS kind, COALESCE(e."documentId",a."documentId") AS "documentId",
        COALESCE(e."storeId",a."storeId") AS "storeId", COALESCE(e."productId",a."productId") AS "productId",
        COALESCE(e."variantKey",a."variantKey") AS "variantKey", COALESCE(e.qty,0) AS expected, COALESCE(a.qty,0) AS actual
      FROM expected e FULL JOIN actual a USING (kind,"documentId","storeId","productId","variantKey")
      WHERE COALESCE(e.qty,0) <> COALESCE(a.qty,0)
    `);
      const sources = await tx.$queryRawUnsafe(
        `SELECT COALESCE("referenceType",'(unreferenced)') AS source, type, COUNT(*)::int AS count, SUM("qtyDelta")::bigint AS quantity FROM "StockMovement" GROUP BY 1,2 ORDER BY 1,2`,
      );
      const totals = await tx.$queryRawUnsafe(
        `SELECT (SELECT COUNT(*)::int FROM "Store") AS stores, (SELECT COUNT(*)::int FROM "Organization") AS organizations, (SELECT COUNT(*)::int FROM "StockMovement") AS movements`,
      );
      const stockDrift = stock.filter(
        (row) => row.snapshotId === null || row.onHand !== row.ledgerOnHand,
      );
      const incomingDrift = stock.filter(
        (row) =>
          (row.snapshotId === null && row.expectedOnOrder !== 0) ||
          (row.snapshotId !== null && row.onOrder !== row.expectedOnOrder),
      );
      const lotDrift = stock.filter((row) => row.trackExpiryLots && row.onHand !== row.lotOnHand);
      const tenantDrift = stock.filter((row) => row.tenantMismatch);
      return {
        format: "bazaar-stock-reconciliation-v1",
        readOnly: true,
        capturedAt: new Date().toISOString(),
        totals,
        stockIdentities: stock.length,
        sources,
        definitions: {
          physical:
            "Snapshot onHand vs all signed movements; mismatch alone does not identify which source is correct",
          incoming:
            "Remaining quantities on SUBMITTED, APPROVED and PARTIALLY_RECEIVED purchase orders",
          lots: "Optional expiry coverage; missing historical allocation cannot infer expiry dates",
        },
        stockDrift,
        incomingDrift,
        lotDrift,
        tenantDrift,
        documentMismatches,
        ambiguous: stockDrift.map((row) => ({
          ...row,
          reason:
            "Opening/operation completeness must be independently proven; no automatic physical overwrite",
        })),
        repairPlan: incomingDrift
          .filter((row) => row.snapshotId && !row.tenantMismatch)
          .map((row) => ({
            snapshotId: row.snapshotId,
            organizationId: row.organizationId,
            storeId: row.storeId,
            productId: row.productId,
            variantKey: row.variantKey,
            before: row.onOrder,
            after: row.expectedOnOrder,
            onHand: row.onHand,
            version: row.version,
            updatedAt: row.updatedAt,
            sourceFingerprint: row.sourceFingerprint,
          })),
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 60_000 },
  );
  const content = JSON.stringify(
    report,
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    2,
  );
  await mkdir("artifacts/bazaar-stock-audit", { recursive: true });
  await writeFile(output, content, { mode: 0o600 });
  console.log(
    JSON.stringify({
      output,
      sha256: createHash("sha256").update(content).digest("hex"),
      totals: report.totals,
      identities: report.stockIdentities,
      stockDrift: report.stockDrift.length,
      incomingDrift: report.incomingDrift.length,
      lotDrift: report.lotDrift.length,
      tenantDrift: report.tenantDrift.length,
      documentMismatches: report.documentMismatches.length,
      provableIncomingRepairs: report.repairPlan.length,
    }),
  );
} finally {
  await db.$disconnect();
}
