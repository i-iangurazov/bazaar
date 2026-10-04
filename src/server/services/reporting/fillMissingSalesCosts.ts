import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { writeAuditLog } from "@/server/services/audit";
import { readBaamAccessScope } from "@/server/services/baamMetrics";
import { AppError } from "@/server/services/errors";
import { assertReportEntities } from "./access";
import { salesEventsSql, type SalesReportInput } from "./sales";

/** An explicit correction using today's cost, never an implicit report fallback. */
export async function fillMissingSalesCosts(
  actor: { id: string; organizationId: string },
  input: Omit<SalesReportInput, "organizationId" | "storeIds"> & { storeId?: string },
  requestId: string,
) {
  return prisma.$transaction(
    async (tx) => {
      const access = await readBaamAccessScope(tx, actor.id, input.storeId);
      if (
        access.organizationId !== actor.organizationId ||
        !["ADMIN", "MANAGER"].includes(access.role)
      )
        throw new AppError("forbidden", "FORBIDDEN", 403);
      await assertReportEntities(tx, access, input);
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          productId: string;
          variantKey: string;
          unitCostKgs: string;
          lineCostTotalKgs: string;
        }>
      >(Prisma.sql`
      ${salesEventsSql({ ...input, organizationId: access.organizationId, storeIds: access.storeIds })},
      eligible AS (
        SELECT e.id, c."avgCostKgs" FROM events e
        JOIN "ProductCost" c ON c."organizationId" = ${access.organizationId}
          AND c."productId" = e."productId" AND c."variantKey" = e."variantKey"
        WHERE e.period = 'current' AND e.kind = 'sale' AND e.cost IS NULL
          AND e.qty > 0 AND c."avgCostKgs" > 0
      )
      UPDATE "CustomerOrderLine" line
      SET "unitCostKgs" = eligible."avgCostKgs",
          "lineCostTotalKgs" = ROUND(eligible."avgCostKgs" * line.qty, 2)
      FROM eligible
      WHERE line.id = eligible.id AND line.qty > 0
        AND line."unitCostKgs" IS NULL AND line."lineCostTotalKgs" IS NULL
      RETURNING line.id, line."productId", line."variantKey",
        line."unitCostKgs"::text, line."lineCostTotalKgs"::text
    `);
      if (rows.length)
        await writeAuditLog(tx, {
          organizationId: access.organizationId,
          actorId: actor.id,
          requestId,
          action: "SALES_MISSING_COST_FILLED",
          entity: "SalesReport",
          entityId: actor.organizationId,
          before: {
            source: "missing_sale_snapshot",
            dateFrom: input.dateFrom,
            dateTo: input.dateTo,
            storeIds: access.storeIds,
          },
          after: { source: "current_product_cost", count: rows.length, lines: rows },
        });
      return { updatedLines: rows.length };
    },
    { timeout: 30_000 },
  );
}
