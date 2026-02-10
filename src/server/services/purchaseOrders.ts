import { randomUUID } from "node:crypto";
import type { InventorySnapshot, Prisma } from "@prisma/client";
import { PurchaseOrderStatus, StockMovementType } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { writeAuditLog } from "@/server/services/audit";
import { applyStockMovement } from "@/server/services/inventory";
import { withIdempotency } from "@/server/services/idempotency";
import { eventBus } from "@/server/events/eventBus";
import { getLogger } from "@/server/logging";
import { toJson } from "@/server/services/json";
import { updateProductCost } from "@/server/services/productCost";
import { applyStockLotAdjustment } from "@/server/services/stockLots";
import { resolveBaseQuantity } from "@/server/services/uom";
import { recordFirstEvent } from "@/server/services/productEvents";

const allowedTransitions: Record<PurchaseOrderStatus, PurchaseOrderStatus[]> = {
  DRAFT: [PurchaseOrderStatus.SUBMITTED, PurchaseOrderStatus.CANCELLED],
  SUBMITTED: [PurchaseOrderStatus.APPROVED, PurchaseOrderStatus.CANCELLED],
  APPROVED: [PurchaseOrderStatus.PARTIALLY_RECEIVED, PurchaseOrderStatus.RECEIVED],
  PARTIALLY_RECEIVED: [PurchaseOrderStatus.RECEIVED],
  RECEIVED: [],
  CANCELLED: [],
};

const assertTransition = (from: PurchaseOrderStatus, to: PurchaseOrderStatus) => {
  if (!allowedTransitions[from]?.includes(to)) {
    throw new AppError("invalidTransition", "CONFLICT", 409);
  }
};

const assertDraft = (status: PurchaseOrderStatus) => {
  if (status !== PurchaseOrderStatus.DRAFT) {
    throw new AppError("poNotEditable", "CONFLICT", 409);
  }
};

const assertUniqueLines = (
  lines: CreatePurchaseOrderInput["lines"],
) => {
  const seen = new Set<string>();
  for (const line of lines) {
    const key = `${line.productId}:${line.variantId ?? "BASE"}`;
    if (seen.has(key)) {
      throw new AppError("duplicateLineItem", "CONFLICT", 409);
    }
    seen.add(key);
  }
};

const lockInventorySnapshot = async (
  tx: Prisma.TransactionClient,
  storeId: string,
  productId: string,
  variantId: string | null,
  variantKey: string,
  allowNegativeStock: boolean,
): Promise<InventorySnapshot> => {
  const snapshotCreatedAt = new Date();
  await tx.$executeRaw`
    INSERT INTO "InventorySnapshot" ("id", "storeId", "productId", "variantId", "variantKey", "onHand", "onOrder", "allowNegativeStock", "updatedAt")
    VALUES (${randomUUID()}, ${storeId}, ${productId}, ${variantId}, ${variantKey}, 0, 0, ${allowNegativeStock}, ${snapshotCreatedAt})
    ON CONFLICT ("storeId", "productId", "variantKey") DO NOTHING;
  `;

  const rows = await tx.$queryRaw<InventorySnapshot[]>`
    SELECT * FROM "InventorySnapshot"
    WHERE "storeId" = ${storeId} AND "productId" = ${productId} AND "variantKey" = ${variantKey}
    FOR UPDATE
  `;

  const snapshot = rows[0];
  if (!snapshot) {
    throw new AppError("snapshotMissing", "NOT_FOUND", 404);
  }

  return snapshot;
};

const adjustOnOrder = async (
  tx: Prisma.TransactionClient,
  storeId: string,
  productId: string,
  variantId: string | null,
  delta: number,
  allowNegativeStock: boolean,
) => {
  const variantKey = variantId ?? "BASE";
  const snapshot = await lockInventorySnapshot(
    tx,
    storeId,
    productId,
    variantId,
    variantKey,
    allowNegativeStock,
  );
  const nextOnOrder = snapshot.onOrder + delta;
  if (nextOnOrder < 0) {
    throw new AppError("onOrderNegative", "CONFLICT", 409);
  }

  return tx.inventorySnapshot.update({
    where: { id: snapshot.id },
    data: {
      onOrder: nextOnOrder,
      allowNegativeStock,
    },
  });
};

