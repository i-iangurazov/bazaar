/** Read-only historical reporting audit. Never fills prices or rewrites documents. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { Prisma, PrismaClient } from "@prisma/client";
import { getSalesReport } from "../../src/server/services/reporting/sales";
import { addBusinessDays, businessDateKey } from "../../src/lib/timezone";

const production = process.argv.includes("--production-read-only");
const databaseUrl = production
  ? parseEnv(await readFile(".vercel/.env.production.local", "utf8")).DATABASE_URL
  : process.env.DATABASE_TEST_URL;
if (!databaseUrl) throw new Error("An explicit database connection is required");
if (!production && !["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname))
  throw new Error("Non-production audit is restricted to a local test database");
const db = new PrismaClient({ datasourceUrl: databaseUrl });
try {
  const result = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '30s'`;
      const sales = await tx.$queryRaw<Array<Record<string, unknown>>>`
      SELECT o."organizationId", COUNT(DISTINCT o.id)::int AS documents, COUNT(l.id)::int AS lines,
        COUNT(DISTINCT o.id) FILTER (WHERE o."completedAt" IS NULL)::int AS "missingCompletionDate",
        COUNT(DISTINCT o.id) FILTER (WHERE o."completedAt" > now())::int AS "futureCompletionDate",
        COUNT(l.id) FILTER (WHERE l."unitCostKgs" IS NULL AND l."lineCostTotalKgs" IS NULL)::int AS "missingCost",
        COUNT(l.id) FILTER (WHERE l."lineCostTotalKgs" IS NULL AND l."unitCostKgs" IS NOT NULL)::int AS "derivableFromUnitSnapshot",
        COUNT(l.id) FILTER (WHERE COALESCE(l."lineCostTotalKgs", l."unitCostKgs" * l.qty) = 0)::int AS "explicitZeroCost",
        COUNT(l.id) FILTER (WHERE l."lineCostTotalKgs" IS NOT NULL AND l."unitCostKgs" IS NOT NULL
          AND l."lineCostTotalKgs" <> ROUND(l."unitCostKgs" * l.qty, 2))::int AS "conflictingCostSnapshots"
      FROM "CustomerOrder" o LEFT JOIN "CustomerOrderLine" l ON l."customerOrderId" = o.id
      WHERE o.status = 'COMPLETED' AND NOT o."isHeld" GROUP BY o."organizationId" ORDER BY o."organizationId"`;
      const returns = await tx.$queryRaw<Array<Record<string, unknown>>>`
      SELECT r."organizationId", COUNT(DISTINCT r.id)::int AS documents, COUNT(l.id)::int AS lines,
        COUNT(DISTINCT r.id) FILTER (WHERE r."completedAt" IS NULL)::int AS "missingCompletionDate",
        COUNT(l.id) FILTER (WHERE original."lineCostTotalKgs" IS NULL AND original."unitCostKgs" IS NULL)::int AS "unknownOriginalCost",
        COUNT(l.id) FILTER (WHERE original."lineCostTotalKgs" IS NULL AND original."unitCostKgs" IS NULL
          AND (l."lineCostTotalKgs" IS NOT NULL OR l."unitCostKgs" IS NOT NULL))::int AS "returnCostWithoutOriginalEvidence",
        COUNT(l.id) FILTER (WHERE original."unitCostKgs" IS NOT NULL AND l."unitCostKgs" IS NOT NULL
          AND original."unitCostKgs" <> l."unitCostKgs")::int AS "changedReturnUnitCost"
      FROM "SaleReturn" r LEFT JOIN "SaleReturnLine" l ON l."saleReturnId" = r.id
      LEFT JOIN "CustomerOrderLine" original ON original.id = l."customerOrderLineId"
      WHERE r.status = 'COMPLETED' GROUP BY r."organizationId" ORDER BY r."organizationId"`;
      const amounts = await tx.$queryRaw<Array<Record<string, unknown>>>`
      SELECT o."organizationId", COUNT(*) FILTER (WHERE COALESCE(l.amount, 0) - o."discountKgs" <> o."totalKgs")::int AS "headerLineDifferences",
        COUNT(*) FILTER (WHERE COALESCE(l.lines, 0) = 0)::int AS "documentsWithoutLines"
      FROM "CustomerOrder" o LEFT JOIN LATERAL (
        SELECT SUM("lineTotalKgs") AS amount, COUNT(*) AS lines FROM "CustomerOrderLine" WHERE "customerOrderId" = o.id
      ) l ON true
      WHERE o.status = 'COMPLETED' AND NOT o."isHeld" GROUP BY o."organizationId" ORDER BY o."organizationId"`;
      const movementEvidence = await tx.$queryRaw<
        Array<{ organizationId: string; unknownLinesWithAnyMovementCost: number }>
      >`
      SELECT o."organizationId", COUNT(*)::int AS "unknownLinesWithAnyMovementCost"
      FROM "CustomerOrderLine" l JOIN "CustomerOrder" o ON o.id = l."customerOrderId"
      WHERE o.status = 'COMPLETED' AND NOT o."isHeld" AND l."unitCostKgs" IS NULL AND l."lineCostTotalKgs" IS NULL
        AND EXISTS (SELECT 1 FROM "StockMovement" m WHERE m."storeId" = o."storeId" AND m."productId" = l."productId"
          AND m."variantId" IS NOT DISTINCT FROM l."variantId" AND m."referenceType" = 'CustomerOrder' AND m."referenceId" = o.id
          AND m.type = 'SALE' AND (m."unitCostKgs" IS NOT NULL OR m."lineTotalKgs" IS NOT NULL))
      GROUP BY o."organizationId"`;
      const largest = [...sales].sort((a, b) => Number(b.lines) - Number(a.lines))[0];
      let performance = null;
      if (largest) {
        const organizationId = String(largest.organizationId);
        const stores = await tx.store.findMany({ where: { organizationId }, select: { id: true } });
        const dateTo = businessDateKey(new Date());
        const started = performanceNow();
        const report = await getSalesReport(tx, {
          organizationId,
          storeIds: stores.map((store) => store.id),
          dateFrom: addBusinessDays(dateTo, -365),
          dateTo,
          view: "products",
        });
        performance = {
          organizationId,
          historicalLines: largest.lines,
          elapsedMs: performanceNow() - started,
          selectedLines: report.totals.lineCount,
          groups: report.total,
          browserRows: report.items.length,
          days: report.series.length,
        };
      }
      return { sales, returns, amounts, movementEvidence, performance };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60_000 },
  );
  await mkdir("artifacts/reporting", { recursive: true });
  const path = `artifacts/reporting/${production ? "production" : "test"}-audit.json`;
  await writeFile(
    path,
    JSON.stringify(
      {
        generatedAt: new Date(),
        mode: "read-only",
        includesExistingQaOrganizations: true,
        method:
          "Recorded completed documents and nullable historical snapshots; current product prices are never substituted.",
        ...result,
      },
      null,
      2,
    ),
  );
  const sum = (rows: Array<Record<string, unknown>>) =>
    Object.fromEntries(
      [...new Set(rows.flatMap((row) => Object.keys(row)))]
        .filter((key) => key !== "organizationId")
        .map((key) => [key, rows.reduce((value, row) => value + Number(row[key] ?? 0), 0)]),
    );
  console.log(
    JSON.stringify({
      path,
      sales: sum(result.sales),
      returns: sum(result.returns),
      amounts: sum(result.amounts),
      movementEvidence: sum(result.movementEvidence),
      performance: result.performance,
    }),
  );
} finally {
  await db.$disconnect();
}

function performanceNow() {
  return Math.round(performance.now());
}
