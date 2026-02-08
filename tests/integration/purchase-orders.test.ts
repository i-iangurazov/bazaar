import { beforeEach, describe, expect, it } from "vitest";
import { PurchaseOrderStatus, StockMovementType } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import {
  createPurchaseOrder,
  createDraftsFromReorder,
  receivePurchaseOrder,
  approvePurchaseOrder,
} from "@/server/services/purchaseOrders";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { createTestCaller } from "../helpers/context";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("purchase orders", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("receives purchase orders idempotently with partial receipts", async () => {
    const { org, store, supplier, product, adminUser, baseUnit } = await seedBase();

    const po = await createPurchaseOrder({
      organizationId: org.id,
      storeId: store.id,
      supplierId: supplier.id,
      lines: [{ productId: product.id, qtyOrdered: 5 }],
      actorId: adminUser.id,
      requestId: "req-po-create",
      submit: true,
    });

    await approvePurchaseOrder({
      purchaseOrderId: po.id,
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-po-approve",
    });

    const idempotencyKey = "po-receive-123";

    await receivePurchaseOrder({
      purchaseOrderId: po.id,
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-po-1",
      idempotencyKey,
      lines: [{ lineId: po.lines[0].id, qtyReceived: 2 }],
    });

    await receivePurchaseOrder({
      purchaseOrderId: po.id,
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-po-2",
      idempotencyKey,
      lines: [{ lineId: po.lines[0].id, qtyReceived: 2 }],
    });

    const receipts = await prisma.stockMovement.findMany({
      where: {
        storeId: store.id,
        productId: product.id,
        type: StockMovementType.RECEIVE,
        referenceId: po.id,
      },
    });

    const updatedPo = await prisma.purchaseOrder.findUnique({
      where: { id: po.id },
      include: { lines: true },
    });

    expect(receipts).toHaveLength(1);
    expect(updatedPo?.status).toBe(PurchaseOrderStatus.PARTIALLY_RECEIVED);
    expect(updatedPo?.lines[0]?.qtyReceived).toBe(2);

    await receivePurchaseOrder({
      purchaseOrderId: po.id,
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-po-3",
      idempotencyKey: "po-receive-final",
      lines: [{ lineId: po.lines[0].id, qtyReceived: 3 }],
    });

    const finalPo = await prisma.purchaseOrder.findUnique({
      where: { id: po.id },
      include: { lines: true },
    });
    const finalReceipts = await prisma.stockMovement.findMany({
      where: {
        storeId: store.id,
        productId: product.id,
        type: StockMovementType.RECEIVE,
        referenceId: po.id,
      },
    });

    expect(finalReceipts).toHaveLength(2);
    expect(finalPo?.status).toBe(PurchaseOrderStatus.RECEIVED);
    expect(finalPo?.lines[0]?.qtyReceived).toBe(5);
  });

  it("blocks over-receive by default", async () => {
    const { org, store, supplier, product, adminUser, baseUnit } = await seedBase();

    const po = await createPurchaseOrder({
      organizationId: org.id,
      storeId: store.id,
      supplierId: supplier.id,
      lines: [{ productId: product.id, qtyOrdered: 2 }],
      actorId: adminUser.id,
      requestId: "req-po-create",
      submit: true,
    });

    await approvePurchaseOrder({
      purchaseOrderId: po.id,
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-po-approve",
    });

    await expect(
      receivePurchaseOrder({
        purchaseOrderId: po.id,
        actorId: adminUser.id,
        organizationId: org.id,
        requestId: "req-po-over",
        idempotencyKey: "po-receive-over",
        lines: [{ lineId: po.lines[0].id, qtyReceived: 5 }],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects invalid state transitions", async () => {
    const { org, store, supplier, product, adminUser, baseUnit } = await seedBase();

    const po = await prisma.purchaseOrder.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        supplierId: supplier.id,
        status: PurchaseOrderStatus.DRAFT,
        createdById: adminUser.id,
        updatedById: adminUser.id,
        lines: {
          create: [{ productId: product.id, qtyOrdered: 3 }],
        },
      },
    });

    await expect(
      approvePurchaseOrder({
        purchaseOrderId: po.id,
        actorId: adminUser.id,
        organizationId: org.id,
        requestId: "req-po-approve",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("enforces RBAC on approve/receive", async () => {
    const { org, store, supplier, product, staffUser } = await seedBase();

    const po = await prisma.purchaseOrder.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        supplierId: supplier.id,
        status: PurchaseOrderStatus.SUBMITTED,
        submittedAt: new Date(),
        createdById: staffUser.id,
        updatedById: staffUser.id,
        lines: {
          create: [{ productId: product.id, qtyOrdered: 3 }],
        },
      },
    });

    const caller = createTestCaller({
      id: staffUser.id,
      email: staffUser.email,
      role: staffUser.role,
      organizationId: staffUser.organizationId!,
    });

    await expect(caller.purchaseOrders.approve({ purchaseOrderId: po.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    const approved = await prisma.purchaseOrder.update({
      where: { id: po.id },
      data: { status: PurchaseOrderStatus.APPROVED, approvedAt: new Date() },
    });

    await expect(
      caller.purchaseOrders.receive({ purchaseOrderId: approved.id, idempotencyKey: "idem-po-rbac" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("creates draft purchase orders from reorder items grouped by supplier", async () => {
    const { org, store, supplier, product, adminUser, baseUnit } = await seedBase();

    const supplier2 = await prisma.supplier.create({
      data: { organizationId: org.id, name: "Supplier Two" },
    });
    const product2 = await prisma.product.create({
      data: {
        organizationId: org.id,
        supplierId: supplier2.id,
        sku: "TEST-2",
        name: "Second Product",
        unit: baseUnit.code,
        baseUnitId: baseUnit.id,
      },
    });

    const result = await createDraftsFromReorder({
      organizationId: org.id,
      storeId: store.id,
      actorId: adminUser.id,
      requestId: "req-po-reorder",
      idempotencyKey: "po-reorder-1",
      items: [
        { productId: product.id, qtyOrdered: 3, supplierId: supplier.id },
        { productId: product2.id, qtyOrdered: 4 },
      ],
    });

    expect(result.purchaseOrders).toHaveLength(2);

    const poCount = await prisma.purchaseOrder.count({ where: { organizationId: org.id } });
    expect(poCount).toBe(2);

    const drafts = await prisma.purchaseOrder.findMany({
      where: { organizationId: org.id },
      include: { lines: true },
    });
    expect(drafts.every((po) => po.status === PurchaseOrderStatus.DRAFT)).toBe(true);
    expect(drafts.reduce((sum, po) => sum + po.lines.length, 0)).toBe(2);
  });
});
