import { Prisma, StockMovementType } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { writeAuditLog } from "@/server/services/audit";
import { toJson } from "@/server/services/json";

type ClosePeriodInput = {
  organizationId: string;
  storeId: string;
  periodStart: Date;
  periodEnd: Date;
  closedById: string;
  requestId: string;
};

export const listPeriodCloses = async (
  organizationId: string,
  storeId?: string,
  storeIds?: string[],
) => {
  return prisma.periodClose.findMany({
    where: {
      organizationId,
      ...(storeId ? { storeId } : storeIds ? { storeId: { in: storeIds } } : {}),
    },
    orderBy: { closedAt: "desc" },
  });
};

export const closePeriod = async (input: ClosePeriodInput) => {
  try {
    return await prisma.$transaction(async (tx) => {
      const store = await tx.store.findFirst({
        where: { id: input.storeId, organizationId: input.organizationId },
        select: { id: true },
      });
      if (!store) {
        throw new AppError("storeNotFound", "NOT_FOUND", 404);
      }

      const existing = await tx.periodClose.findFirst({
        where: {
          organizationId: input.organizationId,
          storeId: input.storeId,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
        },
      });
      if (existing) {
        throw new AppError("periodAlreadyClosed", "CONFLICT", 409);
      }

      const [movements, completedSales] = await Promise.all([
        tx.stockMovement.findMany({
          where: {
            storeId: input.storeId,
            createdAt: { gte: input.periodStart, lte: input.periodEnd },
          },
          select: {
            productId: true,
            type: true,
            qtyDelta: true,
            unitCostKgs: true,
            lineTotalKgs: true,
          },
        }),
        tx.customerOrder.aggregate({
          where: {
            organizationId: input.organizationId,
            storeId: input.storeId,
            status: "COMPLETED",
            completedAt: { gte: input.periodStart, lte: input.periodEnd },
          },
          _sum: { totalKgs: true },
        }),
      ]);

      const movementValueKgs = (movement: (typeof movements)[number]) => {
        if (movement.lineTotalKgs !== null) {
          return movement.lineTotalKgs.abs();
        }
        if (movement.unitCostKgs !== null) {
          return movement.unitCostKgs.mul(Math.abs(movement.qtyDelta));
        }
        return new Prisma.Decimal(0);
      };
      const skuCount = new Set(movements.map((movement) => movement.productId)).size;
      const movementCount = movements.length;
      // Gross completed-order revenue after order discounts. Returns/refunds remain
      // separate documents and do not reduce this gross sales field.
      const salesTotal = new Prisma.Decimal(completedSales._sum.totalKgs ?? 0)
        .toDecimalPlaces(2)
        .toNumber();
      const purchasesTotal = movements
        .filter((movement) => movement.type === StockMovementType.RECEIVE)
        .reduce((sum, movement) => sum.add(movementValueKgs(movement)), new Prisma.Decimal(0))
        .toDecimalPlaces(2)
        .toNumber();

      const totals = {
        salesTotalKgs: salesTotal,
        purchasesTotalKgs: purchasesTotal,
        movementCount,
        skuCount,
      };

      const close = await tx.periodClose.create({
        data: {
          organizationId: input.organizationId,
          storeId: input.storeId,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          closedById: input.closedById,
          totals: toJson(totals) as Prisma.InputJsonValue,
        },
      });

      await writeAuditLog(tx, {
        organizationId: input.organizationId,
        actorId: input.closedById,
        action: "PERIOD_CLOSED",
        entity: "PeriodClose",
        entityId: close.id,
        before: Prisma.DbNull,
        after: toJson(close),
        requestId: input.requestId,
      });

      return close;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("periodAlreadyClosed", "CONFLICT", 409);
    }
    throw error;
  }
};
