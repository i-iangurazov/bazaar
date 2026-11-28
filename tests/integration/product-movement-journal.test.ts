import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("movement journal customers and pending sales", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("finds customer snapshots and shows the same order before and after posting", async () => {
    const { org, store, product, adminUser, managerUser } = await seedBase({ plan: "BUSINESS" });
    const restrictedStore = await prisma.store.create({
      data: { organizationId: org.id, name: "Other branch", code: "OTHER" },
    });
    const otherOrg = await prisma.organization.create({ data: { name: "Other company" } });
    const otherOrgStore = await prisma.store.create({
      data: { organizationId: otherOrg.id, name: "Other company store", code: "OTHER" },
    });
    await prisma.customer.createMany({
      data: [
        { organizationId: org.id, storeId: store.id, name: "Эмиль" },
        { organizationId: org.id, storeId: store.id, name: "Эмиль" },
        { organizationId: org.id, storeId: store.id, name: "Эмиль архив", deletedAt: new Date() },
        { organizationId: org.id, storeId: restrictedStore.id, name: "Эмиль чужой филиал" },
        { organizationId: otherOrg.id, storeId: otherOrgStore.id, name: "Эмиль другая компания" },
      ],
    });
    const draft = await prisma.customerOrder.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        number: "ORDER-DRAFT",
        status: "DRAFT",
        customerName: "  Эмиль  ",
        createdById: adminUser.id,
        totalKgs: 200,
        lines: {
          create: { productId: product.id, qty: 2, unitPriceKgs: 100, lineTotalKgs: 200 },
        },
      },
    });
    await prisma.customerOrder.createMany({
      data: [
        {
          organizationId: org.id, storeId: restrictedStore.id, number: "ORDER-RESTRICTED",
          status: "READY", customerName: "Эмиль", createdById: adminUser.id,
        },
        {
          organizationId: otherOrg.id, storeId: otherOrgStore.id, number: "ORDER-FOREIGN",
          status: "READY", customerName: "Эмиль",
        },
        {
          organizationId: org.id, storeId: store.id, number: "ORDER-POS",
          status: "DRAFT", isPosSale: true, customerName: "Эмиль", createdById: adminUser.id,
        },
        {
          organizationId: org.id, storeId: store.id, number: "ORDER-ARCHIVED",
          status: "CANCELED", archivedAt: new Date(), customerName: "Эмиль", createdById: adminUser.id,
        },
      ],
    });
    const caller = createTestCaller({
      id: managerUser.id, email: managerUser.email, role: managerUser.role, organizationId: org.id,
    });

    await expect(caller.inventory.productMovementRecipientOptions({ search: "эмиЛ" })).resolves.toEqual([
      "Эмиль",
    ]);
    await expect(caller.inventory.productMovementRecipientOptions({
      storeId: restrictedStore.id, search: "Эмил",
    })).resolves.toEqual([]);
    await expect(caller.inventory.productMovementRecipientOptions({
      storeId: otherOrgStore.id, search: "Эмил",
    })).resolves.toEqual([]);
    await expect(caller.inventory.productMovementRecipientOptions({ search: "%%" })).resolves.toEqual([]);

    const filter = { includePendingSales: true, recipientSearch: "Эмил" } as const;
    await expect(caller.inventory.productMovements({ recipientSearch: "Эмил" })).resolves.toMatchObject({
      total: 0,
    });
    const draftJournal = await caller.inventory.productMovements(filter);
    expect(draftJournal.total).toBe(1);
    expect(draftJournal.items).toEqual([
      expect.objectContaining({
        documentId: draft.id,
        documentType: "SALE",
        status: "DRAFT",
        postedAt: null,
        customerName: "Эмиль",
        recipientName: "Эмиль",
        positionsCount: 1,
        totalQuantity: 2,
        totalAmount: 200,
        detailUrl: "/sales/orders/" + draft.id,
      }),
    ]);
    await expect(caller.inventory.productMovements({
      includePendingSales: true, search: "Эмиль", type: "SALE", archiveMode: "ARCHIVED",
    })).resolves.toMatchObject({
      items: [expect.objectContaining({ documentNumber: "ORDER-ARCHIVED" })],
      total: 1,
    });

    const completedAt = new Date();
    await prisma.customerOrder.update({
      where: { id: draft.id },
      data: { status: "COMPLETED", completedAt, customerName: "", debtCustomerName: "Эмиль" },
    });
    await prisma.stockMovement.create({
      data: {
        storeId: store.id, productId: product.id, type: "SALE", qtyDelta: -2,
        referenceType: "CustomerOrder", referenceId: draft.id,
      },
    });
    const postedJournal = await caller.inventory.productMovements(filter);
    expect(postedJournal.total).toBe(1);
    expect(postedJournal.items).toEqual([
      expect.objectContaining({
        id: draftJournal.items[0]?.id,
        documentId: draft.id,
        status: "COMPLETED",
        postedAt: completedAt,
        customerName: "Эмиль",
        totalQuantity: 2,
      }),
    ]);
  });
});