export type CreatePurchaseOrderInput = {
  organizationId: string;
  storeId: string;
  supplierId?: string | null;
  lines: {
    productId: string;
    variantId?: string | null;
    qtyOrdered: number;
    unitCost?: number | null;
    unitId?: string | null;
    packId?: string | null;
  }[];
  actorId: string;
  requestId: string;
  submit?: boolean;
};

export type CreateDraftsFromReorderInput = {
  organizationId: string;
  storeId: string;
  actorId: string;
  requestId: string;
  idempotencyKey: string;
  items: {
    productId: string;
    variantId?: string | null;
    qtyOrdered: number;
    supplierId?: string | null;
  }[];
};

export const createPurchaseOrder = async (input: CreatePurchaseOrderInput) => {
  const logger = getLogger(input.requestId);
  let affectedProductIds: string[] = [];
  let affectedStoreId = input.storeId;

  assertUniqueLines(input.lines);

  const result = await prisma.$transaction(async (tx) => {
    const store = await tx.store.findUnique({ where: { id: input.storeId } });
    if (!store) {
      throw new AppError("storeNotFound", "NOT_FOUND", 404);
    }
    if (store.organizationId !== input.organizationId) {
      throw new AppError("storeOrgMismatch", "FORBIDDEN", 403);
    }

    let resolvedSupplierId: string | null = null;
    if (input.supplierId) {
      const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
      if (!supplier || supplier.organizationId !== input.organizationId) {
        throw new AppError("supplierNotFound", "NOT_FOUND", 404);
      }
      resolvedSupplierId = supplier.id;
    }

    const productIds = input.lines.map((line) => line.productId);
    const products = await tx.product.findMany({
      where: { id: { in: productIds }, organizationId: input.organizationId, isDeleted: false },
      select: { id: true, baseUnitId: true },
    });
    if (products.length !== productIds.length) {
      throw new AppError("invalidProducts", "BAD_REQUEST", 400);
    }
    const baseUnitMap = new Map(products.map((product) => [product.id, product.baseUnitId]));

    const variantIds = input.lines.map((line) => line.variantId).filter(Boolean) as string[];
    if (variantIds.length) {
      const variants = await tx.productVariant.findMany({
        where: { id: { in: variantIds }, isActive: true },
        select: { id: true, productId: true },
      });
      if (variants.length !== variantIds.length) {
        throw new AppError("variantNotFound", "NOT_FOUND", 404);
      }
      const variantMap = new Map<string, string>(
        (variants as { id: string; productId: string }[]).map((variant) => [
          variant.id,
          variant.productId,
        ]),
      );
      for (const line of input.lines) {
        if (line.variantId && variantMap.get(line.variantId) !== line.productId) {
          throw new AppError("variantMismatch", "BAD_REQUEST", 400);
        }
      }
    }

    const normalizedLines = await Promise.all(
      input.lines.map(async (line) => {
        const baseUnitId = baseUnitMap.get(line.productId);
        if (!baseUnitId) {
          throw new AppError("productNotFound", "NOT_FOUND", 404);
        }
        const qtyOrdered = await resolveBaseQuantity(tx, {
          organizationId: input.organizationId,
          productId: line.productId,
          baseUnitId,
          qty: line.qtyOrdered,
          unitId: line.unitId,
          packId: line.packId,
          mode: "purchasing",
        });
        return { ...line, qtyOrdered };
      }),
    );

    const po = await tx.purchaseOrder.create({
      data: {
        organizationId: input.organizationId,
        storeId: input.storeId,
        supplierId: resolvedSupplierId,
        status: input.submit ? PurchaseOrderStatus.SUBMITTED : PurchaseOrderStatus.DRAFT,
        submittedAt: input.submit ? new Date() : null,
        createdById: input.actorId,
        updatedById: input.actorId,
        lines: {
          create: normalizedLines.map((line) => ({
            productId: line.productId,
            variantId: line.variantId ?? undefined,
            variantKey: line.variantId ?? "BASE",
            qtyOrdered: line.qtyOrdered,
            unitCost: line.unitCost ?? undefined,
          })),
        },
      },
      include: { lines: true },
    });

    if (input.submit) {
      for (const line of po.lines) {
        await adjustOnOrder(
          tx,
          input.storeId,
          line.productId,
          line.variantId,
          line.qtyOrdered,
          store.allowNegativeStock,
        );
      }
    }

    affectedProductIds = po.lines.map((line) => line.productId);
    affectedStoreId = po.storeId;

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "PO_CREATE",
      entity: "PurchaseOrder",
      entityId: po.id,
      before: null,
      after: toJson(po),
      requestId: input.requestId,
    });

    return po;
  });

  await recordFirstEvent({
    organizationId: input.organizationId,
    actorId: input.actorId,
    type: "first_po_created",
    metadata: { purchaseOrderId: result.id },
  });

  eventBus.publish({
    type: "purchaseOrder.updated",
    payload: { poId: result.id, status: result.status },
  });

  if (input.submit) {
    for (const productId of affectedProductIds) {
      eventBus.publish({
        type: "inventory.updated",
        payload: { storeId: affectedStoreId, productId },
      });
    }
  }

  logger.info({ poId: result.id, status: result.status }, "purchase order created");

  return result;
};

