import {
  CustomerOrderStatus,
  CustomerSource,
  PurchaseOrderStatus,
  type Role,
} from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";

import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

const asCallerUser = (user: {
  id: string;
  email: string;
  role: Role;
  organizationId: string | null;
  isOrgOwner?: boolean | null;
}) => {
  if (!user.organizationId) {
    throw new Error("test user must belong to an organization");
  }
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
    isOrgOwner: Boolean(user.isOrgOwner),
  };
};

describeDb("commerce list filtering and sorting", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("pages, searches, filters, and sorts customer records on the server", async () => {
    const { org, store, adminUser } = await seedBase({ plan: "BUSINESS" });
    await prisma.customer.createMany({
      data: [
        {
          organizationId: org.id,
          storeId: store.id,
          name: "Zulu Customer",
          email: "zulu@example.com",
          source: CustomerSource.MANUAL,
          orderCount: 2,
          createdAt: new Date("2026-01-03T00:00:00.000Z"),
        },
        {
          organizationId: org.id,
          storeId: store.id,
          name: "Alpha Customer",
          email: "alpha@example.com",
          source: CustomerSource.ORDER,
          orderCount: 5,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        },
        {
          organizationId: org.id,
          storeId: store.id,
          name: "Beta Customer",
          email: "beta@example.com",
          source: CustomerSource.ORDER,
          orderCount: 3,
          createdAt: new Date("2026-01-02T00:00:00.000Z"),
        },
      ],
    });

    const caller = createTestCaller(asCallerUser(adminUser));
    const firstPage = await caller.customers.list({
      storeId: store.id,
      source: CustomerSource.ORDER,
      sortBy: "name",
      sortDirection: "asc",
      page: 1,
      pageSize: 1,
    });
    const secondPage = await caller.customers.list({
      storeId: store.id,
      source: CustomerSource.ORDER,
      sortBy: "name",
      sortDirection: "asc",
      page: 2,
      pageSize: 1,
    });

    expect(firstPage.total).toBe(2);
    expect(firstPage.items.map((customer) => customer.name)).toEqual(["Alpha Customer"]);
    expect(secondPage.items.map((customer) => customer.name)).toEqual(["Beta Customer"]);

    const searched = await caller.customers.list({
      storeId: store.id,
      search: "zulu@example",
      sortBy: "orderCount",
      sortDirection: "desc",
    });
    expect(searched.items.map((customer) => customer.name)).toEqual(["Zulu Customer"]);

    const exported = await caller.customers.exportRows({
      storeId: store.id,
      sortBy: "name",
      sortDirection: "asc",
    });
    expect(exported.map((customer) => customer.name)).toEqual([
      "Alpha Customer",
      "Beta Customer",
      "Zulu Customer",
    ]);
  });

  it("pages, searches, filters, and sorts non-POS sales orders on the server", async () => {
    const { org, store, adminUser } = await seedBase({ plan: "BUSINESS" });
    await prisma.customerOrder.createMany({
      data: [
        {
          organizationId: org.id,
          storeId: store.id,
          number: "SO-ZULU",
          status: CustomerOrderStatus.READY,
          customerName: "Zulu Buyer",
          totalKgs: 100,
          createdAt: new Date("2026-01-03T00:00:00.000Z"),
        },
        {
          organizationId: org.id,
          storeId: store.id,
          number: "SO-ALPHA",
          status: CustomerOrderStatus.READY,
          customerName: "Alpha Buyer",
          totalKgs: 300,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        },
        {
          organizationId: org.id,
          storeId: store.id,
          number: "POS-HIDDEN",
          status: CustomerOrderStatus.READY,
          customerName: "Alpha Buyer",
          totalKgs: 900,
          isPosSale: true,
        },
      ],
    });

    const caller = createTestCaller(asCallerUser(adminUser));
    const list = await caller.salesOrders.list({
      storeId: store.id,
      status: CustomerOrderStatus.READY,
      search: "Buyer",
      sortBy: "totalKgs",
      sortDirection: "desc",
      page: 1,
      pageSize: 1,
    });

    expect(list.total).toBe(2);
    expect(list.items.map((order) => order.number)).toEqual(["SO-ALPHA"]);
    expect(list.items).not.toEqual([expect.objectContaining({ number: "POS-HIDDEN" })]);
  });

  it("keeps purchase-order rows and bulk-selection ids on the same server filters", async () => {
    const { org, store, adminUser } = await seedBase({ plan: "BUSINESS" });
    const otherStore = await prisma.store.create({
      data: { organizationId: org.id, name: "Other Store", code: "OTHER" },
    });
    const [alphaSupplier, zuluSupplier] = await Promise.all([
      prisma.supplier.create({ data: { organizationId: org.id, name: "Alpha Supplier" } }),
      prisma.supplier.create({ data: { organizationId: org.id, name: "Zulu Supplier" } }),
    ]);
    const [alphaOrder, zuluOrder] = await Promise.all([
      prisma.purchaseOrder.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          supplierId: alphaSupplier.id,
          status: PurchaseOrderStatus.DRAFT,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      }),
      prisma.purchaseOrder.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          supplierId: zuluSupplier.id,
          status: PurchaseOrderStatus.DRAFT,
          createdAt: new Date("2026-01-02T00:00:00.000Z"),
        },
      }),
      prisma.purchaseOrder.create({
        data: {
          organizationId: org.id,
          storeId: otherStore.id,
          supplierId: alphaSupplier.id,
          status: PurchaseOrderStatus.SUBMITTED,
        },
      }),
    ]);

    const caller = createTestCaller(asCallerUser(adminUser));
    const filters = {
      storeId: store.id,
      status: PurchaseOrderStatus.DRAFT,
      search: "supplier",
      sortBy: "supplier" as const,
      sortDirection: "asc" as const,
    };
    const firstPage = await caller.purchaseOrders.list({ ...filters, page: 1, pageSize: 1 });
    const secondPage = await caller.purchaseOrders.list({ ...filters, page: 2, pageSize: 1 });
    const ids = await caller.purchaseOrders.listIds(filters);

    expect(firstPage.total).toBe(2);
    expect(firstPage.items.map((order) => order.id)).toEqual([alphaOrder.id]);
    expect(secondPage.items.map((order) => order.id)).toEqual([zuluOrder.id]);
    expect(ids).toEqual([alphaOrder.id, zuluOrder.id]);
  });
});
