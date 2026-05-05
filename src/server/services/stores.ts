import { StockMovementType, type LegalEntityType } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { writeAuditLog } from "@/server/services/audit";
import { toJson } from "@/server/services/json";
import { assertWithinLimits } from "@/server/services/planLimits";

export type UpdateStorePolicyInput = {
  storeId: string;
  allowNegativeStock: boolean;
  trackExpiryLots: boolean;
  organizationId: string;
  actorId: string;
  requestId: string;
};

export type CreateStoreInput = {
  organizationId: string;
  actorId: string;
  requestId: string;
  name: string;
  code: string;
  allowNegativeStock: boolean;
  trackExpiryLots: boolean;
  legalEntityType?: LegalEntityType | null;
  legalName?: string | null;
  inn?: string | null;
  address?: string | null;
  phone?: string | null;
  cloneFromStoreId?: string | null;
  copyInventory?: boolean;
  stockQuantityDelta?: number;
  priceAdjustmentMode?: "none" | "percentage" | "amount";
  priceAdjustmentValue?: number;
};

const roundMoney = (value: number) => Math.round(value * 100) / 100;

const resolveAdjustedPrice = ({
  price,
  mode,
  value,
}: {
  price: number;
  mode: "none" | "percentage" | "amount";
  value: number;
}) => {
  let next = price;
  if (mode === "percentage") {
    next = price * (1 + value / 100);
  } else if (mode === "amount") {
    next = price + value;
  }
  if (!Number.isFinite(next) || next < 0) {
    return 0;
  }
  return roundMoney(next);
};

export const createStore = async (input: CreateStoreInput) =>
  prisma.$transaction(async (tx) => {
    await assertWithinLimits({ organizationId: input.organizationId, kind: "stores" });
    const inn = normalizeOptional(input.inn);
    if (inn && !/^\d{10,14}$/.test(inn)) {
      throw new AppError("invalidInn", "BAD_REQUEST", 400);
    }

    const store = await tx.store.create({
      data: {
        organizationId: input.organizationId,
        name: input.name,
        code: input.code,
        allowNegativeStock: input.allowNegativeStock,
        trackExpiryLots: input.trackExpiryLots,
        legalEntityType: input.legalEntityType ?? null,
        legalName: normalizeOptional(input.legalName),
        inn,
        address: normalizeOptional(input.address),
        phone: normalizeOptional(input.phone),
      },
    });

    let cloneSummary:
      | {
          sourceStoreId: string;
          inventorySnapshots: number;
          stockMovements: number;
	          storePrices: number;
	          reorderPolicies: number;
	          storeProducts: number;
	        }
      | null = null;

    const cloneFromStoreId = normalizeOptional(input.cloneFromStoreId);
    if (cloneFromStoreId) {
      const sourceStore = await tx.store.findUnique({
        where: { id: cloneFromStoreId },
        select: { id: true, organizationId: true, name: true },
      });
      if (!sourceStore || sourceStore.organizationId !== input.organizationId) {
        throw new AppError("storeNotFound", "NOT_FOUND", 404);
      }

      const copyInventory = input.copyInventory ?? false;
      const stockQuantityDelta = Math.trunc(input.stockQuantityDelta ?? 0);
      const priceAdjustmentMode = input.priceAdjustmentMode ?? "none";
      const priceAdjustmentValue = input.priceAdjustmentValue ?? 0;

	      const [sourceSnapshots, sourcePrices, sourceReorderPolicies, sourceStoreProducts] = await Promise.all([
        copyInventory
          ? tx.inventorySnapshot.findMany({
              where: {
                storeId: cloneFromStoreId,
                product: {
                  organizationId: input.organizationId,
                  isDeleted: false,
                },
              },
              select: {
                productId: true,
                variantId: true,
                variantKey: true,
                onHand: true,
                onOrder: true,
              },
            })
          : Promise.resolve([]),
        tx.storePrice.findMany({
          where: {
            organizationId: input.organizationId,
            storeId: cloneFromStoreId,
            product: { isDeleted: false },
          },
          select: {
            productId: true,
            variantId: true,
            variantKey: true,
            priceKgs: true,
          },
        }),
	        tx.reorderPolicy.findMany({
          where: {
            storeId: cloneFromStoreId,
            product: {
              organizationId: input.organizationId,
              isDeleted: false,
            },
          },
          select: {
            productId: true,
            minStock: true,
            leadTimeDays: true,
            reviewPeriodDays: true,
            safetyStockDays: true,
            minOrderQty: true,
	          },
	        }),
	        tx.storeProduct.findMany({
	          where: {
	            organizationId: input.organizationId,
	            storeId: cloneFromStoreId,
	            isActive: true,
	            product: { isDeleted: false },
	          },
	          select: { productId: true },
	        }),
	      ]);

      const nextSnapshots = sourceSnapshots.map((snapshot) => ({
        storeId: store.id,
        productId: snapshot.productId,
        variantId: snapshot.variantId,
        variantKey: snapshot.variantKey,
        onHand: Math.max(0, snapshot.onHand + stockQuantityDelta),
        onOrder: snapshot.onOrder,
        allowNegativeStock: input.allowNegativeStock,
      }));

      if (nextSnapshots.length) {
        await tx.inventorySnapshot.createMany({ data: nextSnapshots });
      }

      const stockMovements = nextSnapshots
        .filter((snapshot) => snapshot.onHand !== 0)
        .map((snapshot) => ({
          storeId: store.id,
          productId: snapshot.productId,
          variantId: snapshot.variantId,
          type: StockMovementType.ADJUSTMENT,
          qtyDelta: snapshot.onHand,
          referenceType: "STORE_CLONE",
          referenceId: store.id,
          note: `Copied from ${sourceStore.name}`,
          createdById: input.actorId,
        }));
      if (stockMovements.length) {
        await tx.stockMovement.createMany({ data: stockMovements });
      }

      const nextPrices = sourcePrices.map((price) => ({
        organizationId: input.organizationId,
        storeId: store.id,
        productId: price.productId,
        variantId: price.variantId,
        variantKey: price.variantKey,
        priceKgs: resolveAdjustedPrice({
          price: Number(price.priceKgs),
          mode: priceAdjustmentMode,
          value: priceAdjustmentValue,
        }),
        updatedById: input.actorId,
      }));
      if (nextPrices.length) {
        await tx.storePrice.createMany({ data: nextPrices });
      }

      const nextReorderPolicies = sourceReorderPolicies.map((policy) => ({
        storeId: store.id,
        productId: policy.productId,
        minStock: policy.minStock,
        leadTimeDays: policy.leadTimeDays,
        reviewPeriodDays: policy.reviewPeriodDays,
        safetyStockDays: policy.safetyStockDays,
        minOrderQty: policy.minOrderQty,
      }));
	      if (nextReorderPolicies.length) {
	        await tx.reorderPolicy.createMany({ data: nextReorderPolicies });
	      }

	      const assignedProductIds = Array.from(
	        new Set([
	          ...sourceStoreProducts.map((row) => row.productId),
	          ...sourceSnapshots.map((row) => row.productId),
	          ...sourcePrices.map((row) => row.productId),
	          ...sourceReorderPolicies.map((row) => row.productId),
	        ]),
	      );
	      if (assignedProductIds.length) {
	        await tx.storeProduct.createMany({
	          data: assignedProductIds.map((productId) => ({
	            organizationId: input.organizationId,
	            storeId: store.id,
	            productId,
	            assignedById: input.actorId,
	            isActive: true,
	          })),
	          skipDuplicates: true,
	        });
	      }

	      cloneSummary = {
	        sourceStoreId: sourceStore.id,
	        inventorySnapshots: nextSnapshots.length,
	        stockMovements: stockMovements.length,
	        storePrices: nextPrices.length,
	        reorderPolicies: nextReorderPolicies.length,
	        storeProducts: assignedProductIds.length,
	      };
    }

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "STORE_CREATE",
      entity: "Store",
      entityId: store.id,
      before: null,
      after: toJson({ store, cloneSummary }),
      requestId: input.requestId,
    });

    return { ...store, cloneSummary };
  });

