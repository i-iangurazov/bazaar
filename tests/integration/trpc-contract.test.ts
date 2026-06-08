import { beforeEach, describe, expect, it } from "vitest";
import { PurchaseOrderStatus } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { createTestCaller } from "../helpers/context";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("tRPC contract smoke", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("runs core mutations end-to-end", async () => {
    const { org, store, supplier, adminUser, baseUnit } = await seedBase();
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });

    const product = await caller.products.create({
      sku: "SKU-CORE",
      name: "Core Product",
      baseUnitId: baseUnit.id,
      barcodes: ["CORE-001"],
    });

    await caller.stores.updatePolicy({
      storeId: store.id,
      allowNegativeStock: false,
      trackExpiryLots: false,
    });

    await caller.inventory.receive({
      storeId: store.id,
      productId: product.id,
      qtyReceived: 10,
      idempotencyKey: "idem-core-receive",
    });

    await caller.inventory.adjust({
      storeId: store.id,
      productId: product.id,
      qtyDelta: -2,
      reason: "Shrink",
      idempotencyKey: "idem-core-adjust",
    });

    const storeB = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: "Secondary Store",
        code: "SEC",
        allowNegativeStock: false,
      },
    });

    await caller.inventory.transfer({
      fromStoreId: store.id,
      toStoreId: storeB.id,
      productId: product.id,
      qty: 3,
      idempotencyKey: "idem-core-transfer",
    });

    const po = await caller.purchaseOrders.create({
      storeId: store.id,
      supplierId: supplier.id,
      lines: [{ productId: product.id, qtyOrdered: 4 }],
      submit: false,
    });

    await caller.purchaseOrders.submit({ purchaseOrderId: po.id });
    await caller.purchaseOrders.approve({ purchaseOrderId: po.id });
    await caller.purchaseOrders.receive({
      purchaseOrderId: po.id,
      idempotencyKey: "idem-core-po-receive",
    });

    const updatedPo = await prisma.purchaseOrder.findUnique({ where: { id: po.id } });
    expect(updatedPo?.status).toBe(PurchaseOrderStatus.RECEIVED);
  });

  it("returns TRPC errors for invalid inventory adjustments", async () => {
    const { org, store, product, adminUser } = await seedBase();
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });

    await expect(
      caller.inventory.adjust({
        storeId: store.id,
        productId: product.id,
        qtyDelta: -5,
        reason: "Too low",
        idempotencyKey: "idem-core-negative",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