export const createDraftsFromReorder = async (input: CreateDraftsFromReorderInput) => {
  const logger = getLogger(input.requestId);

  const result = await prisma.$transaction(async (tx) => {
    const { result: drafts } = await withIdempotency(
      tx,
      {
        key: input.idempotencyKey,
        route: "purchaseOrders.createFromReorder",
        userId: input.actorId,
      },
      async () => {
        const store = await tx.store.findUnique({ where: { id: input.storeId } });
        if (!store || store.organizationId !== input.organizationId) {
          throw new AppError("storeNotFound", "NOT_FOUND", 404);
        }

        const productIds = input.items.map((item) => item.productId);
        const products = await tx.product.findMany({
          where: { id: { in: productIds }, organizationId: input.organizationId, isDeleted: false },
          select: { id: true, supplierId: true },
        });
        if (products.length !== productIds.length) {
          throw new AppError("invalidProducts", "BAD_REQUEST", 400);
        }
        const productMap = new Map(products.map((product) => [product.id, product]));

        const variantIds = input.items.map((item) => item.variantId).filter(Boolean) as string[];
        if (variantIds.length) {
          const variants = await tx.productVariant.findMany({
            where: { id: { in: variantIds }, isActive: true },
            select: { id: true, productId: true },
          });
          if (variants.length !== variantIds.length) {
            throw new AppError("variantNotFound", "NOT_FOUND", 404);
          }
          const variantMap = new Map(variants.map((variant) => [variant.id, variant.productId]));
          for (const item of input.items) {
            if (item.variantId && variantMap.get(item.variantId) !== item.productId) {
              throw new AppError("variantMismatch", "BAD_REQUEST", 400);
            }
          }
        }

        const itemsWithSupplier = input.items.map((item) => {
          const product = productMap.get(item.productId);
          const supplierId = item.supplierId ?? product?.supplierId ?? null;
          if (!supplierId) {
            throw new AppError("supplierRequired", "BAD_REQUEST", 400);
          }
          return { ...item, supplierId };
        });

        const supplierIds = Array.from(new Set(itemsWithSupplier.map((item) => item.supplierId)));
        const suppliers = await tx.supplier.findMany({
          where: { id: { in: supplierIds }, organizationId: input.organizationId },
          select: { id: true },
        });
        if (suppliers.length !== supplierIds.length) {
          throw new AppError("supplierNotFound", "NOT_FOUND", 404);
        }

        const grouped = new Map<string, CreatePurchaseOrderInput["lines"]>();
        for (const item of itemsWithSupplier) {
          const lines = grouped.get(item.supplierId!) ?? [];
          lines.push({
            productId: item.productId,
            variantId: item.variantId,
            qtyOrdered: item.qtyOrdered,
            unitCost: null,
          });
          grouped.set(item.supplierId!, lines);
        }

        const created: { id: string; supplierId: string }[] = [];
        for (const [supplierId, lines] of grouped.entries()) {
          assertUniqueLines(lines);
          const po = await tx.purchaseOrder.create({
            data: {
              organizationId: input.organizationId,
              storeId: input.storeId,
              supplierId,
              status: PurchaseOrderStatus.DRAFT,
              createdById: input.actorId,
              updatedById: input.actorId,
              lines: {
                create: lines.map((line) => ({
                  productId: line.productId,
                  variantId: line.variantId ?? undefined,
                  variantKey: line.variantId ?? "BASE",
                  qtyOrdered: line.qtyOrdered,
                  unitCost: line.unitCost ?? undefined,
                })),
              },
            },
          });

          await writeAuditLog(tx, {
            organizationId: input.organizationId,
            actorId: input.actorId,
            action: "PO_CREATE",
            entity: "PurchaseOrder",
            entityId: po.id,
            before: null,
            after: toJson(po),
            requestId: input.requestId,
          });

          created.push({ id: po.id, supplierId });
        }

        return { purchaseOrders: created };
      },
    );

    return drafts;
  });

  for (const draft of result.purchaseOrders) {
    eventBus.publish({
      type: "purchaseOrder.updated",
      payload: { poId: draft.id, status: PurchaseOrderStatus.DRAFT },
    });
  }

  logger.info({ count: result.purchaseOrders.length }, "draft purchase orders created");

  return result;
};

