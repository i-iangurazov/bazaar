import { randomUUID } from "node:crypto";
import { Role } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { adjustStock, applyStockMovement } from "@/server/services/inventory";
import { businessDateKey } from "@/lib/timezone";
import { recordOrderPayment } from "@/server/services/salesOrderPayments";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;
const seedApi = async () => {
  const f = await seedBase({ plan: "ENTERPRISE" });
  return { ...f, api: createTestCaller(asUser(f.adminUser)) };
};
const asUser = (user: {
  id: string;
  email: string;
  role: Role;
  organizationId: string | null;
  isOrgOwner?: boolean | null;
}) => ({ ...user, organizationId: user.organizationId!, isOrgOwner: Boolean(user.isOrgOwner) });

async function fixture() {
  const f = await seedApi();
  await prisma.organization.update({
    where: { id: f.org.id },
    data: { retailWholesaleEnabled: true },
  });
  await prisma.product.update({ where: { id: f.product.id }, data: { basePriceKgs: 100 } });
  const second = await prisma.product.create({
    data: {
      organizationId: f.org.id,
      supplierId: f.supplier.id,
      sku: "R1-SECOND",
      name: "No wholesale item",
      unit: f.baseUnit.code,
      baseUnitId: f.baseUnit.id,
      basePriceKgs: 50,
    },
  });
  await prisma.storeProduct.create({
    data: { organizationId: f.org.id, storeId: f.store.id, productId: second.id, isActive: true },
  });
  for (const [productId, retail, wholesale] of [
    [f.product.id, 100, 80],
    [second.id, 50, null],
  ] as const) {
    await prisma.storePriceTypes.create({
      data: {
        organizationId: f.org.id,
        storeId: f.store.id,
        productId,
        variantKey: "BASE",
        retailPriceKgs: retail,
        wholesalePriceKgs: wholesale,
        updatedById: f.adminUser.id,
      },
    });
    await adjustStock({
      organizationId: f.org.id,
      actorId: f.adminUser.id,
      storeId: f.store.id,
      productId,
      qtyDelta: 40,
      reason: "r1 fixture",
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
    });
  }
  return { ...f, second, api: createTestCaller(asUser(f.adminUser)) };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

describeDb("R1 document price mode", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("prices a wholesale sale from wholesale prices without changing the catalogue", async () => {
    const f = await fixture();
    const order = await f.api.salesOrders.createSale({
      storeId: f.store.id,
      priceMode: "WHOLESALE",
      idempotencyKey: randomUUID(),
      lines: [{ productId: f.product.id, qty: 2 }],
    });
    const saved = await prisma.customerOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: { lines: true },
    });
    expect(saved.priceMode).toBe("WHOLESALE");
    expect(Number(saved.totalKgs)).toBe(160);
    expect(Number(saved.lines[0]!.unitPriceKgs)).toBe(80);
    expect(saved.lines[0]!.priceSource).toBe("WHOLESALE");
    expect(saved.lines[0]!.manualPrice).toBe(false);
    expect(
      Number(
        (
          await prisma.storePriceTypes.findFirstOrThrow({
            where: { organizationId: f.org.id, storeId: f.store.id, productId: f.product.id },
          })
        ).wholesalePriceKgs,
      ),
    ).toBe(80);
  });

  it("refuses wholesale posting when a line has no wholesale price", async () => {
    const f = await fixture();
    await expect(
      f.api.salesOrders.createSale({
        storeId: f.store.id,
        priceMode: "WHOLESALE",
        idempotencyKey: randomUUID(),
        lines: [{ productId: f.second.id, qty: 1 }],
      }),
    ).rejects.toMatchObject({ message: "salesOrderPriceRequired" });
    expect(await prisma.customerOrder.count()).toBe(0);
  });

  it("keeps draft editing available but blocks posting when the selected price is missing", async () => {
    const f = await fixture();
    const draft = await f.api.salesOrders.createDraft({
      storeId: f.store.id,
      priceMode: "WHOLESALE",
      idempotencyKey: randomUUID(),
      lines: [{ productId: f.second.id, qty: 1 }],
    });
    const missing = await prisma.customerOrderLine.findFirstOrThrow({
      where: { customerOrderId: draft.id },
    });
    expect(missing.priceSource).toBe("MISSING");
    await expect(
      f.api.salesOrders.postSale({ customerOrderId: draft.id, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ message: "salesOrderPriceRequired" });
    expect((await prisma.customerOrder.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("DRAFT");

    const secondDraft = await f.api.salesOrders.createDraft({
      storeId: f.store.id,
      priceMode: "RETAIL",
      idempotencyKey: randomUUID(),
      lines: [{ productId: f.product.id, qty: 1 }],
    });
    await prisma.customerOrder.update({
      where: { id: secondDraft.id },
      data: { priceMode: "WHOLESALE" },
    });
    await f.api.salesOrders.addLine({
      customerOrderId: secondDraft.id,
      productId: f.second.id,
      qty: 1,
    });
    const added = await prisma.customerOrderLine.findFirstOrThrow({
      where: { customerOrderId: secondDraft.id, productId: f.second.id },
    });
    expect(added.priceSource).toBe("MISSING");
    await expect(
      f.api.salesOrders.postSale({ customerOrderId: secondDraft.id, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ message: "salesOrderPriceRequired" });
  });

  it("reprices the same saved order on update and preserves historical prices afterwards", async () => {
    const f = await fixture();
    const draft = await f.api.salesOrders.createDraft({
      storeId: f.store.id,
      priceMode: "RETAIL",
      idempotencyKey: randomUUID(),
      lines: [{ productId: f.product.id, qty: 2 }],
    });
    const before = await prisma.customerOrder.findUniqueOrThrow({
      where: { id: draft.id },
      include: { lines: true },
    });
    expect(Number(before.totalKgs)).toBe(200);
    const updated = await f.api.salesOrders.update({
      customerOrderId: draft.id,
      expectedUpdatedAt: before.updatedAt.toISOString(),
      storeId: f.store.id,
      priceMode: "WHOLESALE",
      customerId: null,
      lines: [{ lineId: before.lines[0]!.id, productId: f.product.id, qty: 2 }],
      idempotencyKey: randomUUID(),
    });
    expect(updated.id).toBe(draft.id);
    const after = await prisma.customerOrder.findUniqueOrThrow({
      where: { id: draft.id },
      include: { lines: true },
    });
    expect(after.priceMode).toBe("WHOLESALE");
    expect(Number(after.totalKgs)).toBe(160);
    expect(Number(after.lines[0]!.unitPriceKgs)).toBe(80);

    await prisma.storePriceTypes.update({
      where: {
        organizationId_storeId_productId_variantKey: {
          organizationId: f.org.id,
          storeId: f.store.id,
          productId: f.product.id,
          variantKey: "BASE",
        },
      },
      data: { wholesalePriceKgs: 70 },
    });
    const qtyOnly = await f.api.salesOrders.update({
      customerOrderId: draft.id,
      expectedUpdatedAt: after.updatedAt.toISOString(),
      storeId: f.store.id,
      lines: [{ lineId: after.lines[0]!.id, productId: f.product.id, qty: 3 }],
      idempotencyKey: randomUUID(),
    });
    const historical = await prisma.customerOrder.findUniqueOrThrow({
      where: { id: draft.id },
      include: { lines: true },
    });
    expect(qtyOnly.id).toBe(draft.id);
    expect(Number(historical.lines[0]!.unitPriceKgs)).toBe(80);
    expect(Number(historical.totalKgs)).toBe(240);
  });

  it("keeps a manual line when switching modes and reports missing target prices", async () => {
    const f = await fixture();
    const draft = await f.api.salesOrders.createDraft({
      storeId: f.store.id,
      priceMode: "RETAIL",
      idempotencyKey: randomUUID(),
      lines: [
        { productId: f.product.id, qty: 1 },
        { productId: f.second.id, qty: 1 },
      ],
    });
    const saved = await prisma.customerOrder.findUniqueOrThrow({
      where: { id: draft.id },
      include: { lines: { orderBy: { productId: "asc" } } },
    });
    const productLine = saved.lines.find((line) => line.productId === f.product.id)!;
    await f.api.salesOrders.update({
      customerOrderId: draft.id,
      expectedUpdatedAt: saved.updatedAt.toISOString(),
      storeId: f.store.id,
      lines: [
        { lineId: productLine.id, productId: f.product.id, qty: 1, unitPriceKgs: 95 },
        { lineId: saved.lines.find((line) => line.productId === f.second.id)!.id, productId: f.second.id, qty: 1 },
      ],
      idempotencyKey: randomUUID(),
    });
    const manual = await prisma.customerOrder.findUniqueOrThrow({
      where: { id: draft.id },
      include: { lines: true },
    });
    expect(manual.lines.find((line) => line.productId === f.product.id)!.manualPrice).toBe(true);

    await expect(
      f.api.salesOrders.update({
        customerOrderId: draft.id,
        expectedUpdatedAt: manual.updatedAt.toISOString(),
        storeId: f.store.id,
        priceMode: "WHOLESALE",
        lines: [
          { lineId: productLine.id, productId: f.product.id, qty: 1 },
          { lineId: manual.lines.find((line) => line.productId === f.second.id)!.id, productId: f.second.id, qty: 1 },
        ],
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ message: "salesOrderPriceRequired" });
    expect(
      (await prisma.customerOrder.findUniqueOrThrow({ where: { id: draft.id } })).priceMode,
    ).toBe("RETAIL");
  });
});

describeDb("R3/R4 employee attribution and filters", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("separates the author from the operator who completed the sale", async () => {
    const f = await seedApi();
    const staffApi = createTestCaller(asUser(f.staffUser));
    const managerApi = createTestCaller(asUser(f.managerUser));
    await prisma.product.update({ where: { id: f.product.id }, data: { basePriceKgs: 100 } });
    await adjustStock({
      organizationId: f.org.id,
      actorId: f.adminUser.id,
      storeId: f.store.id,
      productId: f.product.id,
      qtyDelta: 20,
      reason: "r3 fixture",
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
    });
    const draft = await staffApi.salesOrders.createDraft({
      storeId: f.store.id,
      idempotencyKey: randomUUID(),
      lines: [{ productId: f.product.id, qty: 1 }],
    });
    await managerApi.salesOrders.postSale({
      customerOrderId: draft.id,
      idempotencyKey: randomUUID(),
    });
    const saved = await prisma.customerOrder.findUniqueOrThrow({ where: { id: draft.id } });
    expect(saved.createdById).toBe(f.staffUser.id);
    expect(saved.completedById).toBe(f.managerUser.id);

    const list = await managerApi.salesOrders.list({ page: 1, pageSize: 25 });
    const row = list.items.find((item) => item.id === draft.id);
    expect(row?.createdBy?.name).toBe(f.staffUser.name);
    expect(row?.completedBy?.name).toBe(f.managerUser.name);

    const staffOnly = await managerApi.salesOrders.list({
      page: 1,
      pageSize: 25,
      employeeId: f.staffUser.id,
    });
    expect(staffOnly.items.map((item) => item.id)).toEqual([draft.id]);
    const managerOnly = await managerApi.salesOrders.list({
      page: 1,
      pageSize: 25,
      employeeId: f.managerUser.id,
    });
    expect(managerOnly.items).toHaveLength(0);

    await prisma.user.update({ where: { id: f.staffUser.id }, data: { isActive: false } });
    const options = await managerApi.salesOrders.employeeOptions();
    expect(options.find((user) => user.id === f.staffUser.id)).toMatchObject({
      isActive: false,
      name: f.staffUser.name,
    });
  });

  it("applies employee and date filters to the whole server result with pagination", async () => {
    const f = await seedApi();
    const staffApi = createTestCaller(asUser(f.staffUser));
    for (let index = 0; index < 3; index += 1) {
      await staffApi.salesOrders.createDraft({
        storeId: f.store.id,
        idempotencyKey: randomUUID(),
        lines: [],
      });
    }
    for (let index = 0; index < 2; index += 1) {
      await f.api.salesOrders.createDraft({
        storeId: f.store.id,
        idempotencyKey: randomUUID(),
        lines: [],
      });
    }
    const firstPage = await f.api.salesOrders.list({
      page: 1,
      pageSize: 2,
      employeeId: f.staffUser.id,
    });
    expect(firstPage.total).toBe(3);
    expect(firstPage.items).toHaveLength(2);
    const secondPage = await f.api.salesOrders.list({
      page: 2,
      pageSize: 2,
      employeeId: f.staffUser.id,
    });
    expect(secondPage.items).toHaveLength(1);
    const day = businessDateKey(new Date());
    const inRange = await f.api.salesOrders.list({
      page: 1,
      pageSize: 25,
      employeeId: f.staffUser.id,
      createdFromDay: day,
      createdToDay: day,
    });
    expect(inRange.total).toBe(3);
    const outOfRange = await f.api.salesOrders.list({
      page: 1,
      pageSize: 25,
      employeeId: f.staffUser.id,
      createdFromDay: "2020-01-01",
      createdToDay: "2020-01-02",
    });
    expect(outOfRange.total).toBe(0);
  });
});

describeDb("R5 shared edit form", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("updates the same document and preserves fields outside the form", async () => {
    const f = await seedApi();
    await prisma.product.update({ where: { id: f.product.id }, data: { basePriceKgs: 100 } });
    const draft = await f.api.salesOrders.createDraft({
      storeId: f.store.id,
      idempotencyKey: randomUUID(),
      lines: [{ productId: f.product.id, qty: 1 }],
    });
    await prisma.customerOrder.update({
      where: { id: draft.id },
      data: { externalOrderId: "INTEGRATION-42", trackingNumber: "TRACK-1", trackingCarrier: "Carrier" },
    });
    const before = await prisma.customerOrder.findUniqueOrThrow({
      where: { id: draft.id },
      include: { lines: true },
    });
    const updated = await f.api.salesOrders.update({
      customerOrderId: draft.id,
      expectedUpdatedAt: before.updatedAt.toISOString(),
      storeId: f.store.id,
      notes: "Edited",
      lines: [{ lineId: before.lines[0]!.id, productId: f.product.id, qty: 3 }],
      idempotencyKey: randomUUID(),
    });
    const after = await prisma.customerOrder.findUniqueOrThrow({
      where: { id: draft.id },
      include: { lines: true },
    });
    expect(updated.id).toBe(draft.id);
    expect(after.notes).toBe("Edited");
    expect(Number(after.totalKgs)).toBe(300);
    expect(after.lines[0]!.id).toBe(before.lines[0]!.id);
    expect(after.externalOrderId).toBe("INTEGRATION-42");
    expect(after.trackingNumber).toBe("TRACK-1");
    expect(after.createdById).toBe(before.createdById);
    expect(await prisma.customerOrder.count()).toBe(1);
  });

  it("synchronizes already deducted API stock by the edited quantity delta", async () => {
    const f = await seedApi();
    await prisma.product.update({ where: { id: f.product.id }, data: { basePriceKgs: 100 } });
    await adjustStock({
      organizationId: f.org.id,
      actorId: f.adminUser.id,
      storeId: f.store.id,
      productId: f.product.id,
      qtyDelta: 10,
      reason: "api stock fixture",
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
    });
    const draft = await f.api.salesOrders.createDraft({
      storeId: f.store.id,
      idempotencyKey: randomUUID(),
      lines: [{ productId: f.product.id, qty: 1 }],
    });
    await prisma.customerOrder.update({
      where: { id: draft.id },
      data: { source: "API", status: "CONFIRMED" },
    });
    await applyStockMovement(prisma, {
      organizationId: f.org.id,
      storeId: f.store.id,
      productId: f.product.id,
      qtyDelta: -1,
      type: "SALE",
      referenceType: "CustomerOrder",
      referenceId: draft.id,
      note: "API deduction",
      actorId: f.adminUser.id,
    });
    const before = await prisma.inventorySnapshot.findFirstOrThrow({
      where: { storeId: f.store.id, productId: f.product.id },
    });
    const line = await prisma.customerOrderLine.findFirstOrThrow({
      where: { customerOrderId: draft.id },
    });
    const current = await prisma.customerOrder.findUniqueOrThrow({ where: { id: draft.id } });
    await f.api.salesOrders.update({
      customerOrderId: draft.id,
      expectedUpdatedAt: current.updatedAt.toISOString(),
      storeId: f.store.id,
      lines: [{ lineId: line.id, productId: f.product.id, qty: 3 }],
      idempotencyKey: randomUUID(),
    });
    const after = await prisma.inventorySnapshot.findFirstOrThrow({
      where: { storeId: f.store.id, productId: f.product.id },
    });
    expect(Number(after.onHand)).toBe(Number(before.onHand) - 2);
    const net = await prisma.stockMovement.aggregate({
      where: {
        referenceType: "CustomerOrder",
        referenceId: draft.id,
        type: "SALE",
      },
      _sum: { qtyDelta: true },
    });
    expect(Number(net._sum.qtyDelta)).toBe(-3);
  });

  it("releases an applied loyalty discount before writing the edited line prices back", async () => {
    const f = await seedApi();
    await prisma.product.update({ where: { id: f.product.id }, data: { basePriceKgs: 100 } });
    const draft = await f.api.salesOrders.createDraft({
      storeId: f.store.id,
      idempotencyKey: randomUUID(),
      lines: [{ productId: f.product.id, qty: 2 }],
    });
    const line = await prisma.customerOrderLine.findFirstOrThrow({
      where: { customerOrderId: draft.id },
    });
    await prisma.customerOrderLine.update({
      where: { id: line.id },
      data: {
        unitPriceKgs: 80,
        lineTotalKgs: 160,
        manualPrice: true,
        priceSource: "MANUAL",
      },
    });
    await prisma.customerOrder.update({
      where: { id: draft.id },
      data: { subtotalKgs: 160, totalKgs: 160, discountKgs: 0 },
    });
    await prisma.loyaltyOrderApplication.create({
      data: {
        organizationId: f.org.id,
        programId: "program-1",
        memberId: "member-1",
        accountId: "account-1",
        customerOrderId: draft.id,
        status: "APPLIED",
        memberDiscountKgs: 40,
        pointsSpent: 0,
        eligibleKgs: 200,
        rulesSnapshot: { version: 2 },
        lineDistribution: [
          {
            lineId: line.id,
            productId: f.product.id,
            variantKey: "BASE",
            qty: 2,
            originalUnitPriceKgs: "100",
            originalLineTotalKgs: "200",
            baseUnitPriceKgs: "100",
            appliedLineTotalKgs: "160",
            appliedUnitPriceKgs: "80",
            redeemValueKgs: "40",
            earnWeightKgs: "160",
          },
        ],
      },
    });
    const current = await prisma.customerOrder.findUniqueOrThrow({ where: { id: draft.id } });
    await f.api.salesOrders.update({
      customerOrderId: draft.id,
      expectedUpdatedAt: current.updatedAt.toISOString(),
      storeId: f.store.id,
      notes: "Edit only notes",
      lines: [{ lineId: line.id, productId: f.product.id, qty: 2 }],
      idempotencyKey: randomUUID(),
    });
    const afterNotes = await prisma.customerOrderLine.findUniqueOrThrow({ where: { id: line.id } });
    expect(Number(afterNotes.unitPriceKgs)).toBe(80);
    expect(Number(afterNotes.lineTotalKgs)).toBe(160);
    expect(
      (await prisma.loyaltyOrderApplication.findUniqueOrThrow({
        where: { customerOrderId: draft.id },
      })).status,
    ).toBe("APPLIED");

    const notesOrder = await prisma.customerOrder.findUniqueOrThrow({ where: { id: draft.id } });
    // A stale client may still submit a manual line's current price. An
    // unchanged submitted price must not release the loyalty discount.
    await f.api.salesOrders.update({
      customerOrderId: draft.id,
      expectedUpdatedAt: notesOrder.updatedAt.toISOString(),
      storeId: f.store.id,
      lines: [
        {
          lineId: line.id,
          productId: f.product.id,
          qty: 2,
          unitPriceKgs: 80,
          priceSource: "MANUAL",
        },
      ],
      idempotencyKey: randomUUID(),
    });
    expect(
      (await prisma.loyaltyOrderApplication.findUniqueOrThrow({
        where: { customerOrderId: draft.id },
      })).status,
    ).toBe("APPLIED");
    const samePriceOrder = await prisma.customerOrder.findUniqueOrThrow({ where: { id: draft.id } });
    await f.api.salesOrders.update({
      customerOrderId: draft.id,
      expectedUpdatedAt: samePriceOrder.updatedAt.toISOString(),
      storeId: f.store.id,
      lines: [{ lineId: line.id, productId: f.product.id, qty: 3 }],
      idempotencyKey: randomUUID(),
    });
    const afterQty = await prisma.customerOrderLine.findUniqueOrThrow({ where: { id: line.id } });
    expect(Number(afterQty.unitPriceKgs)).toBe(100);
    expect(Number(afterQty.lineTotalKgs)).toBe(300);
    expect(
      (await prisma.loyaltyOrderApplication.findUniqueOrThrow({
        where: { customerOrderId: draft.id },
      })).status,
    ).toBe("RELEASED");
  });

  it("replays idempotently and rejects a stale editor", async () => {
    const f = await seedApi();
    await prisma.product.update({ where: { id: f.product.id }, data: { basePriceKgs: 100 } });
    const draft = await f.api.salesOrders.createDraft({
      storeId: f.store.id,
      idempotencyKey: randomUUID(),
      lines: [{ productId: f.product.id, qty: 1 }],
    });
    const before = await prisma.customerOrder.findUniqueOrThrow({
      where: { id: draft.id },
      include: { lines: true },
    });
    const key = randomUUID();
    const input = {
      customerOrderId: draft.id,
      expectedUpdatedAt: before.updatedAt.toISOString(),
      storeId: f.store.id,
      lines: [{ lineId: before.lines[0]!.id, productId: f.product.id, qty: 2 }],
      idempotencyKey: key,
    };
    const first = await f.api.salesOrders.update(input);
    const second = await f.api.salesOrders.update(input);
    expect(new Date(second.updatedAt).toISOString()).toBe(
      new Date(first.updatedAt).toISOString(),
    );
    expect(await prisma.customerOrder.count()).toBe(1);
    expect(await prisma.customerOrderLine.count()).toBe(1);
    await expect(
      f.api.salesOrders.update({
        ...input,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ message: "salesOrderStale" });
    expect(Number((await prisma.customerOrderLine.findFirstOrThrow()).qty)).toBe(2);
  });

  it("keeps historical prices when only the quantity changes after a catalogue edit", async () => {
    const f = await seedApi();
    await prisma.product.update({ where: { id: f.product.id }, data: { basePriceKgs: 100 } });
    const draft = await f.api.salesOrders.createDraft({
      storeId: f.store.id,
      idempotencyKey: randomUUID(),
      lines: [{ productId: f.product.id, qty: 1 }],
    });
    const before = await prisma.customerOrder.findUniqueOrThrow({
      where: { id: draft.id },
      include: { lines: true },
    });
    await prisma.product.update({ where: { id: f.product.id }, data: { basePriceKgs: 777 } });
    await f.api.salesOrders.update({
      customerOrderId: draft.id,
      expectedUpdatedAt: before.updatedAt.toISOString(),
      storeId: f.store.id,
      lines: [{ lineId: before.lines[0]!.id, productId: f.product.id, qty: 2 }],
      idempotencyKey: randomUUID(),
    });
    const after = await prisma.customerOrderLine.findFirstOrThrow({
      where: { customerOrderId: draft.id },
    });
    expect(Number(after.unitPriceKgs)).toBe(100);
    expect(Number(after.lineTotalKgs)).toBe(200);
    expect(after.manualPrice).toBe(false);
  });
});

describeDb("R6 inline customer creation", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("links an inline-created customer to the saved completed order and its history", async () => {
    const f = await seedApi();
    await prisma.product.update({ where: { id: f.product.id }, data: { basePriceKgs: 100 } });
    await adjustStock({
      organizationId: f.org.id,
      actorId: f.adminUser.id,
      storeId: f.store.id,
      productId: f.product.id,
      qtyDelta: 5,
      reason: "r6 inline customer",
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
    });
    const created = await f.api.customers.create({
      storeId: f.store.id,
      name: "Инлайн Клиент",
      phone: "+996700777888",
    });
    const sale = await f.api.salesOrders.createSale({
      storeId: f.store.id,
      customerId: created.customer.id,
      idempotencyKey: randomUUID(),
      lines: [{ productId: f.product.id, qty: 1 }],
    });
    const saved = await prisma.customerOrder.findUniqueOrThrow({ where: { id: sale.id } });
    expect(saved.customerId).toBe(created.customer.id);
    expect(saved.customerName).toBe("Инлайн Клиент");
    const detail = await f.api.customers.detail({ customerId: created.customer.id });
    expect(detail.recentOrders.some((order) => order.id === sale.id)).toBe(true);
  });

  it("matches an existing contact and never merges different people by name alone", async () => {
    const f = await seedApi();
    const first = await f.api.customers.create({
      storeId: f.store.id,
      name: "Айбек",
      phone: "+996700111222",
    });
    const second = await f.api.customers.create({
      storeId: f.store.id,
      name: "Айбек",
      phone: "+996700111222",
    });
    expect(second.customer.id).toBe(first.customer.id);
    expect(second.action).toBe("updated");
    const sameNameOtherPhone = await f.api.customers.create({
      storeId: f.store.id,
      name: "Айбек",
      phone: "+996700333444",
    });
    expect(sameNameOtherPhone.customer.id).not.toBe(first.customer.id);
    expect(await prisma.customer.count()).toBe(2);
    const staffApi = createTestCaller(asUser(f.staffUser));
    await expect(
      staffApi.customers.create({ storeId: f.store.id, name: "Staff customer", phone: "+996700555666" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
