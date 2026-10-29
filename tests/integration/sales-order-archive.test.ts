import { beforeEach, describe, expect, it } from "vitest";
import { CustomerOrderStatus } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;
describeDb("customer order archive is reversible visibility only", () => {
  beforeEach(resetDatabase);
  it.each(Object.values(CustomerOrderStatus))(
    "archives and restores %s without changing business state",
    async (status) => {
      const b = await seedBase({ plan: "BUSINESS" });
      const api = createTestCaller({ ...b.adminUser, organizationId: b.org.id });
      const order = await prisma.customerOrder.create({
        data: {
          organizationId: b.org.id,
          storeId: b.store.id,
          number: "SO-ARCHIVE",
          status,
          totalKgs: 250,
          subtotalKgs: 250,
          notes: "Retain me",
          currencyCode: "USD",
          currencyRateKgsPerUnit: 90,
          createdAt: new Date("2026-10-29T17:59:00.000Z"),
        },
      });
      await Promise.all([
        api.salesOrders.setArchived({ customerOrderId: order.id, archived: true }),
        api.salesOrders.setArchived({ customerOrderId: order.id, archived: true }),
      ]);
      const archived = await prisma.customerOrder.findUniqueOrThrow({ where: { id: order.id } });
      const { archivedAt, updatedAt: _time, ...business } = archived;
      const { archivedAt: _oldArchive, updatedAt: _oldTime, ...original } = order;
      expect(archivedAt).toBeInstanceOf(Date);
      expect(business).toEqual(original);
      expect((await api.salesOrders.list({ lifecycleView: "ALL" })).total).toBe(0);
      expect(
        (await api.salesOrders.list({ archiveFilter: "ARCHIVED", lifecycleView: "ALL" })).items[0]
          .id,
      ).toBe(order.id);
      expect((await api.salesOrders.getById({ customerOrderId: order.id }))?.id).toBe(order.id);
      await api.salesOrders.setArchived({ customerOrderId: order.id, archived: true });
      expect(await prisma.auditLog.count({ where: { action: "CUSTOMER_ORDER_ARCHIVED" } })).toBe(1);
      await api.salesOrders.setArchived({ customerOrderId: order.id, archived: false });
      expect((await api.salesOrders.list({ lifecycleView: "ALL" })).items[0].id).toBe(order.id);
      expect(
        (
          await api.salesOrders.list({
            lifecycleView: status === CustomerOrderStatus.CANCELED ? "HISTORY" : "ACTIVE",
          })
        ).items[0].id,
      ).toBe(order.id);
      expect((await api.salesOrders.list({ archiveFilter: "ARCHIVED" })).total).toBe(0);
      expect(await prisma.stockMovement.count()).toBe(0);
      expect(await prisma.salePayment.count()).toBe(0);
      expect(await prisma.customerOrderEmailLog.count()).toBe(0);
    },
  );

  it("keeps completed sales in metrics while archived", async () => {
    const b = await seedBase({ plan: "BUSINESS" });
    const api = createTestCaller({ ...b.adminUser, organizationId: b.org.id });
    const order = await prisma.customerOrder.create({
      data: {
        organizationId: b.org.id,
        storeId: b.store.id,
        number: "SO-METRICS",
        status: "COMPLETED",
        completedAt: new Date(),
        totalKgs: 350,
        subtotalKgs: 350,
      },
    });
    const period = {
      dateFrom: new Date("2020-01-01"),
      dateTo: new Date("2035-01-01"),
      groupBy: "day" as const,
    };
    const before = await api.salesOrders.metrics(period);
    await api.salesOrders.setArchived({ customerOrderId: order.id, archived: true });
    expect(await api.salesOrders.metrics(period)).toEqual(before);
  });

  it("lets an assigned manager archive and restore orders in their store", async () => {
    const b = await seedBase({ plan: "BUSINESS" });
    const api = createTestCaller({ ...b.managerUser, organizationId: b.org.id });
    const order = await prisma.customerOrder.create({
      data: {
        organizationId: b.org.id,
        storeId: b.store.id,
        number: "SO-MANAGER-ARCHIVE",
      },
    });
    await api.salesOrders.setArchived({ customerOrderId: order.id, archived: true });
    expect(
      (await api.salesOrders.list({ archiveFilter: "ARCHIVED", lifecycleView: "ALL" })).items[0].id,
    ).toBe(order.id);
    await api.salesOrders.setArchived({ customerOrderId: order.id, archived: false });
    expect((await api.salesOrders.list({ lifecycleView: "ACTIVE" })).items[0].id).toBe(order.id);
  });

  it("denies staff/cashiers, inaccessible stores, other organizations and POS sales", async () => {
    const b = await seedBase({ plan: "BUSINESS" });
    const admin = createTestCaller({ ...b.adminUser, organizationId: b.org.id });
    const order = await prisma.customerOrder.create({
      data: { organizationId: b.org.id, storeId: b.store.id, number: "SO-SECURITY" },
    });
    for (const user of [b.staffUser, b.cashierUser]) {
      await expect(
        createTestCaller({ ...user, organizationId: b.org.id }).salesOrders.setArchived({
          customerOrderId: order.id,
          archived: true,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    const otherStore = await prisma.store.create({
      data: { organizationId: b.org.id, name: "Other", code: "OTHER" },
    });
    const otherOrder = await prisma.customerOrder.create({
      data: { organizationId: b.org.id, storeId: otherStore.id, number: "SO-OTHER" },
    });
    await expect(
      createTestCaller({ ...b.managerUser, organizationId: b.org.id }).salesOrders.setArchived({
        customerOrderId: otherOrder.id,
        archived: true,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const foreignOrg = await prisma.organization.create({
      data: { name: "Other org", plan: "BUSINESS" },
    });
    const foreignAdmin = await prisma.user.create({
      data: {
        organizationId: foreignOrg.id,
        email: "foreign@example.invalid",
        passwordHash: "unused",
        name: "Foreign",
        role: "ADMIN",
        isOrgOwner: true,
      },
    });
    await expect(
      createTestCaller({ ...foreignAdmin, organizationId: foreignOrg.id }).salesOrders.setArchived({
        customerOrderId: order.id,
        archived: true,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await prisma.customerOrder.update({ where: { id: order.id }, data: { isPosSale: true } });
    await expect(
      admin.salesOrders.setArchived({ customerOrderId: order.id, archived: true }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await prisma.auditLog.count({ where: { action: "CUSTOMER_ORDER_ARCHIVED" } })).toBe(0);
  });
});