export const submitPurchaseOrder = async (input: {
  purchaseOrderId: string;
  actorId: string;
  organizationId: string;
  requestId: string;
}) => {
  const logger = getLogger(input.requestId);
  let affectedProductIds: string[] = [];
  let affectedStoreId = "";

  const result = await prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({
      where: { id: input.purchaseOrderId },
      include: { lines: true, store: true },
    });

    if (!po) {
      throw new AppError("poNotFound", "NOT_FOUND", 404);
    }
    if (po.organizationId !== input.organizationId) {
      throw new AppError("poOrgMismatch", "FORBIDDEN", 403);
    }

    assertTransition(po.status, PurchaseOrderStatus.SUBMITTED);
    if (!po.lines.length) {
      throw new AppError("poEmpty", "BAD_REQUEST", 400);
    }

    const updated = await tx.purchaseOrder.update({
      where: { id: po.id },
      data: {
        status: PurchaseOrderStatus.SUBMITTED,
        submittedAt: new Date(),
        updatedById: input.actorId,
      },
    });

    for (const line of po.lines) {
      await adjustOnOrder(
        tx,
        po.storeId,
        line.productId,
        line.variantId,
        line.qtyOrdered,
        po.store.allowNegativeStock,
      );
    }

    affectedProductIds = po.lines.map((line) => line.productId);
    affectedStoreId = po.storeId;

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "PO_SUBMIT",
      entity: "PurchaseOrder",
      entityId: po.id,
      before: toJson({ status: po.status }),
      after: toJson({ status: updated.status }),
      requestId: input.requestId,
    });

    return updated;
  });

  eventBus.publish({
    type: "purchaseOrder.updated",
    payload: { poId: result.id, status: result.status },
  });

  for (const productId of affectedProductIds) {
    eventBus.publish({
      type: "inventory.updated",
      payload: { storeId: affectedStoreId, productId },
    });
  }

  logger.info({ poId: result.id }, "purchase order submitted");

  return result;
};

