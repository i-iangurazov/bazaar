import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { adjustStock } from "@/server/services/inventory";

import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

const seedReceipt = async () => {
  const f = await seedBase({ plan: "BUSINESS" });
  await prisma.product.update({ where: { id: f.product.id }, data: { basePriceKgs: 100 } });
  const caller = createTestCaller({
    ...f.cashierUser,
    organizationId: f.org.id,
    isOrgOwner: false,
  });
  const register = await prisma.posRegister.create({
    data: { organizationId: f.org.id, storeId: f.store.id, name: "Contact QA", code: "CONTACT" },
  });
  await caller.pos.shifts.open({
    registerId: register.id,
    openingCashKgs: 0,
    idempotencyKey: "contact-open",
  });
  await adjustStock({
    organizationId: f.org.id,
    actorId: f.adminUser.id,
    storeId: f.store.id,
    productId: f.product.id,
    qtyDelta: 50,
    reason: "contact QA",
    idempotencyKey: "contact-stock",
    requestId: "contact-stock",
  });
  const sale = await caller.pos.sales.createDraft({ registerId: register.id });
  const line = await caller.pos.sales.addLine({ saleId: sale.id, productId: f.product.id, qty: 2 });
  await caller.pos.sales.complete({
    saleId: sale.id,
    idempotencyKey: "contact-complete",
    payments: [{ method: "CASH", amountKgs: 200 }],
  });
  const customer = await prisma.customer.create({
    data: {
      organizationId: f.org.id,
      storeId: f.store.id,
      name: "Existing local contact",
      phone: "0555123456",
      address: "---",
    },
  });
  const lines = [{ lineId: line.id, productId: f.product.id, qty: 2, unitPriceKgs: 100 }];
  const accounting = async () => ({
    stock: (
      await prisma.inventorySnapshot.findFirstOrThrow({
        where: { storeId: f.store.id, productId: f.product.id },
      })
    ).onHand,
    movements: await prisma.stockMovement.count({
      where: { referenceId: sale.id, referenceType: "CustomerOrder" },
    }),
    payments: await prisma.salePayment.findMany({
      where: { customerOrderId: sale.id },
      orderBy: { id: "asc" },
    }),
  });
  return { ...f, caller, register, sale, customer, lines, accounting };
};

