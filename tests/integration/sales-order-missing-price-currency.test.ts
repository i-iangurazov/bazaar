import { randomUUID } from "node:crypto";
import type { Role } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { adjustStock } from "@/server/services/inventory";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;
const asUser = (user: {
  id: string;
  email: string;
  role: Role;
  organizationId: string | null;
  isOrgOwner?: boolean | null;
}) => ({ ...user, organizationId: user.organizationId!, isOrgOwner: Boolean(user.isOrgOwner) });

async function fixture() {
  const f = await seedBase({ plan: "ENTERPRISE" });
  await prisma.organization.update({
    where: { id: f.org.id },
    data: { retailWholesaleEnabled: true },
  });
  await prisma.product.update({ where: { id: f.product.id }, data: { basePriceKgs: 100 } });
  const unpriced = await prisma.product.create({
    data: {
      organizationId: f.org.id,
      supplierId: f.supplier.id,
      sku: "BZR-UNPRICED",
      name: "Unpriced item",
      unit: f.baseUnit.code,
      baseUnitId: f.baseUnit.id,
    },
  });
  await prisma.storeProduct.create({
    data: { organizationId: f.org.id, storeId: f.store.id, productId: unpriced.id, isActive: true },
  });
  for (const productId of [f.product.id, unpriced.id]) {
    await adjustStock({
      organizationId: f.org.id,
      actorId: f.adminUser.id,
      storeId: f.store.id,
      productId,
      qtyDelta: 40,
      reason: "bzr fixture",
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
    });
  }
  const register = await prisma.posRegister.create({
    data: { organizationId: f.org.id, storeId: f.store.id, name: "Register", code: "BZR" },
  });
  const shift = await prisma.registerShift.create({
    data: {
      organizationId: f.org.id,
      storeId: f.store.id,
      registerId: register.id,
      openedById: f.adminUser.id,
    },
  });
  return { ...f, unpriced, register, shift, api: createTestCaller(asUser(f.adminUser)) };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

const stockSnapshot = async (f: Fixture, productId: string) =>
  prisma.stockMovement.aggregate({
    where: { storeId: f.store.id, productId },
    _sum: { qtyDelta: true },
    _count: true,
  });

describeDb("BZR-03 missing price posting guard", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("blocks a RETAIL draft without a price and leaves status, stock, payments and movements unchanged", async () => {
    const f = await fixture();
    const draft = await f.api.salesOrders.createDraft({
      storeId: f.store.id,
      priceMode: "RETAIL",
      idempotencyKey: randomUUID(),
      lines: [{ productId: f.unpriced.id, qty: 1 }],
    });
    const line = await prisma.customerOrderLine.findFirstOrThrow({
      where: { customerOrderId: draft.id },
    });
    expect(line.priceSource).toBe("MISSING");
    expect(Number(line.unitPriceKgs)).toBe(0);

    // Draft editing stays available while the document is unresolved.
    const initial = await prisma.customerOrder.findUniqueOrThrow({ where: { id: draft.id } });
    await f.api.salesOrders.update({
      customerOrderId: draft.id,
      expectedUpdatedAt: initial.updatedAt.toISOString(),
      storeId: f.store.id,
      notes: "Waiting for a price",
      lines: [{ lineId: line.id, productId: f.unpriced.id, qty: 1 }],
      idempotencyKey: randomUUID(),
    });
    const edited = await prisma.customerOrder.findUniqueOrThrow({ where: { id: draft.id } });
    expect(edited.notes).toBe("Waiting for a price");
    expect(edited.status).toBe("DRAFT");

    await prisma.salePayment.create({
      data: {
        organizationId: f.org.id,
        storeId: f.store.id,
        shiftId: f.shift.id,
        customerOrderId: draft.id,
        method: "CASH",
        amountKgs: 5,
        createdById: f.adminUser.id,
      },
    });
    const stockBefore = await stockSnapshot(f, f.unpriced.id);
    const movementsBefore = await prisma.stockMovement.count();
    const paymentsBefore = await prisma.salePayment.count({ where: { customerOrderId: draft.id } });

    await expect(
      f.api.salesOrders.postSale({ customerOrderId: draft.id, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ message: "salesOrderPriceRequired" });

    const saved = await prisma.customerOrder.findUniqueOrThrow({ where: { id: draft.id } });
    expect(saved.status).toBe("DRAFT");
    expect(saved.completedAt).toBeNull();
    expect(Number(saved.totalKgs)).toBe(0);
    expect(await stockSnapshot(f, f.unpriced.id)).toEqual(stockBefore);
    expect(await prisma.stockMovement.count()).toBe(movementsBefore);
    expect(await prisma.salePayment.count({ where: { customerOrderId: draft.id } })).toBe(
      paymentsBefore,
    );
  });

  it("blocks a RETAIL draft after addLine and posts once a zero manual price is set", async () => {
    const f = await fixture();
    const draft = await f.api.salesOrders.createDraft({
      storeId: f.store.id,
      priceMode: "RETAIL",
      idempotencyKey: randomUUID(),
      lines: [{ productId: f.product.id, qty: 1 }],
    });
    await f.api.salesOrders.addLine({
      customerOrderId: draft.id,
      productId: f.unpriced.id,
      qty: 1,
    });
    const added = await prisma.customerOrderLine.findFirstOrThrow({
      where: { customerOrderId: draft.id, productId: f.unpriced.id },
    });
    expect(added.priceSource).toBe("MISSING");

    await expect(
      f.api.salesOrders.postSale({ customerOrderId: draft.id, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ message: "salesOrderPriceRequired" });
    expect(
      (await prisma.customerOrder.findUniqueOrThrow({ where: { id: draft.id } })).status,
    ).toBe("DRAFT");

    const current = await prisma.customerOrder.findUniqueOrThrow({
      where: { id: draft.id },
      include: { lines: true },
    });
    await f.api.salesOrders.update({
      customerOrderId: draft.id,
      expectedUpdatedAt: current.updatedAt.toISOString(),
      storeId: f.store.id,
      lines: current.lines.map((line) =>
        line.productId === f.unpriced.id
          ? {
              lineId: line.id,
              productId: line.productId,
              qty: line.qty,
              unitPriceKgs: 0,
              priceSource: "MANUAL" as const,
            }
          : { lineId: line.id, productId: line.productId, qty: line.qty },
      ),
      idempotencyKey: randomUUID(),
    });

    await f.api.salesOrders.postSale({ customerOrderId: draft.id, idempotencyKey: randomUUID() });
    const completed = await prisma.customerOrder.findUniqueOrThrow({
      where: { id: draft.id },
      include: { lines: true },
    });
    expect(completed.status).toBe("COMPLETED");
    const zeroLine = completed.lines.find((line) => line.productId === f.unpriced.id)!;
    expect(Number(zeroLine.unitPriceKgs)).toBe(0);
    expect(zeroLine.priceSource).toBe("MANUAL");
    expect(zeroLine.manualPrice).toBe(true);
    expect(Number(completed.totalKgs)).toBe(100);
  });

  it("posts a standalone zero-priced manual document and keeps zero as a real price", async () => {
    const f = await fixture();
    const draft = await f.api.salesOrders.createDraft({
      storeId: f.store.id,
      priceMode: "RETAIL",
      idempotencyKey: randomUUID(),
      lines: [{ productId: f.unpriced.id, qty: 1 }],
    });
    const line = await prisma.customerOrderLine.findFirstOrThrow({
      where: { customerOrderId: draft.id },
    });
    const saved = await prisma.customerOrder.findUniqueOrThrow({ where: { id: draft.id } });
    await f.api.salesOrders.update({
      customerOrderId: draft.id,
      expectedUpdatedAt: saved.updatedAt.toISOString(),
      storeId: f.store.id,
      lines: [
        {
          lineId: line.id,
          productId: f.unpriced.id,
          qty: 1,
          unitPriceKgs: 0,
          priceSource: "MANUAL",
        },
      ],
      idempotencyKey: randomUUID(),
    });
    await f.api.salesOrders.postSale({ customerOrderId: draft.id, idempotencyKey: randomUUID() });
    const completed = await prisma.customerOrder.findUniqueOrThrow({
      where: { id: draft.id },
      include: { lines: true },
    });
    expect(completed.status).toBe("COMPLETED");
    expect(Number(completed.lines[0]!.unitPriceKgs)).toBe(0);
    expect(completed.lines[0]!.priceSource).toBe("MANUAL");
    expect(Number(completed.totalKgs)).toBe(0);
  });

  it("still blocks wholesale when the wholesale price is missing", async () => {
    const f = await fixture();
    const draft = await f.api.salesOrders.createDraft({
      storeId: f.store.id,
      priceMode: "WHOLESALE",
      idempotencyKey: randomUUID(),
      lines: [{ productId: f.product.id, qty: 1 }],
    });
    const line = await prisma.customerOrderLine.findFirstOrThrow({
      where: { customerOrderId: draft.id },
    });
    expect(line.priceSource).toBe("MISSING");
    await expect(
      f.api.salesOrders.postSale({ customerOrderId: draft.id, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ message: "salesOrderPriceRequired" });
    expect(
      (await prisma.customerOrder.findUniqueOrThrow({ where: { id: draft.id } })).status,
    ).toBe("DRAFT");
  });

  it("posts after the blocking line receives an explicit manual price", async () => {
    const f = await fixture();
    const draft = await f.api.salesOrders.createDraft({
      storeId: f.store.id,
      priceMode: "RETAIL",
      idempotencyKey: randomUUID(),
      lines: [{ productId: f.unpriced.id, qty: 2 }],
    });
    const line = await prisma.customerOrderLine.findFirstOrThrow({
      where: { customerOrderId: draft.id },
    });
    const saved = await prisma.customerOrder.findUniqueOrThrow({ where: { id: draft.id } });
    await f.api.salesOrders.update({
      customerOrderId: draft.id,
      expectedUpdatedAt: saved.updatedAt.toISOString(),
      storeId: f.store.id,
      lines: [
        {
          lineId: line.id,
          productId: f.unpriced.id,
          qty: 2,
          unitPriceKgs: 55,
          priceSource: "MANUAL",
        },
      ],
      idempotencyKey: randomUUID(),
    });
    await f.api.salesOrders.postSale({ customerOrderId: draft.id, idempotencyKey: randomUUID() });
    const completed = await prisma.customerOrder.findUniqueOrThrow({
      where: { id: draft.id },
      include: { lines: true },
    });
    expect(completed.status).toBe("COMPLETED");
    expect(Number(completed.lines[0]!.unitPriceKgs)).toBe(55);
    expect(Number(completed.totalKgs)).toBe(110);
  });
});

describeDb("BZR-04 document currency snapshot", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("preserves the currency snapshot and KGS values on metadata and manual-price updates", async () => {
    const f = await fixture();
    await prisma.store.update({
      where: { id: f.store.id },
      data: { currencyCode: "USD", currencyRateKgsPerUnit: 80 },
    });
    const draft = await f.api.salesOrders.createDraft({
      storeId: f.store.id,
      priceMode: "RETAIL",
      idempotencyKey: randomUUID(),
      lines: [{ productId: f.product.id, qty: 2 }],
    });
    const created = await prisma.customerOrder.findUniqueOrThrow({
      where: { id: draft.id },
      include: { lines: true },
    });
    expect(created.currencyCode).toBe("USD");
    expect(Number(created.currencyRateKgsPerUnit)).toBe(80);
    expect(Number(created.lines[0]!.unitPriceKgs)).toBe(100);
    expect(Number(created.lines[0]!.lineTotalKgs)).toBe(200);
    expect(Number(created.totalKgs)).toBe(200);

    // The reference rate changes after the document was saved.
    await prisma.store.update({
      where: { id: f.store.id },
      data: { currencyCode: "USD", currencyRateKgsPerUnit: 100 },
    });

    await f.api.salesOrders.update({
      customerOrderId: draft.id,
      expectedUpdatedAt: created.updatedAt.toISOString(),
      storeId: f.store.id,
      notes: "Metadata only",
      lines: [{ lineId: created.lines[0]!.id, productId: f.product.id, qty: 2 }],
      idempotencyKey: randomUUID(),
    });
    const metadataOnly = await prisma.customerOrder.findUniqueOrThrow({
      where: { id: draft.id },
      include: { lines: true },
    });
    expect(metadataOnly.currencyCode).toBe("USD");
    expect(Number(metadataOnly.currencyRateKgsPerUnit)).toBe(80);
    expect(Number(metadataOnly.lines[0]!.unitPriceKgs)).toBe(100);
    expect(Number(metadataOnly.lines[0]!.lineTotalKgs)).toBe(200);
    expect(Number(metadataOnly.totalKgs)).toBe(200);

    await f.api.salesOrders.update({
      customerOrderId: draft.id,
      expectedUpdatedAt: metadataOnly.updatedAt.toISOString(),
      storeId: f.store.id,
      lines: [
        {
          lineId: metadataOnly.lines[0]!.id,
          productId: f.product.id,
          qty: 2,
          unitPriceKgs: 800,
          priceSource: "MANUAL",
        },
      ],
      idempotencyKey: randomUUID(),
    });
    const manual = await prisma.customerOrder.findUniqueOrThrow({
      where: { id: draft.id },
      include: { lines: true },
    });
    expect(manual.currencyCode).toBe("USD");
    expect(Number(manual.currencyRateKgsPerUnit)).toBe(80);
    expect(Number(manual.lines[0]!.unitPriceKgs)).toBe(800);
    expect(Number(manual.lines[0]!.lineTotalKgs)).toBe(1600);
    expect(Number(manual.totalKgs)).toBe(1600);
    expect(manual.lines[0]!.priceSource).toBe("MANUAL");

    const store = await prisma.store.findUniqueOrThrow({ where: { id: f.store.id } });
    expect(Number(store.currencyRateKgsPerUnit)).toBe(100);
  });
});