export const approvePurchaseOrder = async (input: {
  purchaseOrderId: string;
  actorId: string;
  organizationId: string;
  requestId: string;
}) => {
  const logger = getLogger(input.requestId);

  const result = await prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({
      where: { id: input.purchaseOrderId },
    });

    if (!po) {
      throw new AppError("poNotFound", "NOT_FOUND", 404);
    }
    if (po.organizationId !== input.organizationId) {
      throw new AppError("poOrgMismatch", "FORBIDDEN", 403);
    }

    assertTransition(po.status, PurchaseOrderStatus.APPROVED);

    const updated = await tx.purchaseOrder.update({
      where: { id: po.id },
      data: {
        status: PurchaseOrderStatus.APPROVED,
        approvedAt: new Date(),
        updatedById: input.actorId,
      },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "PO_APPROVE",
      entity: "PurchaseOrder",
      entityId: po.id,
      before: toJson({ status: po.status }),
      after: toJson({ status: updated.status }),
      requestId: input.requestId,
    });

    return updated;
  });

  eventBus.publish({
    type: "purchaseOrder.updated",
    payload: { poId: result.id, status: result.status },
  });

  logger.info({ poId: result.id }, "purchase order approved");

  return result;
};

export const receivePurchaseOrder = async (input: {
  purchaseOrderId: string;
  actorId: string;
  organizationId: string;
  requestId: string;
  idempotencyKey: string;
  lines?: { lineId: string; qtyReceived: number; unitId?: string | null; packId?: string | null }[];
  allowOverReceive?: boolean;
}) => {
  const logger = getLogger(input.requestId);
  let affectedProductIds: string[] = [];
  let affectedStoreId = "";

  const result = await prisma.$transaction(async (tx) => {
    const { result: receipt } = await withIdempotency(
      tx,
      {
        key: input.idempotencyKey,
        route: "purchaseOrders.receive",
        userId: input.actorId,
      },
      async () => {
        await tx.$queryRaw`
          SELECT id FROM "PurchaseOrder" WHERE id = ${input.purchaseOrderId} FOR UPDATE
        `;

        const po = await tx.purchaseOrder.findUnique({
          where: { id: input.purchaseOrderId },
          include: { lines: true, store: true },
        });

        if (!po) {
          throw new AppError("poNotFound", "NOT_FOUND", 404);
        }
        if (po.organizationId !== input.organizationId) {
          throw new AppError("poOrgMismatch", "FORBIDDEN", 403);
        }

        if (po.status === PurchaseOrderStatus.RECEIVED) {
          return { id: po.id, status: po.status };
        }

        const canReceive =
          po.status === PurchaseOrderStatus.APPROVED ||
          po.status === PurchaseOrderStatus.PARTIALLY_RECEIVED;
        if (!canReceive) {
          throw new AppError("invalidTransition", "CONFLICT", 409);
        }

        const productIds = Array.from(new Set(po.lines.map((line) => line.productId)));
        const products = await tx.product.findMany({
          where: { id: { in: productIds }, organizationId: input.organizationId },
          select: { id: true, baseUnitId: true },
        });
        if (products.length !== productIds.length) {
          throw new AppError("invalidProducts", "BAD_REQUEST", 400);
        }
        const baseUnitMap = new Map(products.map((product) => [product.id, product.baseUnitId]));

        const requestedLines = input.lines?.length
          ? input.lines
          : po.lines
              .map((line) => ({
                lineId: line.id,
                qtyReceived: Math.max(0, line.qtyOrdered - line.qtyReceived),
                unitId: undefined,
                packId: undefined,
              }))
              .filter((line) => line.qtyReceived > 0);

        if (!requestedLines.length) {
          throw new AppError("poReceiveEmpty", "BAD_REQUEST", 400);
        }

        const lineRequestMap = new Map<string, number>();
        for (const request of requestedLines) {
          const line = po.lines.find((poLine) => poLine.id === request.lineId);
          if (!line) {
            throw new AppError("poLineNotFound", "NOT_FOUND", 404);
          }
          const baseUnitId = baseUnitMap.get(line.productId);
          if (!baseUnitId) {
            throw new AppError("productNotFound", "NOT_FOUND", 404);
          }
          const qtyReceived = await resolveBaseQuantity(tx, {
            organizationId: input.organizationId,
            productId: line.productId,
            baseUnitId,
            qty: request.qtyReceived,
            unitId: request.unitId,
            packId: request.packId,
            mode: "receiving",
          });
          lineRequestMap.set(line.id, qtyReceived);
        }

        const updatedLineTotals = new Map<string, number>();

        for (const line of po.lines) {
          const receiveQty = lineRequestMap.get(line.id);
          if (!receiveQty) {
            updatedLineTotals.set(line.id, line.qtyReceived);
            continue;
          }

          const remaining = line.qtyOrdered - line.qtyReceived;
          if (!input.allowOverReceive && receiveQty > remaining) {
            throw new AppError("poOverReceiveNotAllowed", "CONFLICT", 409);
          }

          const movement = await applyStockMovement(tx, {
            storeId: po.storeId,
            productId: line.productId,
            variantId: line.variantId,
            qtyDelta: receiveQty,
            type: StockMovementType.RECEIVE,
            referenceType: "PURCHASE_ORDER",
            referenceId: po.id,
            actorId: input.actorId,
            organizationId: input.organizationId,
          });

          const lot = await applyStockLotAdjustment(tx, {
            storeId: po.storeId,
            productId: line.productId,
            variantId: line.variantId ?? undefined,
            qtyDelta: receiveQty,
            expiryDate: null,
            organizationId: input.organizationId,
          });
          if (lot) {
            await tx.stockMovement.update({
              where: { id: movement.movementId },
              data: { stockLotId: lot.id },
            });
          }

          const onOrderDelta = -Math.min(receiveQty, Math.max(remaining, 0));
          if (onOrderDelta !== 0) {
            await adjustOnOrder(
              tx,
              po.storeId,
              line.productId,
              line.variantId,
              onOrderDelta,
              po.store.allowNegativeStock,
            );
          }

          if (line.unitCost !== null) {
            await updateProductCost(tx, {
              organizationId: input.organizationId,
              productId: line.productId,
              variantId: line.variantId ?? undefined,
              qtyReceived: receiveQty,
              unitCost: Number(line.unitCost),
            });
          }

          const nextReceived = line.qtyReceived + receiveQty;
          updatedLineTotals.set(line.id, nextReceived);

          await tx.purchaseOrderLine.update({
            where: { id: line.id },
            data: { qtyReceived: nextReceived },
          });
        }

        affectedProductIds = po.lines.map((line) => line.productId);
        affectedStoreId = po.storeId;

        const hasRemaining = po.lines.some((line) => {
          const received = updatedLineTotals.get(line.id) ?? line.qtyReceived;
          return received < line.qtyOrdered;
        });
        const nextStatus = hasRemaining
          ? PurchaseOrderStatus.PARTIALLY_RECEIVED
          : PurchaseOrderStatus.RECEIVED;

        if (nextStatus !== po.status) {
          assertTransition(po.status, nextStatus);
        }

        const updated = await tx.purchaseOrder.update({
          where: { id: po.id },
          data: {
            status: nextStatus,
            receivedAt: nextStatus === PurchaseOrderStatus.RECEIVED ? new Date() : null,
            receivedEventId:
              nextStatus === PurchaseOrderStatus.RECEIVED ? input.idempotencyKey : null,
            updatedById: input.actorId,
          },
        });

        await writeAuditLog(tx, {
          organizationId: input.organizationId,
          actorId: input.actorId,
          action: "PO_RECEIVE",
          entity: "PurchaseOrder",
          entityId: po.id,
          before: toJson({ status: po.status }),
          after: toJson({ status: updated.status }),
          requestId: input.requestId,
        });

        return { id: updated.id, status: updated.status };
      },
    );

    return receipt;
  });

  eventBus.publish({
    type: "purchaseOrder.updated",
    payload: { poId: result.id, status: result.status },
  });

  for (const productId of affectedProductIds) {
    eventBus.publish({
      type: "inventory.updated",
      payload: { storeId: affectedStoreId, productId },
    });
  }

  logger.info({ poId: result.id }, "purchase order received");

  if (result.status === PurchaseOrderStatus.RECEIVED) {
    await recordFirstEvent({
      organizationId: input.organizationId,
      actorId: input.actorId,
      type: "first_po_received",
      metadata: { purchaseOrderId: result.id },
    });
  }

  return result;
};

