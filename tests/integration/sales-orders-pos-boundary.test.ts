import {
  CustomerOrderEmailType,
  CustomerOrderStatus,
  EmailAutomationStatus,
  EmailAutomationTrigger,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sideEffects = vi.hoisted(() => ({
  publish: vi.fn(),
}));

vi.mock("@/server/events/eventBus", () => ({
  eventBus: {
    publish: sideEffects.publish,
  },
}));

import { prisma } from "@/server/db/prisma";
import { processEmailAutomationTrigger } from "@/server/services/emailMarketing";
import { sendDueOrderFollowUpEmails } from "@/server/services/orderEmails";
import {
  addCustomerOrderLine,
  cancelCustomerOrder,
  completeCustomerOrder,
  confirmCustomerOrder,
  getCustomerOrder,
  getSalesOrderMetrics,
  listCustomerOrders,
  markCustomerOrderReady,
  removeCustomerOrderLine,
  sendCustomerOrderEmail,
  setCustomerOrderCustomer,
  updateCustomerOrderLine,
  updateCustomerOrderTracking,
} from "@/server/services/salesOrders";

import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

const createCaller = (
  user: Awaited<ReturnType<typeof seedBase>>["adminUser"],
  isOrgOwner = false,
) =>
  createTestCaller({
    id: user.id,
    email: user.email ?? `${user.id}@test.local`,
    role: user.role,
    organizationId: user.organizationId!,
    isOrgOwner,
  });

const seedBoundaryFixtures = async () => {
  const base = await seedBase({ plan: "BUSINESS", allowNegativeStock: true });
  await prisma.product.update({
    where: { id: base.product.id },
    data: { basePriceKgs: 100 },
  });
  await prisma.storePrice.create({
    data: {
      organizationId: base.org.id,
      storeId: base.store.id,
      productId: base.product.id,
      variantKey: "BASE",
      priceKgs: 100,
      discountType: "PERCENTAGE",
      discountPercentage: 20,
    },
  });

  const secondProduct = await prisma.product.create({
    data: {
      organizationId: base.org.id,
      supplierId: base.supplier.id,
      sku: "TEST-2",
      name: "Second Product",
      unit: base.baseUnit.code,
      baseUnitId: base.baseUnit.id,
      basePriceKgs: 50,
    },
  });
  await prisma.storeProduct.create({
    data: {
      organizationId: base.org.id,
      storeId: base.store.id,
      productId: secondProduct.id,
      isActive: true,
    },
  });
  const register = await prisma.posRegister.create({
    data: {
      organizationId: base.org.id,
      storeId: base.store.id,
      name: "Boundary Register",
      code: "BOUNDARY",
    },
  });
  const oldCompletedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000);

  const held = await prisma.customerOrder.create({
    data: {
      organizationId: base.org.id,
      storeId: base.store.id,
      registerId: register.id,
      number: "POS-BOUNDARY-HELD",
      isPosSale: true,
      isHeld: true,
      heldAt: new Date(),
      heldById: base.cashierUser.id,
      customerName: "POS Held Customer",
      customerEmail: "pos-held@example.com",
      subtotalKgs: 100,
      totalKgs: 100,
      createdById: base.cashierUser.id,
      updatedById: base.cashierUser.id,
      lines: {
        create: {
          productId: base.product.id,
          variantKey: "BASE",
          qty: 1,
          baseUnitPriceKgs: 100,
          unitPriceKgs: 100,
          lineTotalKgs: 100,
        },
      },
    },
    include: { lines: true },
  });
  const draft = await prisma.customerOrder.create({
    data: {
      organizationId: base.org.id,
      storeId: base.store.id,
      registerId: register.id,
      number: "POS-BOUNDARY-DRAFT",
      isPosSale: true,
      customerName: "POS Draft Customer",
      customerEmail: "pos-draft@example.com",
      subtotalKgs: 100,
      totalKgs: 100,
      createdById: base.cashierUser.id,
      updatedById: base.cashierUser.id,
      lines: {
        create: {
          productId: base.product.id,
          variantKey: "BASE",
          qty: 1,
          baseUnitPriceKgs: 100,
          unitPriceKgs: 100,
          lineTotalKgs: 100,
        },
      },
    },
    include: { lines: true },
  });
  const completed = await prisma.customerOrder.create({
    data: {
      organizationId: base.org.id,
      storeId: base.store.id,
      registerId: register.id,
      number: "POS-BOUNDARY-COMPLETED",
      status: CustomerOrderStatus.COMPLETED,
      isPosSale: true,
      customerName: "POS Completed Customer",
      customerEmail: "pos-completed@example.com",
      subtotalKgs: 900,
      totalKgs: 900,
      completedAt: oldCompletedAt,
      createdById: base.cashierUser.id,
      updatedById: base.cashierUser.id,
      lines: {
        create: {
          productId: base.product.id,
          variantKey: "BASE",
          qty: 9,
          baseUnitPriceKgs: 100,
          unitPriceKgs: 100,
          lineTotalKgs: 900,
        },
      },
    },
  });

  sideEffects.publish.mockClear();
  return { ...base, secondProduct, register, held, draft, completed };
};

