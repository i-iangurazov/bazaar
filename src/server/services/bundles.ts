import { randomUUID } from "node:crypto";
import { StockMovementType } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { applyStockMovement } from "@/server/services/inventory";
import { withIdempotency } from "@/server/services/idempotency";
import { writeAuditLog } from "@/server/services/audit";
import { eventBus } from "@/server/events/eventBus";
import { toJson } from "@/server/services/json";

export const listBundleComponents = async (input: {
  bundleProductId: string;
  organizationId: string;
}) => {
  const product = await prisma.product.findUnique({ where: { id: input.bundleProductId } });
  if (!product || product.organizationId !== input.organizationId) {
    throw new AppError("productNotFound", "NOT_FOUND", 404);
  }

  return prisma.productBundleComponent.findMany({
    where: { bundleProductId: input.bundleProductId },
    select: {
      id: true,
      organizationId: true,
      bundleProductId: true,
      componentProductId: true,
      componentVariantId: true,
      qty: true,
      createdAt: true,
      updatedAt: true,
      componentProduct: {
        select: {
          id: true,
          name: true,
          sku: true,
        },
      },
      componentVariant: {
        select: {
          id: true,
          name: true,
          sku: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
};

export const addBundleComponent = async (input: {
  bundleProductId: string;
  componentProductId: string;
  componentVariantId?: string | null;
  qty: number;
  organizationId: string;
  actorId: string;
  requestId: string;
}) =>
  prisma.$transaction(async (tx) => {
    const bundle = await tx.product.findUnique({ where: { id: input.bundleProductId } });
    if (!bundle || bundle.organizationId !== input.organizationId) {
      throw new AppError("productNotFound", "NOT_FOUND", 404);
    }
    if (input.bundleProductId === input.componentProductId) {
      throw new AppError("bundleComponentInvalid", "BAD_REQUEST", 400);
    }
    const component = await tx.product.findUnique({ where: { id: input.componentProductId } });
    if (!component || component.organizationId !== input.organizationId) {
      throw new AppError("productNotFound", "NOT_FOUND", 404);
    }
    if (input.componentVariantId) {
      const variant = await tx.productVariant.findUnique({
        where: { id: input.componentVariantId },
      });
      if (!variant || variant.productId !== input.componentProductId || !variant.isActive) {
        throw new AppError("variantNotFound", "NOT_FOUND", 404);
      }
    }

    const componentLine = await tx.productBundleComponent.create({
      data: {
        organizationId: input.organizationId,
        bundleProductId: input.bundleProductId,
        componentProductId: input.componentProductId,
        componentVariantId: input.componentVariantId ?? undefined,
        qty: input.qty,
      },
    });

    await tx.product.update({
      where: { id: bundle.id },
      data: { isBundle: true },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "BUNDLE_COMPONENT_ADD",
      entity: "ProductBundleComponent",
      entityId: componentLine.id,
      before: null,
      after: toJson(componentLine),
      requestId: input.requestId,
    });

    return componentLine;
  });

export const removeBundleComponent = async (input: {
  componentId: string;
  organizationId: string;
  actorId: string;
  requestId: string;
}) =>
  prisma.$transaction(async (tx) => {
    const component = await tx.productBundleComponent.findUnique({ where: { id: input.componentId } });
    if (!component || component.organizationId !== input.organizationId) {
      throw new AppError("bundleComponentNotFound", "NOT_FOUND", 404);
    }

    const removed = await tx.productBundleComponent.delete({ where: { id: input.componentId } });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "BUNDLE_COMPONENT_REMOVE",
      entity: "ProductBundleComponent",
      entityId: removed.id,
      before: toJson(component),
      after: null,
      requestId: input.requestId,
    });

    return removed;
  });

export const assembleBundle = async (input: {
  storeId: string;
  bundleProductId: string;
  qty: number;
  actorId: string;
  organizationId: string;
  requestId: string;
  idempotencyKey: string;
}) => {
  let affectedProductIds: string[] = [];
  const result = await prisma.$transaction(async (tx) => {
    const { result } = await withIdempotency(
      tx,
      { key: input.idempotencyKey, route: "bundles.assemble", userId: input.actorId },
      async () => {
        const store = await tx.store.findUnique({ where: { id: input.storeId } });
        if (!store || store.organizationId !== input.organizationId) {
          throw new AppError("storeNotFound", "NOT_FOUND", 404);
        }

        const bundle = await tx.product.findUnique({
          where: { id: input.bundleProductId },
          include: { bundleComponents: true },
        });
        if (!bundle || bundle.organizationId !== input.organizationId) {
          throw new AppError("productNotFound", "NOT_FOUND", 404);
        }
        if (!bundle.bundleComponents.length) {
          throw new AppError("bundleEmpty", "BAD_REQUEST", 400);
        }

        const assemblyId = randomUUID();

        for (const component of bundle.bundleComponents) {
          const totalQty = component.qty * input.qty;
          if (totalQty <= 0) {
            continue;
          }
          await applyStockMovement(tx, {
            storeId: input.storeId,
            productId: component.componentProductId,
            variantId: component.componentVariantId ?? undefined,
            qtyDelta: -Math.abs(totalQty),
            type: StockMovementType.ADJUSTMENT,
            referenceType: "BUNDLE_ASSEMBLY",
            referenceId: assemblyId,
            note: `bundleAssemble:${bundle.sku}`,
            actorId: input.actorId,
            organizationId: input.organizationId,
          });
        }

        const bundleMovement = await applyStockMovement(tx, {
          storeId: input.storeId,
          productId: input.bundleProductId,
          qtyDelta: Math.abs(input.qty),
          type: StockMovementType.RECEIVE,
          referenceType: "BUNDLE_ASSEMBLY",
          referenceId: assemblyId,
          note: `bundleAssemble:${bundle.sku}`,
          actorId: input.actorId,
          organizationId: input.organizationId,
        });

        affectedProductIds = bundle.bundleComponents.map((component) => component.componentProductId);
        affectedProductIds.push(bundleMovement.snapshot.productId);

        await writeAuditLog(tx, {
          organizationId: input.organizationId,
          actorId: input.actorId,
          action: "BUNDLE_ASSEMBLE",
          entity: "Product",
          entityId: bundle.id,
          before: null,
          after: toJson({ qty: input.qty, assemblyId }),
          requestId: input.requestId,
        });

        return { assembled: true };
      },
    );

    return result;
  });

  affectedProductIds.forEach((productId) => {
    eventBus.publish({
      type: "inventory.updated",
      payload: { storeId: input.storeId, productId },
    });
  });

  return result;
};
