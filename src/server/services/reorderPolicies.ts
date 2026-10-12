import { randomUUID } from "node:crypto";

import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { writeAuditLog } from "@/server/services/audit";
import { toJson } from "@/server/services/json";

export type SetMinStockInput = {
  storeId: string;
  productId: string;
  minStock: number;
  organizationId: string;
  actorId: string;
  requestId: string;
};

export type SetDefaultMinStockInput = {
  storeId: string;
  minStock: number;
  organizationId: string;
  actorId: string;
  requestId: string;
};

const defaultPolicy = {
  leadTimeDays: 7,
  reviewPeriodDays: 7,
  safetyStockDays: 3,
  minOrderQty: 0,
};

export const setMinStock = async (input: SetMinStockInput) =>
  prisma.$transaction(async (tx) => {
    const store = await tx.store.findUnique({ where: { id: input.storeId } });
    if (!store || store.organizationId !== input.organizationId) {
      throw new AppError("storeNotFound", "NOT_FOUND", 404);
    }

    const product = await tx.product.findUnique({ where: { id: input.productId } });
    if (!product || product.organizationId !== input.organizationId || product.isDeleted) {
      throw new AppError("productNotFound", "NOT_FOUND", 404);
    }

    const before = await tx.reorderPolicy.findUnique({
      where: { storeId_productId: { storeId: input.storeId, productId: input.productId } },
    });

    const policy = await tx.reorderPolicy.upsert({
      where: { storeId_productId: { storeId: input.storeId, productId: input.productId } },
      update: { minStock: input.minStock },
      create: {
        storeId: input.storeId,
        productId: input.productId,
        minStock: input.minStock,
        ...defaultPolicy,
      },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "REORDER_POLICY_UPDATE",
      entity: "ReorderPolicy",
      entityId: policy.id,
      before: before ? toJson(before) : null,
      after: toJson(policy),
      requestId: input.requestId,
    });

    return policy;
  });

export const setDefaultMinStock = async (input: SetDefaultMinStockInput) =>
  prisma.$transaction(async (tx) => {
    const store = await tx.store.findUnique({ where: { id: input.storeId } });
    if (!store || store.organizationId !== input.organizationId) {
      throw new AppError("storeNotFound", "NOT_FOUND", 404);
    }

    // One statement avoids a database round trip for every product. Only the
    // selected store's active assortment participates; physical stock is untouched.
    const count = await tx.$executeRaw`
      INSERT INTO "ReorderPolicy" (
        "id", "storeId", "productId", "minStock", "leadTimeDays", "reviewPeriodDays",
        "safetyStockDays", "minOrderQty", "createdAt", "updatedAt"
      )
      SELECT ${randomUUID()} || ':' || sp."productId", ${input.storeId}, sp."productId", ${input.minStock},
        ${defaultPolicy.leadTimeDays}, ${defaultPolicy.reviewPeriodDays},
        ${defaultPolicy.safetyStockDays}, ${defaultPolicy.minOrderQty}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM "StoreProduct" sp
      WHERE sp."organizationId" = ${input.organizationId}
        AND sp."storeId" = ${input.storeId}
        AND sp."isActive" = true
        -- A primary-key lookup stays bounded when statistics lag behind a large import.
        AND (
          SELECT p."organizationId" = ${input.organizationId} AND NOT p."isDeleted"
          FROM "Product" p WHERE p."id" = sp."productId"
        )
      ORDER BY sp."productId"
      ON CONFLICT ("storeId", "productId") DO UPDATE
        SET "minStock" = EXCLUDED."minStock", "updatedAt" = EXCLUDED."updatedAt"
    `;

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "REORDER_POLICY_BULK_SET",
      entity: "Store",
      entityId: store.id,
      before: null,
      after: toJson({ storeId: store.id, minStock: input.minStock, count }),
      requestId: input.requestId,
    });

    return { count };
  });