export const cancelPurchaseOrder = async (input: {
  purchaseOrderId: string;
  actorId: string;
  organizationId: string;
  requestId: string;
}) => {
  const logger = getLogger(input.requestId);
  let affectedProductIds: string[] = [];
  let affectedStoreId = "";

  const result = await prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({
      where: { id: input.purchaseOrderId },
      include: { lines: true, store: true },
    });

    if (!po) {
      throw new AppError("poNotFound", "NOT_FOUND", 404);
    }
    if (po.organizationId !== input.organizationId) {
      throw new AppError("poOrgMismatch", "FORBIDDEN", 403);
    }

    assertTransition(po.status, PurchaseOrderStatus.CANCELLED);

    if (po.status === PurchaseOrderStatus.SUBMITTED) {
      for (const line of po.lines) {
        await adjustOnOrder(
          tx,
          po.storeId,
          line.productId,
          line.variantId,
          -line.qtyOrdered,
          po.store.allowNegativeStock,
        );
      }
      affectedProductIds = po.lines.map((line) => line.productId);
      affectedStoreId = po.storeId;
    }

    const updated = await tx.purchaseOrder.update({
      where: { id: po.id },
      data: {
        status: PurchaseOrderStatus.CANCELLED,
        updatedById: input.actorId,
      },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "PO_CANCEL",
      entity: "PurchaseOrder",
      entityId: po.id,
      before: toJson({ status: po.status }),
      after: toJson({ status: updated.status }),
      requestId: input.requestId,
    });

    return updated;
  });

  eventBus.publish({
    type: "purchaseOrder.updated",
    payload: { poId: result.id, status: result.status },
  });

  for (const productId of affectedProductIds) {
    eventBus.publish({
      type: "inventory.updated",
      payload: { storeId: affectedStoreId, productId },
    });
  }

  logger.info({ poId: result.id }, "purchase order cancelled");

  return result;
};