describeDb("completed POS receipt customer selection", () => {
  beforeEach(resetDatabase);

  it("links an existing local-format contact, trusts its saved details, and replays without financial changes", async () => {
    const f = await seedReceipt();
    const before = await f.accounting();
    const input = {
      saleId: f.sale.id,
      customerId: f.customer.id,
      customerName: f.customer.name,
      customerPhone: f.customer.phone,
      customerAddress: f.customer.address,
      lines: f.lines,
      idempotencyKey: "contact-edit-selected",
    };
    await expect(
      f.caller.pos.sales.editCompleted({ ...input, customerId: undefined }),
    ).rejects.toMatchObject({ message: "customerPhoneInvalid" });
    // Correcting the rejected selection must remain retryable with the same key.
    const edited = await f.caller.pos.sales.editCompleted(input);
    expect(edited.totalKgs).toBe(200);
    await expect(
      prisma.customerOrder.findUniqueOrThrow({ where: { id: f.sale.id } }),
    ).resolves.toMatchObject({
      customerId: f.customer.id,
      customerName: f.customer.name,
      customerPhone: "0555123456",
      customerAddress: "---",
    });
    await f.caller.pos.sales.editCompleted(input);
    expect(await f.accounting()).toEqual(before);
    expect(
      await prisma.auditLog.count({ where: { entityId: f.sale.id, action: "POS_SALE_EDIT" } }),
    ).toBe(1);

    await f.caller.pos.sales.editCompleted({
      ...input,
      customerPhone: "untrusted payload",
      customerName: "Forged name",
      customerAddress: "x",
      idempotencyKey: "contact-edit-server-details",
    });
    await expect(
      prisma.customerOrder.findUniqueOrThrow({ where: { id: f.sale.id } }),
    ).resolves.toMatchObject({
      customerId: f.customer.id,
      customerName: f.customer.name,
      customerPhone: f.customer.phone,
      customerAddress: f.customer.address,
    });
    await expect(
      prisma.customer.findUniqueOrThrow({ where: { id: f.customer.id } }),
    ).resolves.toMatchObject({
      phone: "0555123456",
      address: "---",
      orderCount: 0,
    });
  });

  it("keeps unchanged historical contacts editable and clears a selected customer explicitly", async () => {
    const f = await seedReceipt();
    await prisma.customerOrder.update({
      where: { id: f.sale.id },
      data: {
        customerId: f.customer.id,
        customerName: f.customer.name,
        customerPhone: f.customer.phone,
        customerAddress: f.customer.address,
      },
    });
    const edited = await f.caller.pos.sales.editCompleted({
      saleId: f.sale.id,
      customerName: f.customer.name,
      customerPhone: f.customer.phone,
      customerAddress: f.customer.address,
      lines: [{ ...f.lines[0]!, qty: 3, unitPriceKgs: 110 }],
      idempotencyKey: "contact-edit-lines",
    });
    expect(edited.totalKgs).toBe(330);
    expect((await f.accounting()).stock).toBe(47);
    await expect(
      prisma.customerOrder.findUniqueOrThrow({ where: { id: f.sale.id } }),
    ).resolves.toMatchObject({
      customerId: f.customer.id,
      customerPhone: "0555123456",
    });
    const line = await prisma.customerOrderLine.findFirstOrThrow({
      where: { customerOrderId: f.sale.id },
    });
    await f.caller.pos.sales.editCompleted({
      saleId: f.sale.id,
      customerId: null,
      customerName: null,
      customerPhone: null,
      customerAddress: null,
      lines: [{ ...f.lines[0]!, lineId: line.id, qty: 3, unitPriceKgs: 110 }],
      idempotencyKey: "contact-edit-clear",
    });
    await expect(
      prisma.customerOrder.findUniqueOrThrow({ where: { id: f.sale.id } }),
    ).resolves.toMatchObject({
      customerId: null,
      customerName: null,
      customerPhone: null,
      customerAddress: null,
    });
  });

  it("rejects new invalid contacts, deleted or foreign customers, and unauthorized receipt access atomically", async () => {
    const f = await seedReceipt();
    const before = await f.accounting();
    const foreignOrg = await prisma.organization.create({
      data: { name: "Other organization", plan: "BUSINESS" },
    });
    const foreignStore = await prisma.store.create({
      data: { organizationId: foreignOrg.id, name: "Other store", code: "OTHER" },
    });
    const otherCustomer = await prisma.customer.create({
      data: {
        organizationId: foreignOrg.id,
        storeId: foreignStore.id,
        name: "Other organization",
        phone: "0555123456",
      },
    });
    const deleted = await prisma.customer.create({
      data: {
        organizationId: f.org.id,
        storeId: f.store.id,
        name: "Deleted contact",
        phone: "0555123456",
        deletedAt: new Date(),
      },
    });
    for (const customerId of [otherCustomer.id, deleted.id, "missing-customer"]) {
      await expect(
        f.caller.pos.sales.editCompleted({
          saleId: f.sale.id,
          customerId,
          customerPhone: "0555123456",
          lines: f.lines,
          idempotencyKey: `contact-reject-${customerId}`,
        }),
      ).rejects.toMatchObject({ message: "customerNotFound" });
    }
    await expect(
      f.caller.pos.sales.editCompleted({
        saleId: f.sale.id,
        customerPhone: "0555123456",
        lines: f.lines,
        idempotencyKey: "contact-reject-new-local",
      }),
    ).rejects.toMatchObject({ message: "customerPhoneInvalid" });
    const outsider = await prisma.user.create({
      data: {
        organizationId: f.org.id,
        role: "CASHIER",
        name: "No store access",
        email: "outsider-contact@test.local",
        passwordHash: "unused",
        emailVerifiedAt: new Date(),
      },
    });
    const outsiderCaller = createTestCaller({
      ...outsider,
      organizationId: f.org.id,
      isOrgOwner: false,
    });
    await expect(
      outsiderCaller.pos.sales.editCompleted({
        saleId: f.sale.id,
        customerId: f.customer.id,
        lines: f.lines,
        idempotencyKey: "contact-reject-access",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await f.accounting()).toEqual(before);
    await expect(
      prisma.customerOrder.findUniqueOrThrow({ where: { id: f.sale.id } }),
    ).resolves.toMatchObject({
      customerId: null,
      customerPhone: null,
    });
  });
});