export type UpdateStoreInput = {
  storeId: string;
  organizationId: string;
  actorId: string;
  requestId: string;
  name: string;
  code: string;
};

export const updateStore = async (input: UpdateStoreInput) =>
  prisma.$transaction(async (tx) => {
    const store = await tx.store.findUnique({ where: { id: input.storeId } });
    if (!store || store.organizationId !== input.organizationId) {
      throw new AppError("storeNotFound", "NOT_FOUND", 404);
    }

    const updated = await tx.store.update({
      where: { id: input.storeId },
      data: { name: input.name, code: input.code },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "STORE_UPDATE",
      entity: "Store",
      entityId: updated.id,
      before: toJson(store),
      after: toJson(updated),
      requestId: input.requestId,
    });

    return updated;
  });

export const updateStorePolicy = async (input: UpdateStorePolicyInput) =>
  prisma.$transaction(async (tx) => {
    const store = await tx.store.findUnique({ where: { id: input.storeId } });
    if (!store || store.organizationId !== input.organizationId) {
      throw new AppError("storeNotFound", "NOT_FOUND", 404);
    }

    const updated = await tx.store.update({
      where: { id: input.storeId },
      data: { allowNegativeStock: input.allowNegativeStock, trackExpiryLots: input.trackExpiryLots },
    });

    await tx.inventorySnapshot.updateMany({
      where: { storeId: input.storeId },
      data: { allowNegativeStock: input.allowNegativeStock },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "STORE_POLICY_UPDATE",
      entity: "Store",
      entityId: updated.id,
      before: toJson(store),
      after: toJson(updated),
      requestId: input.requestId,
    });

    return updated;
  });

export type UpdateStoreLegalDetailsInput = {
  storeId: string;
  organizationId: string;
  actorId: string;
  requestId: string;
  legalEntityType?: LegalEntityType | null;
  legalName?: string | null;
  inn?: string | null;
  address?: string | null;
  phone?: string | null;
};

const normalizeOptional = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export const updateStoreLegalDetails = async (input: UpdateStoreLegalDetailsInput) =>
  prisma.$transaction(async (tx) => {
    const store = await tx.store.findUnique({ where: { id: input.storeId } });
    if (!store || store.organizationId !== input.organizationId) {
      throw new AppError("storeNotFound", "NOT_FOUND", 404);
    }

    const inn = normalizeOptional(input.inn);
    if (inn && !/^\d{10,14}$/.test(inn)) {
      throw new AppError("invalidInn", "BAD_REQUEST", 400);
    }

    const updated = await tx.store.update({
      where: { id: input.storeId },
      data: {
        legalEntityType: input.legalEntityType ?? null,
        legalName: normalizeOptional(input.legalName),
        inn,
        address: normalizeOptional(input.address),
        phone: normalizeOptional(input.phone),
      },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "STORE_LEGAL_UPDATE",
      entity: "Store",
      entityId: updated.id,
      before: toJson(store),
      after: toJson(updated),
      requestId: input.requestId,
    });

    return updated;
  });