export const addPurchaseOrderLine = async (input: {
  purchaseOrderId: string;
  productId: string;
  variantId?: string | null;
  qtyOrdered: number;
  unitCost?: number | null;
  unitId?: string | null;
  packId?: string | null;
  actorId: string;
  organizationId: string;
  requestId: string;
}) => {
  const logger = getLogger(input.requestId);

  const result = await prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({
      where: { id: input.purchaseOrderId },
    });

    if (!po) {
      throw new AppError("poNotFound", "NOT_FOUND", 404);
    }
    if (po.organizationId !== input.organizationId) {
      throw new AppError("poOrgMismatch", "FORBIDDEN", 403);
    }

    assertDraft(po.status);

    const product = await tx.product.findFirst({
      where: {
        id: input.productId,
        organizationId: input.organizationId,
        isDeleted: false,
      },
      select: { id: true, baseUnitId: true, organizationId: true },
    });
    if (!product) {
      throw new AppError("productNotFound", "NOT_FOUND", 404);
    }

    const qtyOrdered = await resolveBaseQuantity(tx, {
      organizationId: input.organizationId,
      productId: input.productId,
      baseUnitId: product.baseUnitId,
      qty: input.qtyOrdered,
      unitId: input.unitId,
      packId: input.packId,
      mode: "purchasing",
    });

    if (input.variantId) {
      const variant = await tx.productVariant.findUnique({ where: { id: input.variantId } });
      if (!variant || !variant.isActive) {
        throw new AppError("variantNotFound", "NOT_FOUND", 404);
      }
      if (variant.productId !== input.productId) {
        throw new AppError("variantMismatch", "BAD_REQUEST", 400);
      }
    }

    const variantKey = input.variantId ?? "BASE";
    const existing = await tx.purchaseOrderLine.findUnique({
      where: {
        purchaseOrderId_productId_variantKey: {
          purchaseOrderId: po.id,
          productId: input.productId,
          variantKey,
        },
      },
    });
    if (existing) {
      throw new AppError("duplicateLineItem", "CONFLICT", 409);
    }

    const line = await tx.purchaseOrderLine.create({
      data: {
        purchaseOrderId: po.id,
        productId: input.productId,
        variantId: input.variantId ?? undefined,
        variantKey,
        qtyOrdered,
        unitCost: input.unitCost ?? undefined,
      },
    });

    await tx.purchaseOrder.update({
      where: { id: po.id },
      data: { updatedById: input.actorId },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "PO_LINE_ADD",
      entity: "PurchaseOrder",
      entityId: po.id,
      before: null,
      after: toJson(line),
      requestId: input.requestId,
    });

    return line;
  });

  eventBus.publish({
    type: "purchaseOrder.updated",
    payload: { poId: input.purchaseOrderId, status: "DRAFT" },
  });

  logger.info({ poId: input.purchaseOrderId }, "purchase order line added");

  return result;
};