const persistedBoundaryState = async (orderIds: string[]) => ({
  orders: (
    await prisma.customerOrder.findMany({
      where: { id: { in: orderIds } },
      select: {
        id: true,
        status: true,
        isPosSale: true,
        isHeld: true,
        customerName: true,
        customerEmail: true,
        trackingNumber: true,
        confirmationEmailSentAt: true,
        canceledAt: true,
        completedAt: true,
        updatedById: true,
        updatedAt: true,
        lines: {
          select: {
            id: true,
            productId: true,
            qty: true,
            unitPriceKgs: true,
            lineTotalKgs: true,
          },
          orderBy: { id: "asc" },
        },
      },
      orderBy: { id: "asc" },
    })
  ).map((order) => ({
    ...order,
    lines: order.lines.map((line) => ({
      ...line,
      unitPriceKgs: Number(line.unitPriceKgs),
      lineTotalKgs: Number(line.lineTotalKgs),
    })),
  })),
  audits: await prisma.auditLog.findMany({
    where: { entity: "CustomerOrder", entityId: { in: orderIds } },
    orderBy: { id: "asc" },
  }),
  customers: await prisma.customer.count(),
  emailLogs: await prisma.customerOrderEmailLog.count({
    where: { customerOrderId: { in: orderIds } },
  }),
  automationDeliveries: await prisma.emailAutomationDelivery.count({
    where: { customerOrderId: { in: orderIds } },
  }),
  stockMovements: await prisma.stockMovement.count({
    where: { referenceType: "CustomerOrder", referenceId: { in: orderIds } },
  }),
  idempotencyKeys: await prisma.idempotencyKey.count(),
  operationRequests: await prisma.operationRequest.count(),
});

const expectSalesOrderNotFound = async (operation: () => Promise<unknown>) => {
  await expect(operation()).rejects.toMatchObject({ message: "salesOrderNotFound" });
};

