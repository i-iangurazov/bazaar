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

export const listPeriodCloses = async (organizationId: string, storeId?: string) => {
  return prisma.periodClose.findMany({
    where: { organizationId, ...(storeId ? { storeId } : {}) },
    orderBy: { closedAt: "desc" },
  });
};

export const closePeriod = async (input: ClosePeriodInput) => {
  const store = await prisma.store.findFirst({
    where: { id: input.storeId, organizationId: input.organizationId },
    select: { id: true },
  });
  if (!store) {
    throw new AppError("storeNotFound", "NOT_FOUND", 404);
  }

  const existing = await prisma.periodClose.findFirst({
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

  const movements = await prisma.stockMovement.findMany({
    where: {
      storeId: input.storeId,
      createdAt: { gte: input.periodStart, lte: input.periodEnd },
    },
    select: { productId: true, type: true, qtyDelta: true },
  });

  const skuCount = new Set(movements.map((movement) => movement.productId)).size;
  const movementCount = movements.length;
  const salesTotal = movements
    .filter((movement) => movement.type === StockMovementType.SALE)
    .reduce((sum, movement) => sum + Math.abs(movement.qtyDelta), 0);
  const purchasesTotal = movements
    .filter((movement) => movement.type === StockMovementType.RECEIVE)
    .reduce((sum, movement) => sum + Math.abs(movement.qtyDelta), 0);

  const totals = {
    salesTotalKgs: salesTotal,
    purchasesTotalKgs: purchasesTotal,
    movementCount,
    skuCount,
  };

  const close = await prisma.periodClose.create({
    data: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      closedById: input.closedById,
      totals: totals ? (toJson(totals) as Prisma.InputJsonValue) : Prisma.DbNull,
    },
  });

  await writeAuditLog(prisma, {
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
};
