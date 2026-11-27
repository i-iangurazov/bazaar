import { createHash, randomUUID } from "node:crypto";
import { Prisma, type Role } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as EmailMarketing from "@/server/services/emailMarketing";
import type * as InventoryService from "@/server/services/inventory";
import type * as OrderEmails from "@/server/services/orderEmails";

const effects = vi.hoisted(() => ({
  publish: vi.fn(),
  confirmEmail: vi.fn(async () => ({ status: "skipped", reason: "missingEmail" })),
  cancelEmail: vi.fn(async () => ({ status: "skipped", reason: "missingEmail" })),
  automation: vi.fn(async () => ({})),
  failPostingProductId: null as string | null,
  postingEffects: [] as string[],
}));
vi.mock("@/server/events/eventBus", () => ({ eventBus: { publish: effects.publish } }));
vi.mock("@/server/services/orderEmails", async (original) => ({
  ...(await original<typeof OrderEmails>()),
  sendOrderConfirmationEmail: effects.confirmEmail,
  sendOrderCancellationEmail: effects.cancelEmail,
}));
vi.mock("@/server/services/emailMarketing", async (original) => ({
  ...(await original<typeof EmailMarketing>()),
  processEmailAutomationTrigger: effects.automation,
}));
vi.mock("@/server/services/inventory", async (original) => {
  const actual = await original<typeof InventoryService>();
  const { AppError } = await import("@/server/services/errors");
  return {
    ...actual,
    applyStockMovement: vi.fn(async (...args: Parameters<typeof actual.applyStockMovement>) => {
      const result = await actual.applyStockMovement(...args);
      const input = args[1];
      if (effects.failPostingProductId && input.type === "SALE") {
        effects.postingEffects.push(input.productId);
        if (input.productId === effects.failPostingProductId) {
          throw new AppError("insufficientStock", "CONFLICT", 409);
        }
      }
      return result;
    }),
  };
});

import { prisma } from "@/server/db/prisma";
import { adjustStock, applyStockMovement } from "@/server/services/inventory";
import { postCustomerSale, removeDeclinedCustomerOrderLine } from "@/server/services/salesOrders";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;
const asUser = (user: { id: string; email: string; role: Role; organizationId: string | null; isOrgOwner?: boolean | null }) => ({
  ...user, organizationId: user.organizationId!, isOrgOwner: Boolean(user.isOrgOwner),
});

