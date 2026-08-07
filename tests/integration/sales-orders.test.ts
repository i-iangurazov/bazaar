import { beforeEach, describe, expect, it } from "vitest";
import {
  EmailAutomationStatus,
  EmailAutomationTrigger,
  CustomerOrderEmailStatus,
  CustomerOrderEmailType,
  CustomerOrderStatus,
  StockMovementType,
} from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { runJob } from "@/server/jobs";
import { CUSTOMER_ORDER_FOLLOW_UP_JOB_NAME } from "@/server/jobs/customerOrderFollowUps";
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
      idempotencyKey: "sales-create-initial-lines",
      storeId: store.id,
      customerName: null,
      customerPhone: null,
      customerAddress: "Bishkek, Chui 1",
      lines: [{ productId: product.id, qty: 2 }],
    });

    const dbOrder = await prisma.customerOrder.findUnique({
      where: { id: order.id },
      include: { lines: true },
    });

    expect(dbOrder).toBeTruthy();
    expect(dbOrder?.customerName).toBeNull();
    expect(dbOrder?.customerPhone).toBeNull();
    expect(dbOrder?.customerAddress).toBe("Bishkek, Chui 1");
    expect(dbOrder?.lines).toHaveLength(1);
    expect(dbOrder?.lines[0]?.qty).toBe(2);
  });

  it("sends and logs manual order confirmation emails", async () => {
    const { org, store, product, adminUser } = await seedBase();

    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
    });

    const order = await caller.salesOrders.createDraft({
      idempotencyKey: "sales-create-manual-email",
      storeId: store.id,
      customerName: "Client Email",
      customerEmail: "Client.Email@Example.COM",
      lines: [{ productId: product.id, qty: 1 }],
    });

    const result = await caller.salesOrders.sendEmail({
      customerOrderId: order.id,
      type: CustomerOrderEmailType.CONFIRMATION,
    });
    const dbOrder = await prisma.customerOrder.findUniqueOrThrow({ where: { id: order.id } });
    const logs = await prisma.customerOrderEmailLog.findMany({
      where: { customerOrderId: order.id, type: CustomerOrderEmailType.CONFIRMATION },
    });

    expect(result).toMatchObject({
      status: "sent",
      recipientEmail: "client.email@example.com",
    });
    expect(dbOrder.confirmationEmailSentAt).toBeInstanceOf(Date);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      status: CustomerOrderEmailStatus.SENT,
      recipientEmail: "client.email@example.com",
      triggeredById: adminUser.id,
    });
  });

  it("sends one confirmation email on confirm without order automation duplicate", async () => {
    const { org, store, product, adminUser } = await seedBase();

    await prisma.emailAutomation.createMany({
      data: [
        {
          organizationId: org.id,
          storeId: store.id,
          trigger: EmailAutomationTrigger.ORDER_CREATED,
          status: EmailAutomationStatus.ACTIVE,
          name: "Legacy order created",
          subject: "Order {{orderNumber}} accepted",
        },
        {
          organizationId: org.id,
          storeId: store.id,
          trigger: EmailAutomationTrigger.ORDER_STATUS_CHANGED,
          status: EmailAutomationStatus.ACTIVE,
          name: "Legacy status changed",
          subject: "Order {{orderNumber}} status changed",
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

    const order = await caller.salesOrders.createDraft({
      idempotencyKey: "sales-create-confirm-automation",
      storeId: store.id,
      customerName: "Confirm Client",
      customerEmail: "confirm@example.com",
      lines: [{ productId: product.id, qty: 1 }],
    });

    expect(
      await prisma.emailAutomationDelivery.count({ where: { customerOrderId: order.id } }),
    ).toBe(0);

    await caller.salesOrders.confirm({ customerOrderId: order.id });

    const logs = await prisma.customerOrderEmailLog.findMany({
      where: { customerOrderId: order.id, type: CustomerOrderEmailType.CONFIRMATION },
    });
    const deliveries = await prisma.emailAutomationDelivery.findMany({
      where: { customerOrderId: order.id },
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      status: CustomerOrderEmailStatus.SENT,
      recipientEmail: "confirm@example.com",
    });
    expect(deliveries).toHaveLength(0);
  });

  it("saves tracking without sending and sends tracking email explicitly", async () => {
    const { org, store, product, adminUser } = await seedBase();

    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
    });

    const order = await caller.salesOrders.createDraft({
      idempotencyKey: "sales-create-tracking",
      storeId: store.id,
      customerName: "Tracking Client",
      customerEmail: "tracking@example.com",
      lines: [{ productId: product.id, qty: 1 }],
    });

    await expect(
      caller.salesOrders.updateTracking({
        customerOrderId: order.id,
        trackingNumber: "TRK-1",
        trackingCarrier: "Courier",
        trackingUrl: "https://track.example.com/TRK-1",
        trackingStatus: "Shipped",
      }),
    ).resolves.toMatchObject({ trackingEmail: null });

    let dbOrder = await prisma.customerOrder.findUniqueOrThrow({ where: { id: order.id } });
    let sentLogs = await prisma.customerOrderEmailLog.findMany({
      where: {
        customerOrderId: order.id,
        type: CustomerOrderEmailType.TRACKING,
        status: CustomerOrderEmailStatus.SENT,
      },
    });

    expect(dbOrder.trackingNumber).toBe("TRK-1");
    expect(dbOrder.trackingEmailSentAt).toBeNull();
    expect(sentLogs).toHaveLength(0);

    await expect(
      caller.salesOrders.sendEmail({
        customerOrderId: order.id,
        type: CustomerOrderEmailType.TRACKING,
      }),
    ).resolves.toMatchObject({ status: "sent", recipientEmail: "tracking@example.com" });

    await expect(
      caller.salesOrders.updateTracking({
        customerOrderId: order.id,
        trackingNumber: "TRK-1",
        trackingCarrier: "Courier",
        trackingUrl: "https://track.example.com/TRK-1",
        trackingStatus: "In transit",
      }),
    ).resolves.toMatchObject({ trackingEmail: null });

    dbOrder = await prisma.customerOrder.findUniqueOrThrow({ where: { id: order.id } });
    sentLogs = await prisma.customerOrderEmailLog.findMany({
      where: {
        customerOrderId: order.id,
        type: CustomerOrderEmailType.TRACKING,
        status: CustomerOrderEmailStatus.SENT,
      },
      orderBy: { createdAt: "asc" },
    });

    expect(dbOrder.trackingNumber).toBe("TRK-1");
    expect(dbOrder.trackingStatus).toBe("In transit");
    expect(dbOrder.trackingEmailSentAt).toBeInstanceOf(Date);
    expect(sentLogs).toHaveLength(1);

    const missingTrackingOrder = await caller.salesOrders.createDraft({
      idempotencyKey: "sales-create-missing-tracking",
      storeId: store.id,
      customerName: "Missing Tracking Client",
      customerEmail: "missing-tracking@example.com",
      lines: [{ productId: product.id, qty: 1 }],
    });

    await expect(
      caller.salesOrders.sendEmail({
        customerOrderId: missingTrackingOrder.id,
        type: CustomerOrderEmailType.TRACKING,
      }),
    ).rejects.toMatchObject({ message: "trackingNumberMissing" });
  });

  it("sends and logs cancellation email once", async () => {
    const { org, store, product, adminUser } = await seedBase();

    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
    });

    const order = await caller.salesOrders.createDraft({
      idempotencyKey: "sales-create-cancel",
      storeId: store.id,
      customerName: "Cancel Client",
      customerEmail: "cancel@example.com",
      lines: [{ productId: product.id, qty: 1 }],
    });

    const result = await caller.salesOrders.cancel({ customerOrderId: order.id });
    expect(result.cancellationEmail).toMatchObject({
      status: "sent",
      recipientEmail: "cancel@example.com",
    });

    await expect(caller.salesOrders.cancel({ customerOrderId: order.id })).rejects.toMatchObject({
      message: "invalidTransition",
    });

    const logs = await prisma.customerOrderEmailLog.findMany({
      where: { customerOrderId: order.id, type: CustomerOrderEmailType.CANCELLATION },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      status: CustomerOrderEmailStatus.SENT,
      recipientEmail: "cancel@example.com",
    });

    const noEmailOrder = await caller.salesOrders.createDraft({
      idempotencyKey: "sales-create-cancel-no-email",
      storeId: store.id,
      customerName: "No Email Client",
      customerEmail: null,
      lines: [{ productId: product.id, qty: 1 }],
    });

    const noEmailResult = await caller.salesOrders.cancel({ customerOrderId: noEmailOrder.id });
    expect(noEmailResult.cancellationEmail).toMatchObject({
      status: "skipped",
      reason: "missingEmail",
      recipientEmail: null,
    });

    const skippedLogs = await prisma.customerOrderEmailLog.findMany({
      where: { customerOrderId: noEmailOrder.id, type: CustomerOrderEmailType.CANCELLATION },
    });
    expect(skippedLogs).toHaveLength(1);
    expect(skippedLogs[0]).toMatchObject({
      status: CustomerOrderEmailStatus.SKIPPED,
      recipientEmail: null,
      errorMessage: "customerEmailMissing",
    });
  });

  it("sends follow-up emails from the registered job idempotently", async () => {
    const { org, store, product, adminUser } = await seedBase();

    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
    });

    const order = await caller.salesOrders.createDraft({
      idempotencyKey: "sales-create-follow-up",
      storeId: store.id,
      customerName: "Follow Up Client",
      customerEmail: "followup@example.com",
      lines: [{ productId: product.id, qty: 1 }],
    });
    const completedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await prisma.customerOrder.update({
      where: { id: order.id },
      data: { status: CustomerOrderStatus.COMPLETED, completedAt },
    });

    await expect(runJob(CUSTOMER_ORDER_FOLLOW_UP_JOB_NAME, { limit: 10 })).resolves.toMatchObject({
      job: CUSTOMER_ORDER_FOLLOW_UP_JOB_NAME,
      status: "ok",
      details: { scanned: 1, sent: 1, skipped: 0, failed: 0 },
    });
    await expect(runJob(CUSTOMER_ORDER_FOLLOW_UP_JOB_NAME, { limit: 10 })).resolves.toMatchObject({
      job: CUSTOMER_ORDER_FOLLOW_UP_JOB_NAME,
      status: "ok",
      details: { scanned: 0, sent: 0, skipped: 0, failed: 0 },
    });

    const dbOrder = await prisma.customerOrder.findUniqueOrThrow({ where: { id: order.id } });
    const logs = await prisma.customerOrderEmailLog.findMany({
      where: {
        customerOrderId: order.id,
        type: CustomerOrderEmailType.FOLLOW_UP,
        status: CustomerOrderEmailStatus.SENT,
      },
    });

    expect(dbOrder.followUpEmailSentAt).toBeInstanceOf(Date);
    expect(logs).toHaveLength(1);
  });

  it("snapshots unit price and line total using store override price", async () => {
    const { org, store, product, adminUser } = await seedBase();

    await prisma.product.update({
      where: { id: product.id },
      data: { basePriceKgs: 120 },
    });
    await prisma.storePrice.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: product.id,
        variantKey: "BASE",
        priceKgs: 95,
      },
    });

    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
    });

    const order = await caller.salesOrders.createDraft({
      idempotencyKey: "sales-create-add-line",
      storeId: store.id,
    });
    const line = await caller.salesOrders.addLine({
      customerOrderId: order.id,
      productId: product.id,
      qty: 3,
    });

    expect(line.unitPriceKgs).toBe(95);
    expect(line.lineTotalKgs).toBe(285);
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

    const order = await caller.salesOrders.createDraft({
      idempotencyKey: "sales-create-client-a",
      storeId: store.id,
      customerName: "Client A",
    });
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

    const order = await caller.salesOrders.createDraft({
      idempotencyKey: "sales-create-client-b",
      storeId: store.id,
      customerName: "Client B",
    });
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

    const order = await adminCaller.salesOrders.createDraft({
      idempotencyKey: "sales-create-store-access",
      storeId: store.id,
    });
    await adminCaller.salesOrders.addLine({
      customerOrderId: order.id,
      productId: product.id,
      qty: 1,
    });
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

    await expect(
      staffCaller.salesOrders.cancel({ customerOrderId: order.id }),
    ).rejects.toMatchObject({
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
    await prisma.storeProduct.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: bundle.id,
        isActive: true,
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

    const order = await caller.salesOrders.createDraft({
      idempotencyKey: "sales-create-bundle-cost",
      storeId: store.id,
    });
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
    await prisma.storeProduct.createMany({
      data: [product, bundle].map((soldProduct) => ({
        organizationId: org.id,
        storeId: store.id,
        productId: soldProduct.id,
        isActive: true,
      })),
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

    const order = await caller.salesOrders.createDraft({
      idempotencyKey: "sales-create-metrics",
      storeId: store.id,
    });
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