describeDb("HARD-A3-029 ordinary sales-order/POS boundary", () => {
  beforeEach(async () => {
    await resetDatabase();
    sideEffects.publish.mockClear();
  });

  it("rejects same- and cross-user direct tRPC access to held and active POS drafts without effects", async () => {
    const fixtures = await seedBoundaryFixtures();
    const owner = createCaller(fixtures.cashierUser);
    const otherStaff = createCaller(fixtures.staffUser);
    const otherManager = createCaller(fixtures.managerUser);
    const posIds = [fixtures.held.id, fixtures.draft.id, fixtures.completed.id];
    const before = await persistedBoundaryState(posIds);

    const list = await owner.salesOrders.list({ page: 1, pageSize: 25 });
    const metrics = await otherManager.salesOrders.metrics({
      dateFrom: new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000),
      dateTo: new Date(Date.now() + 24 * 60 * 60 * 1_000),
      groupBy: "day",
    });
    expect(list.items).toHaveLength(0);
    expect(metrics.summary.ordersCount).toBe(0);
    expect(metrics.summary.totalRevenueKgs).toBe(0);

    await expectSalesOrderNotFound(() =>
      owner.salesOrders.getById({ customerOrderId: fixtures.held.id }),
    );
    await expectSalesOrderNotFound(() =>
      otherStaff.salesOrders.getById({ customerOrderId: fixtures.draft.id }),
    );
    await expectSalesOrderNotFound(() =>
      owner.salesOrders.setCustomer({
        customerOrderId: fixtures.held.id,
        customerName: "ordinary-router-overwrite",
      }),
    );
    await expectSalesOrderNotFound(() =>
      owner.salesOrders.addLine({
        customerOrderId: fixtures.draft.id,
        productId: fixtures.secondProduct.id,
        qty: 1,
      }),
    );
    await expectSalesOrderNotFound(() =>
      otherStaff.salesOrders.updateLine({ lineId: fixtures.held.lines[0]!.id, qty: 7 }),
    );
    await expectSalesOrderNotFound(() =>
      owner.salesOrders.removeLine({ lineId: fixtures.draft.lines[0]!.id }),
    );
    await expectSalesOrderNotFound(() =>
      owner.salesOrders.confirm({ customerOrderId: fixtures.draft.id }),
    );
    await expectSalesOrderNotFound(() =>
      owner.salesOrders.markReady({ customerOrderId: fixtures.held.id }),
    );
    await expectSalesOrderNotFound(() =>
      otherManager.salesOrders.updateTracking({
        customerOrderId: fixtures.draft.id,
        trackingNumber: "must-not-persist",
      }),
    );
    await expectSalesOrderNotFound(() =>
      otherManager.salesOrders.sendEmail({
        customerOrderId: fixtures.held.id,
        type: CustomerOrderEmailType.CONFIRMATION,
      }),
    );
    await expectSalesOrderNotFound(() =>
      otherManager.salesOrders.complete({
        customerOrderId: fixtures.draft.id,
        idempotencyKey: "a3-029-router-complete",
      }),
    );
    await expectSalesOrderNotFound(() =>
      otherManager.salesOrders.cancel({ customerOrderId: fixtures.held.id }),
    );

    const after = await persistedBoundaryState(posIds);
    expect(after).toEqual(before);
    expect(sideEffects.publish).not.toHaveBeenCalled();
  });

  it("enforces the same boundary in services, email automation, and follow-up jobs", async () => {
    const fixtures = await seedBoundaryFixtures();
    const posIds = [fixtures.held.id, fixtures.draft.id, fixtures.completed.id];
    const before = await persistedBoundaryState(posIds);
    const common = {
      organizationId: fixtures.org.id,
      actorId: fixtures.adminUser.id,
      requestId: "a3-029-direct-service",
    };

    await expect(
      getCustomerOrder({
        organizationId: fixtures.org.id,
        customerOrderId: fixtures.held.id,
      }),
    ).resolves.toBeNull();
    await expect(
      listCustomerOrders({
        organizationId: fixtures.org.id,
        page: 1,
        pageSize: 25,
      }),
    ).resolves.toMatchObject({ items: [], total: 0 });
    await expect(
      getSalesOrderMetrics({
        organizationId: fixtures.org.id,
        dateFrom: new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000),
        dateTo: new Date(Date.now() + 24 * 60 * 60 * 1_000),
        groupBy: "day",
      }),
    ).resolves.toMatchObject({ summary: { ordersCount: 0, totalRevenueKgs: 0 } });

    await expectSalesOrderNotFound(() =>
      setCustomerOrderCustomer({
        ...common,
        customerOrderId: fixtures.held.id,
        customerName: "direct-service-overwrite",
      }),
    );
    await expectSalesOrderNotFound(() =>
      updateCustomerOrderTracking({
        ...common,
        customerOrderId: fixtures.draft.id,
        trackingNumber: "must-not-persist",
      }),
    );
    await expectSalesOrderNotFound(() =>
      addCustomerOrderLine({
        ...common,
        customerOrderId: fixtures.draft.id,
        productId: fixtures.secondProduct.id,
        qty: 1,
      }),
    );
    await expect(
      updateCustomerOrderLine({
        ...common,
        lineId: fixtures.held.lines[0]!.id,
        qty: 7,
      }),
    ).rejects.toMatchObject({ message: "salesOrderLineNotFound" });
    await expect(
      removeCustomerOrderLine({
        ...common,
        lineId: fixtures.draft.lines[0]!.id,
      }),
    ).rejects.toMatchObject({ message: "salesOrderLineNotFound" });
    await expectSalesOrderNotFound(() =>
      confirmCustomerOrder({ ...common, customerOrderId: fixtures.draft.id }),
    );
    await expectSalesOrderNotFound(() =>
      markCustomerOrderReady({ ...common, customerOrderId: fixtures.held.id }),
    );
    await expectSalesOrderNotFound(() =>
      completeCustomerOrder({
        ...common,
        customerOrderId: fixtures.draft.id,
        idempotencyKey: "a3-029-direct-complete",
      }),
    );
    await expectSalesOrderNotFound(() =>
      cancelCustomerOrder({ ...common, customerOrderId: fixtures.held.id }),
    );
    await expectSalesOrderNotFound(() =>
      sendCustomerOrderEmail({
        organizationId: fixtures.org.id,
        customerOrderId: fixtures.held.id,
        actorId: fixtures.adminUser.id,
        type: CustomerOrderEmailType.CONFIRMATION,
      }),
    );

    await prisma.emailAutomation.create({
      data: {
        organizationId: fixtures.org.id,
        storeId: fixtures.store.id,
        trigger: EmailAutomationTrigger.ORDER_STATUS_CHANGED,
        status: EmailAutomationStatus.ACTIVE,
        name: "POS boundary automation",
        subject: "Order {{orderNumber}} changed",
      },
    });
    await expectSalesOrderNotFound(() =>
      processEmailAutomationTrigger({
        organizationId: fixtures.org.id,
        storeId: fixtures.store.id,
        customerOrderId: fixtures.held.id,
        trigger: EmailAutomationTrigger.ORDER_STATUS_CHANGED,
        oldStatus: CustomerOrderStatus.DRAFT,
        newStatus: CustomerOrderStatus.CONFIRMED,
      }),
    );
    await expect(sendDueOrderFollowUpEmails({ limit: 10 })).resolves.toMatchObject({
      scanned: 0,
      sent: 0,
      failed: 0,
    });

    const after = await persistedBoundaryState(posIds);
    expect(after).toEqual(before);
    expect(sideEffects.publish).not.toHaveBeenCalled();
  });

  it("preserves ordinary sales-order mutation, email, discount snapshot, and metrics paths", async () => {
    const fixtures = await seedBoundaryFixtures();
    const admin = createCaller(fixtures.adminUser, true);

    const order = await admin.salesOrders.createDraft({
      idempotencyKey: "a3-029-normal-create",
      storeId: fixtures.store.id,
      customerName: "Ordinary Customer",
      customerEmail: "ordinary@example.com",
      lines: [{ productId: fixtures.product.id, qty: 1 }],
    });
    const initial = await admin.salesOrders.getById({ customerOrderId: order.id });
    expect(initial).toMatchObject({
      id: order.id,
      isPosSale: false,
      subtotalKgs: 80,
      totalKgs: 80,
    });
    expect(initial?.lines[0]).toMatchObject({
      appliedDiscountType: "PERCENTAGE",
      unitPriceKgs: 80,
      lineTotalKgs: 80,
    });
    expect(Number(initial?.lines[0]?.baseUnitPriceKgs)).toBe(100);
    expect(Number(initial?.lines[0]?.appliedDiscountPercentage)).toBe(20);

    await admin.salesOrders.setCustomer({
      customerOrderId: order.id,
      customerName: "Updated Ordinary Customer",
      customerEmail: "ordinary@example.com",
    });
    await admin.salesOrders.updateTracking({
      customerOrderId: order.id,
      trackingNumber: "NORMAL-TRACK-1",
      trackingStatus: "Created",
    });
    await expect(
      admin.salesOrders.sendEmail({
        customerOrderId: order.id,
        type: CustomerOrderEmailType.CONFIRMATION,
      }),
    ).resolves.toMatchObject({ status: "sent", recipientEmail: "ordinary@example.com" });

    const added = await admin.salesOrders.addLine({
      customerOrderId: order.id,
      productId: fixtures.secondProduct.id,
      qty: 1,
    });
    await admin.salesOrders.updateLine({ lineId: added.id, qty: 2 });
    await admin.salesOrders.removeLine({ lineId: added.id });
    await admin.salesOrders.confirm({ customerOrderId: order.id });
    await admin.salesOrders.markReady({ customerOrderId: order.id });
    await admin.salesOrders.complete({
      customerOrderId: order.id,
      idempotencyKey: "a3-029-normal-complete",
    });

    const canceled = await admin.salesOrders.createDraft({
      idempotencyKey: "a3-029-normal-cancel-create",
      storeId: fixtures.store.id,
      customerName: "Canceled Ordinary Customer",
      customerEmail: "ordinary-cancel@example.com",
      lines: [{ productId: fixtures.product.id, qty: 1 }],
    });
    await expect(admin.salesOrders.cancel({ customerOrderId: canceled.id })).resolves.toMatchObject(
      {
        order: { id: canceled.id, status: CustomerOrderStatus.CANCELED },
        cancellationEmail: { status: "sent", recipientEmail: "ordinary-cancel@example.com" },
      },
    );

    const list = await admin.salesOrders.list({ page: 1, pageSize: 25 });
    expect(list.items.map((item) => item.id)).toEqual(
      expect.arrayContaining([order.id, canceled.id]),
    );
    expect(list.items.every((item) => !item.isPosSale)).toBe(true);
    const metrics = await admin.salesOrders.metrics({
      dateFrom: new Date(Date.now() - 24 * 60 * 60 * 1_000),
      dateTo: new Date(Date.now() + 24 * 60 * 60 * 1_000),
      groupBy: "day",
    });
    expect(metrics.summary).toMatchObject({
      ordersCount: 1,
      totalRevenueKgs: 80,
    });

    const persisted = await prisma.customerOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(persisted).toMatchObject({
      isPosSale: false,
      status: CustomerOrderStatus.COMPLETED,
      customerName: "Updated Ordinary Customer",
      trackingNumber: "NORMAL-TRACK-1",
    });
    expect(
      await prisma.customerOrderEmailLog.count({
        where: { customerOrderId: { in: [order.id, canceled.id] } },
      }),
    ).toBe(2);
  });
});