async function fixture() {
  const f = await seedBase({ plan: "ENTERPRISE" });
  await prisma.product.update({ where: { id: f.product.id }, data: { basePriceKgs: 120 } });
  const second = await prisma.product.create({ data: {
    organizationId: f.org.id, supplierId: f.supplier.id, sku: "FAST-SECOND", name: "Second item",
    unit: f.baseUnit.code, baseUnitId: f.baseUnit.id, basePriceKgs: 50,
  } });
  await prisma.storeProduct.create({ data: { organizationId: f.org.id, storeId: f.store.id, productId: second.id, isActive: true } });
  await prisma.storePrice.create({ data: {
    organizationId: f.org.id, storeId: f.store.id, productId: f.product.id, variantKey: "BASE",
    priceKgs: 100, discountType: "PERCENTAGE", discountPercentage: 20,
  } });
  for (const [productId, cost] of [[f.product.id, 40], [second.id, 10]] as const) {
    await prisma.productCost.create({ data: { organizationId: f.org.id, productId, variantKey: "BASE", avgCostKgs: cost } });
    await adjustStock({ organizationId: f.org.id, actorId: f.adminUser.id, storeId: f.store.id,
      productId, qtyDelta: 20, reason: "fast-sale fixture", idempotencyKey: randomUUID(), requestId: randomUUID() });
  }
  const customer = await prisma.customer.create({ data: {
    organizationId: f.org.id, storeId: f.store.id, name: "Known customer", phone: "555-legacy", address: "---",
  } });
  return { ...f, second, customer, api: createTestCaller(asUser(f.adminUser)) };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const orderInput = (f: Fixture) => ({ storeId: f.store.id, customerId: f.customer.id,
  idempotencyKey: randomUUID(), lines: [{ productId: f.product.id, qty: 2 }, { productId: f.second.id, qty: 1 }] });
const savedOrder = (id: string) => prisma.customerOrder.findUniqueOrThrow({ where: { id }, include: { lines: { orderBy: { productId: "asc" } } } });
async function readyOrder(f: Fixture) {
  const draft = await f.api.salesOrders.createDraft(orderInput(f));
  return prisma.customerOrder.update({ where: { id: draft.id }, data: { status: "READY", confirmedAt: new Date(), readyAt: new Date() }, include: { lines: true } });
}
async function accounting(f: Fixture) {
  return {
    stock: await prisma.inventorySnapshot.findMany({ where: { storeId: f.store.id }, orderBy: { productId: "asc" } }),
    movements: await prisma.stockMovement.findMany({ where: { storeId: f.store.id }, orderBy: { id: "asc" } }),
    orders: await prisma.customerOrder.findMany({ where: { organizationId: f.org.id }, include: { lines: { orderBy: { id: "asc" } } }, orderBy: { id: "asc" } }),
    payments: await prisma.salePayment.findMany({ where: { organizationId: f.org.id }, orderBy: { id: "asc" } }),
    audits: await prisma.auditLog.count({ where: { organizationId: f.org.id } }),
    customer: await prisma.customer.findUniqueOrThrow({ where: { id: f.customer.id } }),
  };
}
async function amendmentInput(f: Fixture, id: string) {
  const order = await savedOrder(id);
  return { customerOrderId: id, lineId: order.lines.find((line) => line.productId === f.second.id)!.id,
    expectedUpdatedAt: order.updatedAt.toISOString(), idempotencyKey: randomUUID(), reason: "Customer declined the second item" };
}
async function openShift(f: Fixture) {
  const register = await prisma.posRegister.create({ data: { organizationId: f.org.id, storeId: f.store.id, name: "Test register", code: randomUUID() } });
  const shift = await f.api.pos.shifts.open({ registerId: register.id, openingCashKgs: 0, idempotencyKey: randomUUID() });
  return { register, shift };
}

describeDb("immediate ordinary sales and explicit declined-item corrections", () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();
    effects.failPostingProductId = null;
    effects.postingEffects = [];
  });

  it("creates and posts once without shifts, intermediate emails or changes to catalogue prices", async () => {
    const f = await fixture();
    const input = { ...orderInput(f), lines: [{ productId: f.product.id, qty: 2, unitPriceKgs: 75 }, { productId: f.second.id, qty: 1 }] };
    const sale = await f.api.salesOrders.createSale(input);
    expect(sale.status).toBe("COMPLETED");
    const beforeReplay = await accounting(f);
    expect((await f.api.salesOrders.createSale(input)).id).toBe(sale.id);
    expect(await accounting(f)).toEqual(beforeReplay);
    await expect(f.api.salesOrders.createSale({ ...input, lines: [{ ...input.lines[0]!, unitPriceKgs: 76 }, input.lines[1]!] })).rejects.toMatchObject({ message: "operationRequestPayloadMismatch" });
    const saved = await savedOrder(sale.id);
    expect(Number(saved.totalKgs)).toBe(200);
    expect(saved.customerId).toBe(f.customer.id);
    expect(saved.customerPhone).toBe("555-legacy");
    expect(saved.isPosSale).toBe(false);
    expect(saved.registerId).toBeNull();
    expect(saved.confirmedAt).toBeInstanceOf(Date);
    expect(saved.readyAt).toBeInstanceOf(Date);
    expect(await prisma.registerShift.count()).toBe(0);
    expect(await prisma.salePayment.count()).toBe(0);
    expect(effects.confirmEmail).not.toHaveBeenCalled();
    expect(effects.cancelEmail).not.toHaveBeenCalled();
    expect(effects.automation).not.toHaveBeenCalled();
    expect(await prisma.auditLog.count({ where: { entityId: sale.id, action: "SALES_ORDER_STATUS_UPDATE" } })).toBe(0);
    expect(await prisma.stockMovement.count({ where: { referenceId: sale.id, type: "SALE" } })).toBe(2);
    expect(Number((await prisma.product.findUniqueOrThrow({ where: { id: f.product.id } })).basePriceKgs)).toBe(120);
    expect(Number((await prisma.storePrice.findFirstOrThrow({ where: { productId: f.product.id } })).priceKgs)).toBe(100);
  });

  it("rolls all creation, customer counters and stock back when posting cannot finish", async () => {
    const f = await fixture();
    const before = await accounting(f);
    // Sales intentionally permit negative balances. Inject a late stock failure
    // after both real DB mutations to verify atomic rollback, independently of
    // that policy and without treating authorization failure as rollback proof.
    effects.failPostingProductId = f.second.id;
    await expect(f.api.salesOrders.createSale(orderInput(f))).rejects.toMatchObject({ message: "insufficientStock", code: "CONFLICT" });
    expect(effects.postingEffects).toEqual([f.product.id, f.second.id]);
    expect(await accounting(f)).toEqual(before);
    effects.failPostingProductId = null;
    await expect(f.api.salesOrders.createSale({ ...orderInput(f), lines: [] })).rejects.toMatchObject({ message: "salesOrderEmpty" });
    expect(await accounting(f)).toEqual(before);
    const variant = await prisma.productVariant.create({ data: { productId: f.product.id, name: "Inactive", attributes: {}, isActive: false } });
    await expect(f.api.salesOrders.createSale({ ...orderInput(f), lines: [{ productId: f.product.id, variantId: variant.id, qty: 1 }] })).rejects.toMatchObject({ message: "variantNotFound" });
    expect(await prisma.customerOrder.count()).toBe(0);
  });

  it("requires a resolved price for new and saved sales and accepts an intentional zero", async () => {
    const f = await fixture();
    await prisma.storePrice.deleteMany({ where: { storeId: f.store.id, productId: f.product.id } });
    await prisma.product.update({ where: { id: f.product.id }, data: { basePriceKgs: null } });
    const input = { ...orderInput(f), lines: [{ productId: f.product.id, qty: 1 }] };
    expect(await f.api.salesOrders.linePrice({ storeId: f.store.id, productId: f.product.id })).toEqual({ unitPriceKgs: 0, hasConfiguredPrice: false, priceMode: "RETAIL", priceSource: "MISSING" });
    const before = await accounting(f);
    await expect(f.api.salesOrders.createSale(input)).rejects.toMatchObject({ message: "salesOrderPriceRequired", code: "BAD_REQUEST" });
    expect(await accounting(f)).toEqual(before);
    // A saved draft keeps its zero-price snapshot for editing, but an unresolved
    // line cannot be posted in either price mode.
    const legacy = await f.api.salesOrders.createDraft({ ...input, idempotencyKey: randomUUID() });
    expect(Number((await savedOrder(legacy.id)).totalKgs)).toBe(0);
    await expect(
      f.api.salesOrders.postSale({ customerOrderId: legacy.id, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ message: "salesOrderPriceRequired" });
    expect((await savedOrder(legacy.id)).status).toBe("DRAFT");
    const manual = await f.api.salesOrders.createSale({ ...input, idempotencyKey: randomUUID(), lines: [{ productId: f.product.id, qty: 1, unitPriceKgs: 0 }] });
    expect(Number((await savedOrder(manual.id)).totalKgs)).toBe(0);
    expect((await savedOrder(manual.id)).lines[0]!.priceSource).toBe("MANUAL");
    await prisma.product.update({ where: { id: f.product.id }, data: { basePriceKgs: 0 } });
    expect(await f.api.salesOrders.linePrice({ storeId: f.store.id, productId: f.product.id })).toEqual({ unitPriceKgs: 0, hasConfiguredPrice: true, priceMode: "RETAIL", priceSource: "STANDARD" });
    const configured = await f.api.salesOrders.createSale({ ...input, idempotencyKey: randomUUID() });
    expect(Number((await savedOrder(configured.id)).totalKgs)).toBe(0);
    const beforeNegative = await accounting(f);
    await expect(f.api.salesOrders.createSale({ ...input, idempotencyKey: randomUUID(), lines: [{ productId: f.product.id, qty: 1, unitPriceKgs: -1 }] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await accounting(f)).toEqual(beforeNegative);
  });

  it("posts DRAFT, CONFIRMED and READY directly while preserving the strict old completion route", async () => {
    const f = await fixture();
    for (const status of ["DRAFT", "CONFIRMED", "READY"] as const) {
      const draft = await f.api.salesOrders.createDraft({ ...orderInput(f), lines: [{ productId: f.product.id, qty: 1 }] });
      await prisma.customerOrder.update({ where: { id: draft.id }, data: { status } });
      if (status !== "READY") {
        await expect(f.api.salesOrders.complete({ customerOrderId: draft.id, idempotencyKey: randomUUID() })).rejects.toMatchObject({ message: "invalidTransition" });
      }
      const request = { customerOrderId: draft.id, idempotencyKey: randomUUID() };
      expect((await f.api.salesOrders.postSale(request)).status).toBe("COMPLETED");
      await f.api.salesOrders.postSale(request);
      const line = (await savedOrder(draft.id)).lines[0]!;
      expect(Number(line.unitPriceKgs)).toBe(80);
      expect(line.appliedDiscountType).toBe("PERCENTAGE");
      expect(await prisma.stockMovement.count({ where: { referenceId: draft.id, type: "SALE" } })).toBe(1);
    }
    expect(effects.confirmEmail).not.toHaveBeenCalled();
    expect(effects.automation).not.toHaveBeenCalled();
  });

  it("binds completion keys to order identity and safely replays older response-hashed records", async () => {
    const f = await fixture();
    const first = await readyOrder(f);
    const second = await readyOrder(f);
    const key = randomUUID();
    await f.api.salesOrders.complete({ customerOrderId: first.id, idempotencyKey: key });
    await expect(f.api.salesOrders.complete({ customerOrderId: second.id, idempotencyKey: key })).rejects.toMatchObject({ message: "idempotencyKeyPayloadMismatch" });
    const legacyKey = randomUUID();
    const legacyResponse = { id: first.id, number: first.number, status: "COMPLETED", storeId: f.store.id, productIds: [f.product.id, f.second.id] };
    await prisma.idempotencyKey.create({ data: {
      key: legacyKey, route: "salesOrders.complete", userId: f.adminUser.id,
      response: legacyResponse, responseHash: createHash("sha256").update(JSON.stringify(legacyResponse)).digest("hex"),
    } });
    const before = await accounting(f);
    expect((await f.api.salesOrders.complete({ customerOrderId: first.id, idempotencyKey: legacyKey })).id).toBe(first.id);
    await expect(f.api.salesOrders.complete({ customerOrderId: second.id, idempotencyKey: legacyKey })).rejects.toMatchObject({ message: "idempotencyKeyPayloadMismatch" });
    expect(await accounting(f)).toEqual(before);
    expect((await savedOrder(second.id)).status).toBe("READY");
  });

  it("posts fractional variant quantities with the stored transaction currency", async () => {
    const f = await fixture();
    await prisma.unit.update({ where: { id: f.baseUnit.id }, data: { quantityPrecision: 3 } });
    await prisma.store.update({ where: { id: f.store.id }, data: { currencyCode: "USD", currencyRateKgsPerUnit: 90 } });
    const variant = await prisma.productVariant.create({ data: { productId: f.product.id, name: "Fractional variant", attributes: {} } });
    await adjustStock({ organizationId: f.org.id, actorId: f.adminUser.id, storeId: f.store.id,
      productId: f.product.id, variantId: variant.id, qtyDelta: 2.5, reason: "variant fixture", idempotencyKey: randomUUID(), requestId: randomUUID() });
    const sale = await f.api.salesOrders.createSale({ ...orderInput(f), lines: [{ productId: f.product.id, variantId: variant.id, qty: 0.125, unitPriceKgs: 12.5 }] });
    const saved = await savedOrder(sale.id);
    expect(saved.currencyCode).toBe("USD");
    expect(Number(saved.currencyRateKgsPerUnit)).toBe(90);
    expect(saved.lines[0]!.variantId).toBe(variant.id);
    expect(Number(saved.totalKgs)).toBe(1.56);
    expect((await prisma.inventorySnapshot.findFirstOrThrow({ where: { storeId: f.store.id, productId: f.product.id, variantId: variant.id } })).onHand).toBe(2.375);
  });

  it("adds a variant to the same unpaid sale and posts its stock only once across retries", async () => {
    const f = await fixture();
    const manager = createTestCaller(asUser(f.managerUser));
    await prisma.unit.update({ where: { id: f.baseUnit.id }, data: { quantityPrecision: 3 } });
    await prisma.store.update({ where: { id: f.store.id }, data: { currencyCode: "USD", currencyRateKgsPerUnit: 90 } });
    const variant = await prisma.productVariant.create({
      data: { productId: f.second.id, name: "New sellable variant", attributes: {} },
    });
    await adjustStock({
      organizationId: f.org.id, actorId: f.adminUser.id, storeId: f.store.id,
      productId: f.second.id, variantId: variant.id, qtyDelta: 5, reason: "append fixture",
      idempotencyKey: randomUUID(), requestId: randomUUID(),
    });
    const sale = await f.api.salesOrders.createSale({
      ...orderInput(f), lines: [{ productId: f.product.id, qty: 2, unitPriceKgs: 75 }],
    });
    const original = await savedOrder(sale.id);
    const request = {
      customerOrderId: sale.id, productId: f.second.id, variantId: variant.id, qty: 1.25,
      unitPriceKgs: 49.95, expectedUpdatedAt: original.updatedAt.toISOString(), idempotencyKey: randomUUID(),
    };
    expect(await manager.salesOrders.paymentInfo({ customerOrderId: sale.id })).toMatchObject({
      canAppendUnpaidLine: true, hasEvidence: false, remainingKgs: 150,
    });
    effects.publish.mockClear();
    const [added, retried] = await Promise.all([
      manager.salesOrders.appendUnpaidLine(request),
      manager.salesOrders.appendUnpaidLine(request),
    ]);
    expect(retried).toEqual(added);
    expect(added).toMatchObject({
      customerOrderId: original.id, productId: f.second.id, variantId: variant.id,
      qty: 1.25, unitPriceKgs: 49.95, lineTotalKgs: 62.44, unitCostKgs: 10, lineCostTotalKgs: 12.5,
    });
    const updated = await savedOrder(sale.id);
    expect(updated).toMatchObject({
      number: original.number, status: original.status, customerId: original.customerId,
      currencyCode: "USD", completedAt: original.completedAt, completedEventId: original.completedEventId,
    });
    expect(updated.lines).toHaveLength(2);
    expect(updated.lines.find((line) => line.id === original.lines[0]!.id)).toEqual(original.lines[0]);
    expect(Number(updated.totalKgs)).toBe(212.44);
    expect(await manager.salesOrders.paymentInfo({ customerOrderId: sale.id })).toMatchObject({
      canAppendUnpaidLine: true, hasEvidence: false, remainingKgs: 212.44,
    });
    const movements = await prisma.stockMovement.findMany({ where: { referenceId: original.id } });
    expect(movements).toHaveLength(2);
    expect(movements.find((movement) => movement.productId === f.second.id)).toMatchObject({
      variantId: variant.id, qtyDelta: -1.25, type: "SALE", referenceType: "CustomerOrder",
    });
    expect(await prisma.inventorySnapshot.findFirstOrThrow({
      where: { storeId: f.store.id, productId: f.second.id, variantId: variant.id },
    })).toMatchObject({ onHand: 3.75 });
    expect(await prisma.salePayment.count()).toBe(0);
    expect(await prisma.saleReturn.count()).toBe(0);
    expect(await prisma.fiscalReceipt.count()).toBe(0);
    expect(await prisma.customerOrder.count()).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: sale.id, action: "SALES_ORDER_UNPAID_LINE_APPEND" } })).toBe(1);
    expect(effects.publish).toHaveBeenCalledExactlyOnceWith({
      type: "inventory.updated", payload: { storeId: f.store.id, productId: f.second.id, variantId: variant.id },
    });
    await expect(manager.salesOrders.appendUnpaidLine({ ...request, qty: 1.5 })).rejects.toMatchObject({ message: "idempotencyKeyPayloadMismatch" });
    await expect(manager.salesOrders.appendUnpaidLine({
      ...request, idempotencyKey: randomUUID(),
    })).rejects.toMatchObject({ message: "salesOrderAmendmentStale" });
    await expect(manager.salesOrders.appendUnpaidLine({
      ...request, idempotencyKey: randomUUID(), expectedUpdatedAt: updated.updatedAt.toISOString(),
    })).rejects.toMatchObject({ message: "duplicateLineItem" });
  });

  it("edits the same unpaid posted sale and reconciles quantities and lots exactly once", async () => {
    const f = await fixture();
    await f.api.stores.updatePolicy({ storeId: f.store.id, allowNegativeStock: false, trackExpiryLots: true });
    const variant = await prisma.productVariant.create({
      data: { productId: f.product.id, name: "Replacement variant", attributes: {} },
    });
    await adjustStock({
      organizationId: f.org.id, actorId: f.adminUser.id, storeId: f.store.id,
      productId: f.product.id, variantId: variant.id, qtyDelta: 5, reason: "replacement fixture",
      idempotencyKey: randomUUID(), requestId: randomUUID(),
    });
    const sale = await f.api.salesOrders.createSale({
      ...orderInput(f),
      lines: [{ productId: f.product.id, qty: 12, unitPriceKgs: 75 }, { productId: f.second.id, qty: 3 }],
    });
    const original = await savedOrder(sale.id);
    const originalLine = original.lines.find((line) => line.productId === f.product.id)!;
    const removedAssignment = await prisma.storeProduct.update({
      where: { storeId_productId: { storeId: f.store.id, productId: f.second.id } },
      data: { isActive: false, isHidden: true },
    });
    const newCustomer = await prisma.customer.create({
      data: { organizationId: f.org.id, storeId: f.store.id, name: "Updated customer" },
    });
    const request = {
      customerOrderId: sale.id, storeId: f.store.id, expectedUpdatedAt: original.updatedAt.toISOString(),
      idempotencyKey: randomUUID(), customerId: newCustomer.id,
      lines: [
        { lineId: originalLine.id, productId: f.product.id, qty: 7, unitPriceKgs: 95 },
        { productId: f.product.id, variantId: variant.id, qty: 2, unitPriceKgs: 50 },
      ],
    };
    const amendment = { ...request, amendCompleted: true as const };
    await expect(f.api.salesOrders.update(request)).rejects.toMatchObject({ message: "salesOrderNotEditable" });
    const staff = createTestCaller(asUser(f.staffUser));
    await expect(staff.salesOrders.update(amendment)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await f.api.salesOrders.paymentInfo({ customerOrderId: sale.id })).toMatchObject({ canAppendUnpaidLine: true });

    effects.publish.mockClear();
    const manager = createTestCaller(asUser(f.managerUser));
    const [updated, retry] = await Promise.all([
      manager.salesOrders.update(amendment),
      manager.salesOrders.update(amendment),
    ]);
    expect(retry).toEqual(updated);
    expect(updated).toMatchObject({ id: sale.id, number: original.number, status: "COMPLETED", totalKgs: 765 });
    const saved = await savedOrder(sale.id);
    expect(saved).toMatchObject({
      completedAt: original.completedAt, completedEventId: original.completedEventId,
      customerId: newCustomer.id, customerName: newCustomer.name, shiftId: null,
    });
    expect(saved.lines).toHaveLength(2);
    expect(saved.lines.find((line) => line.id === originalLine.id)).toMatchObject({
      qty: 7, unitPriceKgs: new Prisma.Decimal(95),
      unitCostKgs: originalLine.unitCostKgs, lineCostTotalKgs: new Prisma.Decimal(280),
    });
    expect(await manager.inventory.productMovementDocument({
      documentKey: `SALE:CustomerOrder:${sale.id}`,
    })).toMatchObject({
      documentNumber: original.number, positionsCount: 2, totalQuantity: 9, totalAmount: 765,
    });
    for (const [productId, variantId, onHand] of [
      [f.product.id, null, 13], [f.second.id, null, 20], [f.product.id, variant.id, 3],
    ] as const) {
      const scope = { storeId: f.store.id, productId, variantId };
      expect(await prisma.inventorySnapshot.findFirstOrThrow({ where: scope })).toMatchObject({ onHand });
      expect((await prisma.stockLot.aggregate({ where: scope, _sum: { onHandQty: true } }))._sum.onHandQty).toBe(onHand);
    }
    const restored = await prisma.stockMovement.findFirstOrThrow({
      where: { referenceId: sale.id, productId: f.second.id, qtyDelta: 3 },
    });
    expect(restored).toMatchObject({ type: "SALE", referenceType: "CustomerOrder" });
    expect(restored.stockLotId).toBe((await prisma.stockMovement.findFirstOrThrow({
      where: { referenceId: sale.id, productId: f.second.id, qtyDelta: -3 },
    })).stockLotId);
    expect(await prisma.storeProduct.findUniqueOrThrow({ where: { id: removedAssignment.id } })).toEqual(removedAssignment);
    expect(await prisma.stockMovement.count({ where: { referenceId: sale.id } })).toBe(5);
    expect(await prisma.customerOrder.count()).toBe(1);
    expect(await prisma.salePayment.count()).toBe(0);
    expect(await prisma.saleReturn.count()).toBe(0);
    expect(await prisma.fiscalReceipt.count()).toBe(0);
    expect(await prisma.registerShift.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityId: sale.id, action: "SALES_ORDER_UNPAID_UPDATE" } })).toBe(1);
    expect(effects.publish).toHaveBeenCalledExactlyOnceWith({
      type: "inventory.updated", payload: { storeId: f.store.id, productId: "*" },
    });
    expect(await f.api.salesOrders.paymentInfo({ customerOrderId: sale.id })).toMatchObject({
      canAppendUnpaidLine: true, hasEvidence: false, remainingKgs: 765,
    });
    await expect(manager.salesOrders.update({ ...amendment, idempotencyKey: randomUUID() }))
      .rejects.toMatchObject({ message: "salesOrderAmendmentStale" });

    const { shift } = await openShift(f);
    await f.api.salesOrders.recordPayment({
      customerOrderId: sale.id, shiftId: shift.id, amountKgs: 1, method: "CASH", idempotencyKey: randomUUID(),
    });
    const paidAccounting = await accounting(f);
    await expect(manager.salesOrders.update({
      ...amendment, expectedUpdatedAt: saved.updatedAt.toISOString(), idempotencyKey: randomUUID(),
    })).rejects.toMatchObject({ message: "salesOrderAmendmentRequiresReturn" });
    expect(await accounting(f)).toEqual(paidAccounting);
  });

  it("denies append for staff, revoked stores, paid sales and closed periods without changing accounting", async () => {
    const f = await fixture();
    const { shift } = await openShift(f);
    const sale = await f.api.salesOrders.createSale({
      ...orderInput(f), lines: [{ productId: f.product.id, qty: 1 }],
    });
    const original = await savedOrder(sale.id);
    const request = {
      customerOrderId: sale.id, productId: f.second.id, qty: 1,
      expectedUpdatedAt: original.updatedAt.toISOString(), idempotencyKey: randomUUID(),
    };
    const staff = createTestCaller(asUser(f.staffUser));
    expect(await staff.salesOrders.paymentInfo({ customerOrderId: sale.id })).toMatchObject({ canAppendUnpaidLine: false });
    await expect(staff.salesOrders.appendUnpaidLine(request)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const manager = createTestCaller(asUser(f.managerUser));
    await prisma.userStoreAccess.deleteMany({ where: { userId: f.managerUser.id } });
    await expect(manager.salesOrders.appendUnpaidLine(request)).rejects.toMatchObject({ message: "storeAccessDenied" });

    await f.api.salesOrders.recordPayment({
      customerOrderId: sale.id, shiftId: shift.id, amountKgs: 1,
      method: "CASH", idempotencyKey: randomUUID(),
    });
    expect(await f.api.salesOrders.paymentInfo({ customerOrderId: sale.id })).toMatchObject({ canAppendUnpaidLine: false });
    const paidAccounting = await accounting(f);
    await expect(f.api.salesOrders.appendUnpaidLine(request)).rejects.toMatchObject({ message: "salesOrderAmendmentRequiresReturn" });
    expect(await accounting(f)).toEqual(paidAccounting);

    const another = await f.api.salesOrders.createSale({
      ...orderInput(f), lines: [{ productId: f.product.id, qty: 1 }],
    });
    const completed = await savedOrder(another.id);
    const amendedAt = completed.completedAt!.getTime();
    await f.api.periodClose.close({
      storeId: f.store.id, periodStart: new Date(amendedAt - 1000), periodEnd: new Date(amendedAt + 1000),
    });
    expect(await f.api.salesOrders.paymentInfo({ customerOrderId: another.id })).toMatchObject({ canAppendUnpaidLine: false });
    const closedAccounting = await accounting(f);
    await expect(f.api.salesOrders.appendUnpaidLine({
      ...request, customerOrderId: another.id, expectedUpdatedAt: completed.updatedAt.toISOString(), idempotencyKey: randomUUID(),
    })).rejects.toMatchObject({ message: "salesOrderAmendmentPeriodClosed" });
    expect(await accounting(f)).toEqual(closedAccounting);
  });

  it("requires review of an updated catalogue price before appending to a posted sale", async () => {
    const f = await fixture();
    const sale = await f.api.salesOrders.createSale({
      ...orderInput(f), lines: [{ productId: f.product.id, qty: 1 }],
    });
    const order = await savedOrder(sale.id);
    const request = {
      customerOrderId: sale.id, productId: f.second.id, qty: 1, expectedUnitPriceKgs: 50,
      expectedUpdatedAt: order.updatedAt.toISOString(), idempotencyKey: randomUUID(),
    };
    await prisma.product.update({ where: { id: f.second.id }, data: { basePriceKgs: 65 } });
    const before = await accounting(f);
    await expect(f.api.salesOrders.appendUnpaidLine(request)).rejects.toMatchObject({ message: "salesOrderPriceChanged" });
    expect(await accounting(f)).toEqual(before);
    const reviewed = { ...request, expectedUnitPriceKgs: 65, idempotencyKey: randomUUID() };
    expect(await f.api.salesOrders.appendUnpaidLine(reviewed)).toMatchObject({
      unitPriceKgs: 65, lineTotalKgs: 65, manualPrice: false,
    });
    await expect(f.api.salesOrders.appendUnpaidLine({
      ...reviewed, expectedUnitPriceKgs: 50,
    })).rejects.toMatchObject({ message: "idempotencyKeyPayloadMismatch" });
  });

  it("requires a current manager role and authorized store for all new commands", async () => {
    const f = await fixture();
    const ready = await readyOrder(f);
    const remove = await amendmentInput(f, ready.id);
    const hidden = await prisma.store.create({ data: { organizationId: f.org.id, name: "Hidden", code: "HIDDEN" } });
    const foreignOrg = await prisma.organization.create({ data: { name: "Foreign", plan: "ENTERPRISE" } });
    const foreignStore = await prisma.store.create({ data: { organizationId: foreignOrg.id, name: "Foreign", code: "FOREIGN" } });
    const manager = createTestCaller(asUser(f.managerUser));
    for (const user of [f.staffUser, f.cashierUser]) {
      const caller = createTestCaller(asUser(user));
      await expect(caller.salesOrders.createSale(orderInput(f))).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller.salesOrders.postSale({ customerOrderId: ready.id, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller.salesOrders.removeDeclinedLine(remove)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(manager.salesOrders.createSale({ ...orderInput(f), storeId: hidden.id })).rejects.toMatchObject({ message: "storeAccessDenied" });
    await expect(f.api.salesOrders.createSale({ ...orderInput(f), storeId: foreignStore.id })).rejects.toMatchObject({ message: "storeAccessDenied" });
    const staleRole = createTestCaller({ ...asUser(f.staffUser), role: "ADMIN" });
    await expect(staleRole.salesOrders.createSale(orderInput(f))).rejects.toMatchObject({ message: "forbidden" });
    await expect(postCustomerSale({ organizationId: f.org.id, actorId: f.staffUser.id, customerOrderId: ready.id, idempotencyKey: randomUUID(), requestId: randomUUID() })).rejects.toMatchObject({ message: "forbidden" });
    await expect(removeDeclinedCustomerOrderLine({ ...remove, organizationId: f.org.id, actorId: f.staffUser.id, requestId: randomUUID() })).rejects.toMatchObject({ message: "forbidden" });
    await prisma.userStoreAccess.deleteMany({ where: { userId: f.managerUser.id } });
    await expect(manager.salesOrders.postSale({ customerOrderId: ready.id, idempotencyKey: randomUUID() })).rejects.toMatchObject({ message: "storeAccessDenied" });
    const foreignCaller = createTestCaller({ ...asUser(f.adminUser), organizationId: foreignOrg.id });
    await expect(foreignCaller.salesOrders.postSale({ customerOrderId: ready.id, idempotencyKey: randomUUID() })).rejects.toMatchObject({ message: "salesOrderNotFound" });
    expect((await savedOrder(ready.id)).status).toBe("READY");
  });

  it("deducts stock once under concurrent posting and does not deduct an API order twice", async () => {
    const f = await fixture();
    const draft = await f.api.salesOrders.createDraft(orderInput(f));
    const results = await Promise.all([
      f.api.salesOrders.postSale({ customerOrderId: draft.id, idempotencyKey: randomUUID() }),
      f.api.salesOrders.postSale({ customerOrderId: draft.id, idempotencyKey: randomUUID() }),
    ]);
    expect(results.every((result) => result.id === draft.id && result.status === "COMPLETED")).toBe(true);
    expect(await prisma.stockMovement.count({ where: { referenceId: draft.id, type: "SALE" } })).toBe(2);
    expect(await prisma.auditLog.count({ where: { entityId: draft.id, action: "SALES_ORDER_COMPLETE" } })).toBe(1);
    const apiOrder = await f.api.salesOrders.createDraft({ ...orderInput(f), lines: [{ productId: f.product.id, qty: 2 }] });
    await prisma.customerOrder.update({ where: { id: apiOrder.id }, data: { source: "API" } });
    await prisma.$transaction((tx) => applyStockMovement(tx, {
      organizationId: f.org.id, actorId: f.adminUser.id, storeId: f.store.id, productId: f.product.id,
      qtyDelta: -2, type: "SALE", referenceType: "CustomerOrder", referenceId: apiOrder.id,
    }));
    const beforeStock = await prisma.inventorySnapshot.findFirstOrThrow({ where: { productId: f.product.id, storeId: f.store.id } });
    await f.api.salesOrders.postSale({ customerOrderId: apiOrder.id, idempotencyKey: randomUUID() });
    expect((await prisma.inventorySnapshot.findUniqueOrThrow({ where: { id: beforeStock.id } })).onHand).toBe(beforeStock.onHand);
    expect(await prisma.stockMovement.count({ where: { referenceId: apiOrder.id, type: "SALE" } })).toBe(1);
    const amended = await savedOrder(apiOrder.id);
    await expect(f.api.salesOrders.removeDeclinedLine({ customerOrderId: amended.id, lineId: amended.lines[0]!.id, expectedUpdatedAt: amended.updatedAt.toISOString(), reason: "Declined", idempotencyKey: randomUUID(), confirmCancelLastLine: true })).rejects.toMatchObject({ message: "salesOrderAmendmentUnsupportedSource" });
  });

  it("removes a declined READY line without stock effects, supports retry and rejects stale views", async () => {
    const f = await fixture();
    const order = await readyOrder(f);
    const request = await amendmentInput(f, order.id);
    const stockBefore = await prisma.stockMovement.count();
    expect(await f.api.salesOrders.removeDeclinedLine(request)).toMatchObject({ id: order.id, status: "READY", replacementId: null });
    const after = await accounting(f);
    await f.api.salesOrders.removeDeclinedLine(request);
    expect(await accounting(f)).toEqual(after);
    expect(await prisma.stockMovement.count()).toBe(stockBefore);
    expect((await savedOrder(order.id)).lines).toHaveLength(1);
    expect(Number((await savedOrder(order.id)).totalKgs)).toBe(160);
    await expect(f.api.salesOrders.removeDeclinedLine({ ...request, idempotencyKey: randomUUID() })).rejects.toMatchObject({ message: "salesOrderAmendmentStale" });
  });

  it("keeps a posted original immutable and replaces it with an audited sale using original snapshots", async () => {
    const f = await fixture();
    await prisma.store.update({ where: { id: f.store.id }, data: { currencyCode: "USD", currencyRateKgsPerUnit: 90 } });
    const sale = await f.api.salesOrders.createSale(orderInput(f));
    const originalDate = new Date(Date.now() - 2 * 86_400_000);
    await prisma.customerOrder.update({ where: { id: sale.id }, data: { completedAt: originalDate } });
    const original = await savedOrder(sale.id);
    const profile = await prisma.customer.findUniqueOrThrow({ where: { id: f.customer.id } });
    await prisma.product.update({ where: { id: f.product.id }, data: { basePriceKgs: 999 } });
    await prisma.productCost.updateMany({ where: { productId: f.product.id }, data: { avgCostKgs: 99 } });
    await prisma.store.update({ where: { id: f.store.id }, data: { currencyCode: "EUR", currencyRateKgsPerUnit: 100 } });
    effects.publish.mockClear();
    const request = await amendmentInput(f, sale.id);
    const result = await f.api.salesOrders.removeDeclinedLine(request);
    expect(result).toMatchObject({ id: original.id, status: "CANCELED" });
    expect(result.replacementId).toBeTruthy();
    const canceled = await savedOrder(original.id);
    const corrected = await savedOrder(result.replacementId!);
    expect(canceled.lines).toEqual(original.lines);
    expect(Number(canceled.totalKgs)).toBe(210);
    expect(canceled.completedAt).toEqual(originalDate);
    expect(corrected.status).toBe("COMPLETED");
    expect(corrected.completedAt).toEqual(originalDate);
    expect(corrected.currencyCode).toBe("USD");
    expect(Number(corrected.currencyRateKgsPerUnit)).toBe(90);
    expect(Number(corrected.totalKgs)).toBe(160);
    const oldLine = original.lines.find((line) => line.productId === f.product.id)!;
    const newLine = corrected.lines[0]!;
    for (const field of ["productId", "variantId", "variantKey", "qty", "manualPrice", "priceSource", "unitPriceKgs", "lineTotalKgs", "baseUnitPriceKgs", "appliedDiscountType", "appliedDiscountPercentage", "appliedDiscountAmountKgs", "unitCostKgs", "lineCostTotalKgs"] as const) expect(newLine[field]).toEqual(oldLine[field]);
    expect(corrected.customerId).toBe(original.customerId);
    expect(corrected.customerPhone).toBe(original.customerPhone);
    expect(corrected.notes).toContain(original.number);
    expect(corrected.notes).toContain(request.reason);
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: f.customer.id } })).toEqual(profile);
    const stock = await prisma.inventorySnapshot.findMany({ where: { storeId: f.store.id } });
    expect(stock.find((row) => row.productId === f.product.id)!.onHand).toBe(18);
    expect(stock.find((row) => row.productId === f.second.id)!.onHand).toBe(20);
    expect(await prisma.salePayment.count()).toBe(0);
    expect(effects.confirmEmail).not.toHaveBeenCalled();
    expect(effects.cancelEmail).not.toHaveBeenCalled();
    expect(effects.automation).not.toHaveBeenCalled();
    expect(effects.publish.mock.calls.filter(([event]) => event.type === "customerOrder.statusChanged")).toHaveLength(2);
    const beforeReplay = await accounting(f);
    expect(await f.api.salesOrders.removeDeclinedLine(request)).toEqual(result);
    expect(await accounting(f)).toEqual(beforeReplay);
    expect(effects.publish.mock.calls.filter(([event]) => event.type === "customerOrder.statusChanged")).toHaveLength(2);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: original.id, action: "SALES_ORDER_AMENDMENT" } });
    expect(audit.after).toMatchObject({ replacementId: corrected.id, declinedLineId: request.lineId, reason: request.reason });
  });

  it("requires explicit confirmation to cancel the final line and restores stock only once", async () => {
    const f = await fixture();
    const sale = await f.api.salesOrders.createSale({ ...orderInput(f), lines: [{ productId: f.product.id, qty: 1 }] });
    const order = await savedOrder(sale.id);
    const request = { customerOrderId: order.id, lineId: order.lines[0]!.id, expectedUpdatedAt: order.updatedAt.toISOString(), reason: "Entire sale declined", idempotencyKey: randomUUID() };
    const before = await accounting(f);
    await expect(f.api.salesOrders.removeDeclinedLine(request)).rejects.toMatchObject({ message: "salesOrderLastLineCancellationRequired" });
    expect(await accounting(f)).toEqual(before);
    const confirmed = { ...request, confirmCancelLastLine: true };
    expect(await f.api.salesOrders.removeDeclinedLine(confirmed)).toMatchObject({ id: order.id, status: "CANCELED", replacementId: null });
    await f.api.salesOrders.removeDeclinedLine(confirmed);
    expect((await savedOrder(order.id)).lines).toHaveLength(1);
    expect(await prisma.customerOrder.count()).toBe(1);
    expect(await prisma.stockMovement.count({ where: { referenceId: order.id, type: "RETURN" } })).toBe(1);
    expect((await prisma.inventorySnapshot.findFirstOrThrow({ where: { storeId: f.store.id, productId: f.product.id } })).onHand).toBe(20);
  });

  it("blocks payment, return, loyalty, fiscal and closed-period cases without modifying accounting", async () => {
    const f = await fixture();
    const { register, shift } = await openShift(f);
    const cases = ["payment", "return", "loyalty", "fiscal", "period"] as const;
    for (const scenario of cases) {
      const sale = await f.api.salesOrders.createSale(orderInput(f));
      let error = "salesOrderAmendmentRequiresReturn";
      if (scenario === "payment") await f.api.salesOrders.recordPayment({ customerOrderId: sale.id, shiftId: shift.id, amountKgs: 1, method: "CASH", idempotencyKey: randomUUID() });
      if (scenario === "return") await prisma.saleReturn.create({ data: { organizationId: f.org.id, storeId: f.store.id, registerId: register.id, shiftId: shift.id, originalSaleId: sale.id, number: randomUUID(), createdById: f.adminUser.id } });
      if (scenario === "loyalty") {
        error = "salesOrderAmendmentLoyaltyBlocked";
        await prisma.loyaltyOrderApplication.create({ data: { organizationId: f.org.id, customerOrderId: sale.id, programId: "guard-program", accountId: "guard-account", memberId: "guard-member", status: "CONFIRMED" } });
      }
      if (scenario === "fiscal") { error = "salesOrderAmendmentFiscalBlocked"; await prisma.customerOrder.update({ where: { id: sale.id }, data: { kkmStatus: "SENT" } }); }
      if (scenario === "period") {
        error = "salesOrderAmendmentPeriodClosed";
        const time = (await savedOrder(sale.id)).completedAt!;
        await f.api.periodClose.close({ storeId: f.store.id, periodStart: new Date(time.getTime() - 1000), periodEnd: new Date(time.getTime() + 1000) });
      }
      const request = await amendmentInput(f, sale.id);
      const before = await accounting(f);
      await expect(f.api.salesOrders.removeDeclinedLine(request)).rejects.toMatchObject({ message: error });
      expect(await accounting(f)).toEqual(before);
    }
  });

  it("rejects missing stock evidence and rolls cancellation back if the replacement cannot post", async () => {
    const f = await fixture();
    const legacy = await readyOrder(f);
    await prisma.customerOrder.update({ where: { id: legacy.id }, data: { status: "COMPLETED", completedAt: new Date() } });
    await expect(f.api.salesOrders.removeDeclinedLine(await amendmentInput(f, legacy.id))).rejects.toMatchObject({ message: "salesOrderAmendmentStockMismatch" });
    const sale = await f.api.salesOrders.createSale(orderInput(f));
    await prisma.storeProduct.updateMany({ where: { storeId: f.store.id, productId: f.product.id }, data: { isActive: false, isHidden: true } });
    const before = await accounting(f);
    await expect(f.api.salesOrders.removeDeclinedLine(await amendmentInput(f, sale.id))).rejects.toMatchObject({ message: "productNotAvailableInStore" });
    expect(await accounting(f)).toEqual(before);
    expect((await savedOrder(sale.id)).status).toBe("COMPLETED");
  });

  it("serializes two corrections from one version and never creates a second replacement", async () => {
    const f = await fixture();
    const sale = await f.api.salesOrders.createSale(orderInput(f));
    const request = await amendmentInput(f, sale.id);
    const results = await Promise.allSettled([
      f.api.salesOrders.removeDeclinedLine(request),
      f.api.salesOrders.removeDeclinedLine({ ...request, idempotencyKey: randomUUID() }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ message: "salesOrderAmendmentStale" });
    expect(await prisma.customerOrder.count()).toBe(2);
    expect(await prisma.auditLog.count({ where: { entityId: sale.id, action: "SALES_ORDER_AMENDMENT" } })).toBe(1);
    expect(await prisma.stockMovement.count({ where: { referenceId: sale.id, type: "RETURN" } })).toBe(2);
  });

  it("posts and corrects a fifty-line sale atomically while preserving all original lines", async () => {
    const f = await fixture();
    const products = Array.from({ length: 48 }, (_, index) => ({
      id: randomUUID(), organizationId: f.org.id, supplierId: f.supplier.id,
      sku: `FAST-BATCH-${index}`, name: `Batch product ${index}`,
      unit: f.baseUnit.code, baseUnitId: f.baseUnit.id, basePriceKgs: 10,
    }));
    await prisma.product.createMany({ data: products });
    await prisma.storeProduct.createMany({ data: products.map((product) => ({ organizationId: f.org.id, storeId: f.store.id, productId: product.id, isActive: true })) });
    await prisma.inventorySnapshot.createMany({ data: products.map((product) => ({ storeId: f.store.id, productId: product.id, variantKey: "BASE", onHand: 5 })) });
    const sale = await f.api.salesOrders.createSale({
      ...orderInput(f),
      lines: [f.product, f.second, ...products].map((product) => ({ productId: product.id, qty: 1 })),
    });
    const original = await savedOrder(sale.id);
    const result = await f.api.salesOrders.removeDeclinedLine(await amendmentInput(f, sale.id));
    expect(result.replacementId).toBeTruthy();
    const corrected = await savedOrder(result.replacementId!);
    expect((await savedOrder(sale.id)).lines).toEqual(original.lines);
    expect(original.lines).toHaveLength(50);
    expect(corrected.lines).toHaveLength(49);
    expect(corrected.lines.some((line) => line.productId === f.second.id)).toBe(false);
    expect(Number(corrected.totalKgs)).toBe(Number(original.totalKgs) - 50);
    expect(await prisma.stockMovement.count({ where: { referenceId: sale.id, type: "RETURN" } })).toBe(50);
    expect(await prisma.stockMovement.count({ where: { referenceId: corrected.id, type: "SALE" } })).toBe(49);
    const stock = await prisma.inventorySnapshot.findMany({ where: { storeId: f.store.id } });
    expect(stock.find((row) => row.productId === f.product.id)!.onHand).toBe(19);
    expect(stock.find((row) => row.productId === f.second.id)!.onHand).toBe(20);
    for (const product of products) expect(stock.find((row) => row.productId === product.id)!.onHand).toBe(4);
    expect(await prisma.salePayment.count()).toBe(0);
  }, 30_000);

  it("serializes a period close with a correction so the stored totals match the committed sales", async () => {
    const f = await fixture();
    const sale = await f.api.salesOrders.createSale(orderInput(f));
    const request = await amendmentInput(f, sale.id);
    const time = (await savedOrder(sale.id)).completedAt!;
    const range = { storeId: f.store.id, periodStart: new Date(time.getTime() - 1000), periodEnd: new Date(time.getTime() + 1000) };
    const [closed, amended] = await Promise.allSettled([
      f.api.periodClose.close(range), f.api.salesOrders.removeDeclinedLine(request),
    ]);
    expect(closed.status).toBe("fulfilled");
    if (amended.status === "rejected") expect(amended.reason).toMatchObject({ message: "salesOrderAmendmentPeriodClosed" });
    const row = await prisma.periodClose.findFirstOrThrow({ where: { storeId: f.store.id } });
    const total = await prisma.customerOrder.aggregate({ where: { organizationId: f.org.id, storeId: f.store.id, status: "COMPLETED", completedAt: { gte: range.periodStart, lte: range.periodEnd } }, _sum: { totalKgs: true } });
    expect(row.totals).toMatchObject({ salesTotalKgs: Number(total._sum.totalKgs ?? new Prisma.Decimal(0)) });
  });
});
