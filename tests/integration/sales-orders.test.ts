import { beforeEach, describe, expect, it } from "vitest";
import { CustomerOrderStatus, StockMovementType } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { adjustStock } from "@/server/services/inventory";

import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("sales orders", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("creates draft with initial lines and optional customer fields", async () => {
    const { org, store, product, adminUser } = await seedBase();

    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
    });

    const order = await caller.salesOrders.createDraft({
      storeId: store.id,
      customerName: null,
      customerPhone: null,
      lines: [{ productId: product.id, qty: 2 }],
    });

    const dbOrder = await prisma.customerOrder.findUnique({
      where: { id: order.id },
      include: { lines: true },
    });

    expect(dbOrder).toBeTruthy();
    expect(dbOrder?.customerName).toBeNull();
    expect(dbOrder?.customerPhone).toBeNull();
    expect(dbOrder?.lines).toHaveLength(1);
    expect(dbOrder?.lines[0]?.qty).toBe(2);
  });

  it("completes customer order and creates SALE ledger movements", async () => {
    const { org, store, product, adminUser } = await seedBase();

    await adjustStock({
      organizationId: org.id,
      actorId: adminUser.id,
      storeId: store.id,
      productId: product.id,
      qtyDelta: 10,
      reason: "seed",
      idempotencyKey: "seed-sales-1",
      requestId: "req-sales-seed-1",
    });

    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
    });

    const order = await caller.salesOrders.createDraft({ storeId: store.id, customerName: "Client A" });
    await caller.salesOrders.addLine({
      customerOrderId: order.id,
      productId: product.id,
      qty: 2,
    });
    await caller.salesOrders.confirm({ customerOrderId: order.id });
    await caller.salesOrders.markReady({ customerOrderId: order.id });
    await caller.salesOrders.complete({
      customerOrderId: order.id,
      idempotencyKey: "sales-complete-1",
    });

    const dbOrder = await prisma.customerOrder.findUnique({ where: { id: order.id } });
    const saleMovements = await prisma.stockMovement.findMany({
      where: {
        storeId: store.id,
        productId: product.id,
        type: StockMovementType.SALE,
        referenceId: order.id,
      },
    });
    const snapshot = await prisma.inventorySnapshot.findUnique({
      where: {
        storeId_productId_variantKey: {
          storeId: store.id,
          productId: product.id,
          variantKey: "BASE",
        },
      },
    });

    expect(dbOrder?.status).toBe(CustomerOrderStatus.COMPLETED);
    expect(saleMovements).toHaveLength(1);
    expect(saleMovements[0]?.qtyDelta).toBe(-2);
    expect(snapshot?.onHand).toBe(8);
  });

  it("keeps complete idempotent", async () => {
    const { org, store, product, adminUser } = await seedBase();

    await adjustStock({
      organizationId: org.id,
      actorId: adminUser.id,
      storeId: store.id,
      productId: product.id,
      qtyDelta: 10,
      reason: "seed",
      idempotencyKey: "seed-sales-2",
      requestId: "req-sales-seed-2",
    });

    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
    });

    const order = await caller.salesOrders.createDraft({ storeId: store.id, customerName: "Client B" });
    await caller.salesOrders.addLine({
      customerOrderId: order.id,
      productId: product.id,
      qty: 3,
    });
    await caller.salesOrders.confirm({ customerOrderId: order.id });
    await caller.salesOrders.markReady({ customerOrderId: order.id });

    const idempotencyKey = "sales-complete-idem";
    await caller.salesOrders.complete({ customerOrderId: order.id, idempotencyKey });
    await caller.salesOrders.complete({ customerOrderId: order.id, idempotencyKey });

    const saleMovements = await prisma.stockMovement.findMany({
      where: {
        storeId: store.id,
        productId: product.id,
        type: StockMovementType.SALE,
        referenceId: order.id,
      },
    });
    const snapshot = await prisma.inventorySnapshot.findUnique({
      where: {
        storeId_productId_variantKey: {
          storeId: store.id,
          productId: product.id,
          variantKey: "BASE",
        },
      },
    });

    expect(saleMovements).toHaveLength(1);
    expect(snapshot?.onHand).toBe(7);
  });

  it("blocks staff from complete and cancel", async () => {
    const { org, store, product, adminUser, staffUser } = await seedBase();

    await adjustStock({
      organizationId: org.id,
      actorId: adminUser.id,
      storeId: store.id,
      productId: product.id,
      qtyDelta: 5,
      reason: "seed",
      idempotencyKey: "seed-sales-3",
      requestId: "req-sales-seed-3",
    });

    const adminCaller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
    });

    const order = await adminCaller.salesOrders.createDraft({ storeId: store.id });
    await adminCaller.salesOrders.addLine({ customerOrderId: order.id, productId: product.id, qty: 1 });
    await adminCaller.salesOrders.confirm({ customerOrderId: order.id });
    await adminCaller.salesOrders.markReady({ customerOrderId: order.id });

    const staffCaller = createTestCaller({
      id: staffUser.id,
      email: staffUser.email,
      role: staffUser.role,
      organizationId: org.id,
    });

    await expect(
      staffCaller.salesOrders.complete({
        customerOrderId: order.id,
        idempotencyKey: "sales-complete-rbac",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(staffCaller.salesOrders.cancel({ customerOrderId: order.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("stores bundle line unit cost snapshot from bundle components", async () => {
    const { org, store, supplier, baseUnit, adminUser } = await seedBase();

    const componentA = await prisma.product.create({
      data: {
        organizationId: org.id,
        supplierId: supplier.id,
        sku: "COMP-A",
        name: "Component A",
        unit: baseUnit.code,
        baseUnitId: baseUnit.id,
        basePriceKgs: 100,
      },
    });
    const componentB = await prisma.product.create({
      data: {
        organizationId: org.id,
        supplierId: supplier.id,
        sku: "COMP-B",
        name: "Component B",
        unit: baseUnit.code,
        baseUnitId: baseUnit.id,
        basePriceKgs: 80,
      },
    });
    const bundle = await prisma.product.create({
      data: {
        organizationId: org.id,
        supplierId: supplier.id,
        sku: "BUNDLE-1",
        name: "Bundle 1",
        isBundle: true,
        unit: baseUnit.code,
        baseUnitId: baseUnit.id,
        basePriceKgs: 250,
      },
    });

    await prisma.productBundleComponent.createMany({
      data: [
        {
          organizationId: org.id,
          bundleProductId: bundle.id,
          componentProductId: componentA.id,
          qty: 2,
        },
        {
          organizationId: org.id,
          bundleProductId: bundle.id,
          componentProductId: componentB.id,
          qty: 1,
        },
      ],
    });
    await prisma.productCost.createMany({
      data: [
        {
          organizationId: org.id,
          productId: componentA.id,
          variantKey: "BASE",
          avgCostKgs: 40,
        },
        {
          organizationId: org.id,
          productId: componentB.id,
          variantKey: "BASE",
          avgCostKgs: 60,
        },
      ],
    });

    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
    });

    const order = await caller.salesOrders.createDraft({ storeId: store.id });
    const line = await caller.salesOrders.addLine({
      customerOrderId: order.id,
      productId: bundle.id,
      qty: 3,
    });

    expect(line.unitCostKgs).toBe(140);
    expect(line.lineCostTotalKgs).toBe(420);
  });

  it("returns revenue/cost/profit metrics with bundle split", async () => {
    const { org, store, supplier, baseUnit, adminUser } = await seedBase();

    const component = await prisma.product.create({
      data: {
        organizationId: org.id,
        supplierId: supplier.id,
        sku: "COMP-METRIC",
        name: "Component Metric",
        unit: baseUnit.code,
        baseUnitId: baseUnit.id,
        basePriceKgs: 20,
      },
    });
    const product = await prisma.product.create({
      data: {
        organizationId: org.id,
        supplierId: supplier.id,
        sku: "PROD-METRIC",
        name: "Product Metric",
        unit: baseUnit.code,
        baseUnitId: baseUnit.id,
        basePriceKgs: 100,
      },
    });
    const bundle = await prisma.product.create({
      data: {
        organizationId: org.id,
        supplierId: supplier.id,
        sku: "BUNDLE-METRIC",
        name: "Bundle Metric",
        isBundle: true,
        unit: baseUnit.code,
        baseUnitId: baseUnit.id,
        basePriceKgs: 50,
      },
    });

    await prisma.productBundleComponent.create({
      data: {
        organizationId: org.id,
        bundleProductId: bundle.id,
        componentProductId: component.id,
        qty: 2,
      },
    });
    await prisma.productCost.createMany({
      data: [
        {
          organizationId: org.id,
          productId: product.id,
          variantKey: "BASE",
          avgCostKgs: 30,
        },
        {
          organizationId: org.id,
          productId: component.id,
          variantKey: "BASE",
          avgCostKgs: 10,
        },
      ],
    });

    await adjustStock({
      organizationId: org.id,
      actorId: adminUser.id,
      storeId: store.id,
      productId: product.id,
      qtyDelta: 10,
      reason: "seed-product",
      idempotencyKey: "seed-sales-product-metric",
      requestId: "req-sales-product-metric",
    });
    await adjustStock({
      organizationId: org.id,
      actorId: adminUser.id,
      storeId: store.id,
      productId: bundle.id,
      qtyDelta: 10,
      reason: "seed-bundle",
      idempotencyKey: "seed-sales-bundle-metric",
      requestId: "req-sales-bundle-metric",
    });

    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
    });

    const order = await caller.salesOrders.createDraft({ storeId: store.id });
    await caller.salesOrders.addLine({ customerOrderId: order.id, productId: product.id, qty: 2 });
    await caller.salesOrders.addLine({ customerOrderId: order.id, productId: bundle.id, qty: 1 });
    await caller.salesOrders.confirm({ customerOrderId: order.id });
    await caller.salesOrders.markReady({ customerOrderId: order.id });
    await caller.salesOrders.complete({
      customerOrderId: order.id,
      idempotencyKey: "sales-metrics-order-complete",
    });

    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(now);
    dayEnd.setHours(23, 59, 59, 999);
    const metrics = await caller.salesOrders.metrics({
      dateFrom: dayStart,
      dateTo: dayEnd,
      groupBy: "day",
    });

    expect(metrics.summary.totalRevenueKgs).toBe(250);
    expect(metrics.summary.totalCostKgs).toBe(80);
    expect(metrics.summary.totalProfitKgs).toBe(170);
    expect(metrics.summary.ordersCount).toBe(1);
    expect(metrics.topProductsByRevenue.some((item) => item.productId === product.id)).toBe(true);
    expect(metrics.topBundlesByRevenue.some((item) => item.productId === bundle.id)).toBe(true);
  });
});