export const updatePurchaseOrderLine = async (input: {
  lineId: string;
  qtyOrdered: number;
  unitCost?: number | null;
  unitId?: string | null;
  packId?: string | null;
  actorId: string;
  organizationId: string;
  requestId: string;
}) => {
  const logger = getLogger(input.requestId);

  const result = await prisma.$transaction(async (tx) => {
    const line = await tx.purchaseOrderLine.findUnique({
      where: { id: input.lineId },
      include: { purchaseOrder: true },
    });

    if (!line) {
      throw new AppError("poLineNotFound", "NOT_FOUND", 404);
    }
    if (line.purchaseOrder.organizationId !== input.organizationId) {
      throw new AppError("poOrgMismatch", "FORBIDDEN", 403);
    }

    assertDraft(line.purchaseOrder.status);

    const product = await tx.product.findUnique({
      where: { id: line.productId },
      select: { baseUnitId: true, organizationId: true },
    });
    if (!product || product.organizationId !== input.organizationId) {
      throw new AppError("productNotFound", "NOT_FOUND", 404);
    }

    const qtyOrdered = await resolveBaseQuantity(tx, {
      organizationId: input.organizationId,
      productId: line.productId,
      baseUnitId: product.baseUnitId,
      qty: input.qtyOrdered,
      unitId: input.unitId,
      packId: input.packId,
      mode: "purchasing",
    });

    const updated = await tx.purchaseOrderLine.update({
      where: { id: line.id },
      data: {
        qtyOrdered,
        unitCost: input.unitCost ?? null,
      },
    });

    await tx.purchaseOrder.update({
      where: { id: line.purchaseOrderId },
      data: { updatedById: input.actorId },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "PO_LINE_UPDATE",
      entity: "PurchaseOrder",
      entityId: line.purchaseOrderId,
      before: toJson(line),
      after: toJson(updated),
      requestId: input.requestId,
    });

    return updated;
  });

  eventBus.publish({
    type: "purchaseOrder.updated",
    payload: { poId: result.purchaseOrderId, status: "DRAFT" },
  });

  logger.info({ lineId: input.lineId }, "purchase order line updated");

  return result;
};

export const removePurchaseOrderLine = async (input: {
  lineId: string;
  actorId: string;
  organizationId: string;
  requestId: string;
}) => {
  const logger = getLogger(input.requestId);

  const result = await prisma.$transaction(async (tx) => {
    const line = await tx.purchaseOrderLine.findUnique({
      where: { id: input.lineId },
      include: { purchaseOrder: true },
    });

    if (!line) {
      throw new AppError("poLineNotFound", "NOT_FOUND", 404);
    }
    if (line.purchaseOrder.organizationId !== input.organizationId) {
      throw new AppError("poOrgMismatch", "FORBIDDEN", 403);
    }

    assertDraft(line.purchaseOrder.status);

    const deleted = await tx.purchaseOrderLine.delete({
      where: { id: line.id },
    });

    await tx.purchaseOrder.update({
      where: { id: line.purchaseOrderId },
      data: { updatedById: input.actorId },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "PO_LINE_REMOVE",
      entity: "PurchaseOrder",
      entityId: line.purchaseOrderId,
      before: toJson(line),
      after: null,
      requestId: input.requestId,
    });

    return deleted;
  });

  eventBus.publish({
    type: "purchaseOrder.updated",
    payload: { poId: result.purchaseOrderId, status: "DRAFT" },
  });

  logger.info({ lineId: input.lineId }, "purchase order line removed");

  return result;
};
