import { randomUUID } from "node:crypto";
import { Prisma, Role } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { adjustStock } from "@/server/services/inventory";
import {
  closeRegisterShift,
  getShiftXReport,
  listRegisterShifts,
  assertRefundWithinPaidAmount,
} from "@/server/services/pos";
import { correctCompletedCustomerOrder } from "@/server/services/salesOrderCorrections";
import { recordOrderPayment } from "@/server/services/salesOrderPayments";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const blockingWaiter = async (pid: number) => {
  const rows = await prisma.$queryRaw<Array<{ pid: number }>>`
    SELECT pid FROM pg_stat_activity
    WHERE datname = current_database() AND ${pid} = ANY(pg_blocking_pids(pid))
    ORDER BY pid
  `;
  return rows[0]?.pid;
};
const waitForLockWait = async (holderPid: number) => {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (await blockingWaiter(holderPid)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Concurrent shift close did not reach the shift lock wait");
};
const asUser = (user: {
  id: string;
  email: string;
  role: Role;
  organizationId: string | null;
  isOrgOwner?: boolean | null;
}) => ({ ...user, organizationId: user.organizationId!, isOrgOwner: Boolean(user.isOrgOwner) });

async function fixture() {
  const f = await seedBase({ plan: "ENTERPRISE" });
  const second = await prisma.product.create({
    data: {
      organizationId: f.org.id,
      supplierId: f.supplier.id,
      sku: "CF-SECOND",
      name: "Second item",
      unit: f.baseUnit.code,
      baseUnitId: f.baseUnit.id,
      basePriceKgs: 50,
    },
  });
  const premium = await prisma.product.create({
    data: {
      organizationId: f.org.id,
      supplierId: f.supplier.id,
      sku: "CF-PREMIUM",
      name: "Premium item",
      unit: f.baseUnit.code,
      baseUnitId: f.baseUnit.id,
      basePriceKgs: 150,
    },
  });
  for (const product of [f.product, second, premium]) {
    await prisma.storeProduct.upsert({
      where: { storeId_productId: { storeId: f.store.id, productId: product.id } },
      update: { isActive: true },
      create: {
        organizationId: f.org.id,
        storeId: f.store.id,
        productId: product.id,
        isActive: true,
      },
    });
    await prisma.product.update({
      where: { id: product.id },
      data: { basePriceKgs: product.basePriceKgs ?? 100 },
    });
  }
  await prisma.storePrice.create({
    data: {
      organizationId: f.org.id,
      storeId: f.store.id,
      productId: f.product.id,
      variantKey: "BASE",
      priceKgs: 100,
    },
  });
  for (const productId of [f.product.id, second.id, premium.id]) {
    await adjustStock({
      organizationId: f.org.id,
      actorId: f.adminUser.id,
      storeId: f.store.id,
      productId,
      qtyDelta: 50,
      reason: "correction fixture",
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
    });
  }
  const register = await prisma.posRegister.create({
    data: {
      organizationId: f.org.id,
      storeId: f.store.id,
      name: "Test register",
      code: randomUUID(),
    },
  });
  const shift = await prisma.registerShift.create({
    data: {
      organizationId: f.org.id,
      storeId: f.store.id,
      registerId: register.id,
      openedById: f.adminUser.id,
      openingCashKgs: 0,
    },
  });
  const customer = await prisma.customer.create({
    data: { organizationId: f.org.id, storeId: f.store.id, name: "Correction customer" },
  });
  const api = createTestCaller(asUser(f.adminUser));
  const managerApi = createTestCaller(asUser(f.managerUser));
  const staffApi = createTestCaller(asUser(f.staffUser));
  return { ...f, second, premium, register, shift, customer, api, managerApi, staffApi };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const adminUser = (f: Fixture) => ({
  id: f.adminUser.id,
  organizationId: f.org.id,
  role: Role.ADMIN,
  isOrgOwner: false,
});

async function paidSale(
  f: Fixture,
  lines: Array<{ productId: string; qty: number; unitPriceKgs?: number }> = [
    { productId: f.product.id, qty: 2 },
    { productId: f.second.id, qty: 1 },
  ],
  priceMode: "RETAIL" | "WHOLESALE" = "RETAIL",
  method: "CASH" | "CARD" | "TRANSFER" | "OTHER" = "CASH",
) {
  const order = await f.api.salesOrders.createSale({
    storeId: f.store.id,
    priceMode,
    customerId: f.customer.id,
    idempotencyKey: randomUUID(),
    lines,
  });
  const saved = await prisma.customerOrder.findUniqueOrThrow({ where: { id: order.id } });
  await recordOrderPayment({
    user: adminUser(f),
    customerOrderId: order.id,
    shiftId: f.shift.id,
    amountKgs: Number(saved.totalKgs),
    method,
    idempotencyKey: randomUUID(),
    requestId: randomUUID(),
  });
  return saved;
}

async function quote(
  f: Fixture,
  orderId: string,
  returns: Array<{ lineId: string; qty: number; restock?: boolean }>,
  additions: Array<{ productId: string; qty: number }> = [],
) {
  return f.api.salesOrders.correctionQuote({
    originalOrderId: orderId,
    returns: returns.map((line) => ({ ...line, restock: line.restock ?? true })),
    additions,
  });
}

async function correct(
  f: Fixture,
  orderId: string,
  returns: Array<{ lineId: string; qty: number; restock?: boolean }>,
  additions: Array<{ productId: string; qty: number }> = [],
  overrides: Record<string, unknown> = {},
) {
  const preview = await quote(f, orderId, returns, additions);
  return f.api.salesOrders.correct({
    originalOrderId: orderId,
    expectedFingerprint: preview.fingerprint,
    reason: "Customer correction",
    returns: returns.map((line) => ({ ...line, restock: line.restock ?? true })),
    additions,
    shiftId: f.shift.id,
    paymentMethod: "CASH",
    idempotencyKey: randomUUID(),
    ...overrides,
  });
}

async function openShift(f: Fixture, label: string) {
  const register = await prisma.posRegister.create({
    data: { organizationId: f.org.id, storeId: f.store.id, name: label, code: randomUUID() },
  });
  return prisma.registerShift.create({
    data: {
      organizationId: f.org.id,
      storeId: f.store.id,
      registerId: register.id,
      openedById: f.adminUser.id,
      openingCashKgs: 0,
    },
  });
}

async function resolveRefund(
  f: Fixture,
  refundRequestId: string,
  action: "RESOLVED" | "CANCELED",
  shiftId?: string,
) {
  return f.api.salesOrders.resolveCorrectionRefund({
    refundRequestId,
    action,
    ...(shiftId ? { shiftId } : {}),
    idempotencyKey: randomUUID(),
  });
}

const shiftReport = async (f: Fixture, shiftId: string) =>
  getShiftXReport({ organizationId: f.org.id, shiftId, user: adminUser(f) });

const listedShift = async (f: Fixture, shiftId: string) => {
  const page = await listRegisterShifts({
    organizationId: f.org.id,
    storeId: f.store.id,
    page: 1,
    pageSize: 20,
    user: adminUser(f),
  });
  return page.items.find((item) => item.id === shiftId);
};

const correctionPayments = async (result: {
  saleReturnId: string | null;
  additionOrderId: string | null;
}) => ({
  refunds: result.saleReturnId
    ? await prisma.salePayment.findMany({
        where: { saleReturnId: result.saleReturnId, isRefund: true },
        orderBy: { createdAt: "asc" },
      })
    : [],
  sales: result.additionOrderId
    ? await prisma.salePayment.findMany({
        where: { customerOrderId: result.additionOrderId, isRefund: false },
        orderBy: { createdAt: "asc" },
      })
    : [],
});

const stock = async (f: Fixture, productId: string) =>
  Number(
    (
      await prisma.inventorySnapshot.findUniqueOrThrow({
        where: {
          storeId_productId_variantKey: {
            storeId: f.store.id,
            productId,
            variantKey: "BASE",
          },
        },
      })
    ).onHand,
  );

describeDb("completed paid sale corrections (R7)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns one line partially without changing the original financial fact", async () => {
    const f = await fixture();
    const order = await paidSale(f);
    const line = await prisma.customerOrderLine.findFirstOrThrow({
      where: { customerOrderId: order.id, productId: f.product.id },
    });
    const stockBefore = await stock(f, f.product.id);
    const result = await correct(f, order.id, [{ lineId: line.id, qty: 1 }]);

    expect(result.returnedKgs).toBe(100);
    expect(result.refundKgs).toBe(100);
    expect(result.additionOrderId).toBeNull();
    const original = await prisma.customerOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(original.status).toBe("COMPLETED");
    expect(Number(original.totalKgs)).toBe(250);
    expect(await stock(f, f.product.id)).toBe(stockBefore + 1);
    const returnLine = await prisma.saleReturnLine.findFirstOrThrow({
      where: { saleReturnId: result.saleReturnId! },
    });
    expect(Number(returnLine.unitPriceKgs)).toBe(100);
    expect(Number(returnLine.lineTotalKgs)).toBe(100);
    expect(returnLine.restock).toBe(true);
    const refund = await prisma.salePayment.findFirstOrThrow({
      where: { saleReturnId: result.saleReturnId!, isRefund: true },
    });
    expect(Number(refund.amountKgs)).toBe(100);
    const detail = await f.api.salesOrders.getById({ customerOrderId: order.id });
    expect(detail?.corrections).toHaveLength(1);
    expect(detail?.corrections[0]?.number).toBe(result.correctionNumber);
  });

  it("returns everything while preserving the source sale and refusing a second full return", async () => {
    const f = await fixture();
    const order = await paidSale(f);
    const lines = await prisma.customerOrderLine.findMany({ where: { customerOrderId: order.id } });
    const returns = lines.map((line) => ({ lineId: line.id, qty: line.qty }));
    const result = await correct(f, order.id, returns);
    expect(result.returnedKgs).toBe(250);
    expect(result.refundKgs).toBe(250);
    expect(
      Number((await prisma.customerOrder.findUniqueOrThrow({ where: { id: order.id } })).totalKgs),
    ).toBe(250);
    await expect(correct(f, order.id, returns)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      await prisma.saleReturn.count({ where: { originalSaleId: order.id, status: "COMPLETED" } }),
    ).toBe(1);
  });

  it("exchanges equal, expensive and cheaper items with the correct money difference", async () => {
    const f = await fixture();
    const equalOrder = await paidSale(f);
    const equalLine = await prisma.customerOrderLine.findFirstOrThrow({
      where: { customerOrderId: equalOrder.id, productId: f.product.id },
    });
    const equal = await correct(
      f,
      equalOrder.id,
      [{ lineId: equalLine.id, qty: 1 }],
      [{ productId: f.product.id, qty: 1 }],
    );
    expect(equal.refundKgs).toBe(0);
    expect(equal.chargeKgs).toBe(0);
    expect(equal.additionOrderId).not.toBeNull();
    const additionPayment = await prisma.salePayment.findFirstOrThrow({
      where: { customerOrderId: equal.additionOrderId!, isRefund: false },
    });
    expect(Number(additionPayment.amountKgs)).toBe(100);

    const upOrder = await paidSale(f);
    const upLine = await prisma.customerOrderLine.findFirstOrThrow({
      where: { customerOrderId: upOrder.id, productId: f.product.id },
    });
    const up = await correct(
      f,
      upOrder.id,
      [{ lineId: upLine.id, qty: 1 }],
      [{ productId: f.premium.id, qty: 1 }],
    );
    expect(up.chargeKgs).toBe(50);
    expect(up.refundKgs).toBe(0);

    const downOrder = await paidSale(f);
    const downLine = await prisma.customerOrderLine.findFirstOrThrow({
      where: { customerOrderId: downOrder.id, productId: f.product.id },
    });
    const down = await correct(
      f,
      downOrder.id,
      [{ lineId: downLine.id, qty: 1 }],
      [{ productId: f.second.id, qty: 1 }],
    );
    expect(down.refundKgs).toBe(50);
    expect(down.chargeKgs).toBe(0);
  });

  it("uses the historical sale price after the catalogue changes", async () => {
    const f = await fixture();
    const order = await paidSale(f);
    const line = await prisma.customerOrderLine.findFirstOrThrow({
      where: { customerOrderId: order.id, productId: f.product.id },
    });
    await prisma.storePrice.update({
      where: {
        organizationId_storeId_productId_variantKey: {
          organizationId: f.org.id,
          storeId: f.store.id,
          productId: f.product.id,
          variantKey: "BASE",
        },
      },
      data: { priceKgs: 999 },
    });
    const preview = await quote(f, order.id, [{ lineId: line.id, qty: 1 }]);
    expect(preview.returnedKgs).toBe(100);
    const result = await correct(f, order.id, [{ lineId: line.id, qty: 1 }]);
    expect(result.refundKgs).toBe(100);
  });

  it("keeps the original sale currency on the addition order and its payments", async () => {
    const f = await fixture();
    await prisma.store.update({
      where: { id: f.store.id },
      data: { currencyCode: "USD", currencyRateKgsPerUnit: 80 },
    });
    const order = await paidSale(f);
    expect(order.currencyCode).toBe("USD");
    expect(Number(order.currencyRateKgsPerUnit)).toBe(80);
    const lines = await prisma.customerOrderLine.findMany({
      where: { customerOrderId: order.id },
    });
    const returns = lines.map((line) => ({ lineId: line.id, qty: line.qty }));

    // The store's reference rate moves after the sale was saved.
    await prisma.store.update({
      where: { id: f.store.id },
      data: { currencyCode: "USD", currencyRateKgsPerUnit: 100 },
    });
    const preview = await quote(f, order.id, returns, [{ productId: f.product.id, qty: 2 }]);
    expect(preview.currencyCode).toBe("USD");
    expect(preview.currencyRateKgsPerUnit).toBe(80);

    const result = await correct(
      f,
      order.id,
      returns,
      [{ productId: f.product.id, qty: 2 }],
    );
    expect(result.returnedKgs).toBe(250);
    expect(result.addedKgs).toBe(200);
    expect(result.offsetKgs).toBe(200);
    expect(result.refundKgs).toBe(50);

    const addition = await prisma.customerOrder.findUniqueOrThrow({
      where: { id: result.additionOrderId! },
    });
    expect(addition.currencyCode).toBe("USD");
    expect(Number(addition.currencyRateKgsPerUnit)).toBe(80);
    expect(Number(addition.totalKgs)).toBe(200);

    const payments = await correctionPayments(result);
    expect(payments.sales).toHaveLength(1);
    expect(payments.sales[0]).toMatchObject({
      currencyCode: "USD",
      isRefund: false,
      settlementStatus: "OFFSET",
    });
    expect(Number(payments.sales[0]!.currencyRateKgsPerUnit)).toBe(80);
    expect(Number(payments.sales[0]!.amountKgs)).toBe(200);

    const refundsBySettlement = new Map(
      payments.refunds.map((payment) => [payment.settlementStatus, payment]),
    );
    expect(Number(refundsBySettlement.get("OFFSET")!.amountKgs)).toBe(200);
    expect(Number(refundsBySettlement.get("ACTUAL")!.amountKgs)).toBe(50);
    for (const refund of payments.refunds) {
      expect(refund).toMatchObject({ currencyCode: "USD", isRefund: true });
      expect(Number(refund.currencyRateKgsPerUnit)).toBe(80);
    }

    const original = await prisma.customerOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(Number(original.totalKgs)).toBe(250);
    expect(original.currencyCode).toBe("USD");
    expect(Number(original.currencyRateKgsPerUnit)).toBe(80);
    const store = await prisma.store.findUniqueOrThrow({ where: { id: f.store.id } });
    expect(Number(store.currencyRateKgsPerUnit)).toBe(100);
  });

  it("does not add a non-restocked return to sellable stock", async () => {
    const f = await fixture();
    const order = await paidSale(f);
    const line = await prisma.customerOrderLine.findFirstOrThrow({
      where: { customerOrderId: order.id, productId: f.product.id },
    });
    const before = await stock(f, f.product.id);
    const result = await correct(f, order.id, [{ lineId: line.id, qty: 1, restock: false }]);
    expect(await stock(f, f.product.id)).toBe(before);
    const returnLine = await prisma.saleReturnLine.findFirstOrThrow({
      where: { saleReturnId: result.saleReturnId! },
    });
    expect(returnLine.restock).toBe(false);
  });

  it("replays an idempotent correction and rejects a stale quote", async () => {
    const f = await fixture();
    const order = await paidSale(f);
    const line = await prisma.customerOrderLine.findFirstOrThrow({
      where: { customerOrderId: order.id, productId: f.product.id },
    });
    const preview = await quote(f, order.id, [{ lineId: line.id, qty: 1 }]);
    const input = {
      originalOrderId: order.id,
      expectedFingerprint: preview.fingerprint,
      reason: "Replay test",
      returns: [{ lineId: line.id, qty: 1, restock: true }],
      additions: [],
      shiftId: f.shift.id,
      paymentMethod: "CASH" as const,
      idempotencyKey: randomUUID(),
    };
    const first = await f.api.salesOrders.correct(input);
    const replay = await f.api.salesOrders.correct(input);
    expect(replay.correctionId).toBe(first.correctionId);
    expect(await prisma.saleReturn.count({ where: { originalSaleId: order.id } })).toBe(1);
    expect(await prisma.salesOrderCorrection.count({ where: { originalOrderId: order.id } })).toBe(
      1,
    );
    await expect(
      f.api.salesOrders.correct({
        ...input,
        idempotencyKey: randomUUID(),
        expectedFingerprint: preview.fingerprint,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("serializes concurrent returns so the sold quantity cannot be exceeded", async () => {
    const f = await fixture();
    const order = await paidSale(f, [{ productId: f.product.id, qty: 1 }]);
    const line = await prisma.customerOrderLine.findFirstOrThrow({
      where: { customerOrderId: order.id, productId: f.product.id },
    });
    const preview = await quote(f, order.id, [{ lineId: line.id, qty: 1 }]);
    const base = {
      originalOrderId: order.id,
      expectedFingerprint: preview.fingerprint,
      reason: "Concurrent",
      returns: [{ lineId: line.id, qty: 1, restock: true }],
      additions: [],
      shiftId: f.shift.id,
      paymentMethod: "CASH" as const,
    };
    const results = await Promise.allSettled([
      f.api.salesOrders.correct({ ...base, idempotencyKey: randomUUID() }),
      f.api.salesOrders.correct({ ...base, idempotencyKey: randomUUID() }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await prisma.saleReturnLine.count({ where: { customerOrderLineId: line.id } })).toBe(1);
    expect(await stock(f, f.product.id)).toBe(50);
  });

  it("adds items without a return and charges only the addition", async () => {
    const f = await fixture();
    const order = await paidSale(f, [{ productId: f.product.id, qty: 1 }]);
    const premiumBefore = await stock(f, f.premium.id);
    const result = await correct(f, order.id, [], [{ productId: f.premium.id, qty: 1 }]);
    expect(result.returnedKgs).toBe(0);
    expect(result.addedKgs).toBe(150);
    expect(result.chargeKgs).toBe(150);
    expect(result.refundKgs).toBe(0);
    expect(
      Number((await prisma.customerOrder.findUniqueOrThrow({ where: { id: order.id } })).totalKgs),
    ).toBe(100);
    expect(await stock(f, f.premium.id)).toBe(premiumBefore - 1);
    const addition = await prisma.customerOrder.findUniqueOrThrow({
      where: { id: result.additionOrderId! },
      include: { payments: true },
    });
    expect(Number(addition.totalKgs)).toBe(150);
    expect(
      addition.payments.some((payment) => Number(payment.amountKgs) === 150 && !payment.isRefund),
    ).toBe(true);
  });

  it("denies a different organization even with the exact order id", async () => {
    const f = await fixture();
    const order = await paidSale(f);
    const line = await prisma.customerOrderLine.findFirstOrThrow({
      where: { customerOrderId: order.id, productId: f.product.id },
    });
    const otherOrg = await prisma.organization.create({
      data: { name: "Other correction tenant" },
    });
    const otherAdmin = await prisma.user.create({
      data: {
        organizationId: otherOrg.id,
        email: `correction-other-${randomUUID()}@test.local`,
        name: "Other admin",
        passwordHash: "hash",
        role: Role.ADMIN,
        isOrgOwner: true,
      },
    });
    const otherApi = createTestCaller(asUser(otherAdmin));
    await expect(
      otherApi.salesOrders.correctionQuote({
        originalOrderId: order.id,
        returns: [{ lineId: line.id, qty: 1, restock: true }],
        additions: [],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await prisma.saleReturn.count({ where: { originalSaleId: order.id } })).toBe(0);
  });

  it("blocks fiscalized sales and pending manual refunds instead of silently changing them", async () => {
    const f = await fixture();
    const order = await paidSale(f);
    const line = await prisma.customerOrderLine.findFirstOrThrow({
      where: { customerOrderId: order.id, productId: f.product.id },
    });
    const beforeFiscal = await quote(f, order.id, [{ lineId: line.id, qty: 1 }]);
    await prisma.customerOrder.update({
      where: { id: order.id },
      data: { kkmStatus: "SENT" },
    });
    await expect(quote(f, order.id, [{ lineId: line.id, qty: 1 }])).rejects.toMatchObject({
      message: "salesOrderCorrectionFiscalUnsupported",
    });
    // A stale quote must not bypass the mutation-side fiscal guard.
    await expect(
      f.api.salesOrders.correct({
        originalOrderId: order.id,
        expectedFingerprint: beforeFiscal.fingerprint,
        reason: "Fiscalized meanwhile",
        returns: [{ lineId: line.id, qty: 1, restock: true }],
        additions: [],
        shiftId: f.shift.id,
        paymentMethod: "CASH",
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ message: "salesOrderCorrectionFiscalUnsupported" });
    await prisma.customerOrder.update({
      where: { id: order.id },
      data: { kkmStatus: "NOT_SENT" },
    });
    const preview = await quote(f, order.id, [{ lineId: line.id, qty: 1 }]);
    const result = await f.api.salesOrders.correct({
      originalOrderId: order.id,
      expectedFingerprint: preview.fingerprint,
      reason: "Transfer pending",
      returns: [{ lineId: line.id, qty: 1, restock: true }],
      additions: [],
      shiftId: f.shift.id,
      paymentMethod: "TRANSFER",
      idempotencyKey: randomUUID(),
    });
    expect(result.manualRefundRequired).toBe(true);
    await expect(quote(f, order.id, [])).rejects.toMatchObject({
      message: "salesOrderCorrectionRefundPending",
    });
  });

  it("records a transfer refund as a manual request instead of confirmed money", async () => {
    const f = await fixture();
    const order = await paidSale(f);
    const line = await prisma.customerOrderLine.findFirstOrThrow({
      where: { customerOrderId: order.id, productId: f.product.id },
    });
    const preview = await quote(f, order.id, [{ lineId: line.id, qty: 1 }]);
    const result = await f.api.salesOrders.correct({
      originalOrderId: order.id,
      expectedFingerprint: preview.fingerprint,
      reason: "Transfer refund",
      returns: [{ lineId: line.id, qty: 1, restock: true }],
      additions: [],
      shiftId: f.shift.id,
      paymentMethod: "TRANSFER",
      idempotencyKey: randomUUID(),
    });
    expect(result.manualRefundRequired).toBe(true);
    const request = await prisma.refundRequest.findUniqueOrThrow({
      where: { saleReturnId: result.saleReturnId! },
    });
    expect(request.status).toBe("OPEN");
    expect(request.reasonCode).toBe("SALES_ORDER_CORRECTION");
  });

  it("does not open a manual refund request when a transfer exchange results in a net charge", async () => {
    const f = await fixture();
    const order = await paidSale(f);
    const line = await prisma.customerOrderLine.findFirstOrThrow({
      where: { customerOrderId: order.id, productId: f.product.id },
    });
    const preview = await quote(
      f,
      order.id,
      [{ lineId: line.id, qty: 1 }],
      [{ productId: f.premium.id, qty: 1 }],
    );
    const result = await f.api.salesOrders.correct({
      originalOrderId: order.id,
      expectedFingerprint: preview.fingerprint,
      reason: "Transfer exchange for a more expensive item",
      returns: [{ lineId: line.id, qty: 1, restock: true }],
      additions: [{ productId: f.premium.id, qty: 1 }],
      shiftId: f.shift.id,
      paymentMethod: "TRANSFER",
      idempotencyKey: randomUUID(),
    });
    expect(result.refundKgs).toBe(0);
    expect(result.chargeKgs).toBe(50);
    expect(result.manualRefundRequired).toBe(false);
    expect(await prisma.refundRequest.count({ where: { originalSaleId: order.id } })).toBe(0);
  });

  it("rolls back stock, money and documents when the correction insert fails", async () => {
    const f = await fixture();
    const order = await paidSale(f);
    const line = await prisma.customerOrderLine.findFirstOrThrow({
      where: { customerOrderId: order.id, productId: f.product.id },
    });
    const otherOrder = await paidSale(f, [{ productId: f.product.id, qty: 1 }]);
    await prisma.salesOrderCorrection.create({
      data: {
        organizationId: f.org.id,
        storeId: f.store.id,
        number: "CR-000001",
        originalOrderId: otherOrder.id,
        reason: "Existing correction",
        returnedKgs: 0,
        addedKgs: 0,
        createdById: f.adminUser.id,
      },
    });
    await prisma.organizationCounter.upsert({
      where: { organizationId: f.org.id },
      update: { salesCorrectionNumber: 0 },
      create: { organizationId: f.org.id, salesCorrectionNumber: 0 },
    });
    const before = await stock(f, f.product.id);
    const returnsBefore = await prisma.saleReturn.count({ where: { originalSaleId: order.id } });
    await expect(correct(f, order.id, [{ lineId: line.id, qty: 1 }])).rejects.toBeTruthy();
    expect(await stock(f, f.product.id)).toBe(before);
    expect(await prisma.saleReturn.count({ where: { originalSaleId: order.id } })).toBe(
      returnsBefore,
    );
    expect(
      await prisma.salePayment.count({
        where: { customerOrderId: order.id, isRefund: true },
      }),
    ).toBe(0);
    expect(await prisma.salesOrderCorrection.count({ where: { originalOrderId: order.id } })).toBe(
      0,
    );
  });

  it("uses a current open shift and leaves a closed shift untouched", async () => {
    const f = await fixture();
    const order = await paidSale(f);
    const line = await prisma.customerOrderLine.findFirstOrThrow({
      where: { customerOrderId: order.id, productId: f.product.id },
    });
    await prisma.registerShift.update({
      where: { id: f.shift.id },
      data: { status: "CLOSED", closedAt: new Date(), closedById: f.adminUser.id },
    });
    const newShift = await prisma.registerShift.create({
      data: {
        organizationId: f.org.id,
        storeId: f.store.id,
        registerId: f.register.id,
        openedById: f.adminUser.id,
        openingCashKgs: 0,
      },
    });
    const preview = await quote(f, order.id, [{ lineId: line.id, qty: 1 }]);
    const result = await f.api.salesOrders.correct({
      originalOrderId: order.id,
      expectedFingerprint: preview.fingerprint,
      reason: "After shift close",
      returns: [{ lineId: line.id, qty: 1, restock: true }],
      shiftId: newShift.id,
      paymentMethod: "CASH",
      idempotencyKey: randomUUID(),
    });
    const refund = await prisma.salePayment.findFirstOrThrow({
      where: { saleReturnId: result.saleReturnId!, isRefund: true },
    });
    expect(refund.shiftId).toBe(newShift.id);
    expect(
      (await prisma.registerShift.findUniqueOrThrow({ where: { id: f.shift.id } })).status,
    ).toBe("CLOSED");
  });

  it("creates a current-dated correction when the original period is closed", async () => {
    const f = await fixture();
    const order = await paidSale(f);
    const line = await prisma.customerOrderLine.findFirstOrThrow({
      where: { customerOrderId: order.id, productId: f.product.id },
    });
    const completedAt = (await prisma.customerOrder.findUniqueOrThrow({ where: { id: order.id } }))
      .completedAt!;
    await prisma.periodClose.create({
      data: {
        organizationId: f.org.id,
        storeId: f.store.id,
        periodStart: new Date(completedAt.getTime() - 86_400_000),
        periodEnd: new Date(completedAt.getTime() + 86_400_000),
        closedById: f.adminUser.id,
      },
    });
    const result = await correct(f, order.id, [{ lineId: line.id, qty: 1 }]);
    const returnDoc = await prisma.saleReturn.findUniqueOrThrow({
      where: { id: result.saleReturnId! },
    });
    expect(returnDoc.createdAt.getTime()).toBeGreaterThan(completedAt.getTime());
    expect(
      (await prisma.customerOrder.findUniqueOrThrow({ where: { id: order.id } })).completedAt,
    ).toEqual(completedAt);
    expect(await prisma.periodClose.count()).toBe(1);
  });

  it("requires an open shift, full payment and a manager with store access", async () => {
    const f = await fixture();
    const order = await paidSale(f);
    const line = await prisma.customerOrderLine.findFirstOrThrow({
      where: { customerOrderId: order.id, productId: f.product.id },
    });
    const preview = await quote(f, order.id, [{ lineId: line.id, qty: 1 }]);
    const base = {
      originalOrderId: order.id,
      expectedFingerprint: preview.fingerprint,
      reason: "Permission test",
      returns: [{ lineId: line.id, qty: 1, restock: true }],
      additions: [],
      paymentMethod: "CASH" as const,
    };
    await expect(
      f.staffApi.salesOrders.correct({
        ...base,
        shiftId: f.shift.id,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const otherStore = await prisma.store.create({
      data: { organizationId: f.org.id, name: "Other store", code: randomUUID() },
    });
    const otherManager = await prisma.user.create({
      data: {
        organizationId: f.org.id,
        email: `other-${randomUUID()}@test.local`,
        name: "Other manager",
        passwordHash: "hash",
        role: Role.MANAGER,
      },
    });
    await prisma.userStoreAccess.create({
      data: { organizationId: f.org.id, userId: otherManager.id, storeId: otherStore.id },
    });
    const otherApi = createTestCaller(asUser(otherManager));
    await expect(
      otherApi.salesOrders.correct({ ...base, shiftId: f.shift.id, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await prisma.salePayment.deleteMany({ where: { customerOrderId: order.id } });
    await expect(quote(f, order.id, [{ lineId: line.id, qty: 1 }])).rejects.toMatchObject({
      message: "onlineReturnRequiresPayment",
    });
  });
});

describeDb("added-goods price mode (BZR-08)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  const enablePriceTypes = async (f: Fixture) => {
    await prisma.organization.update({
      where: { id: f.org.id },
      data: { retailWholesaleEnabled: true },
    });
    for (const [productId, retail, wholesale] of [
      [f.product.id, 100, 80],
      [f.premium.id, 150, 120],
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
    }
  };

  it("quotes added goods in the selected mode while returned lines keep historical prices", async () => {
    const f = await fixture();
    await enablePriceTypes(f);
    const order = await paidSale(f, [{ productId: f.product.id, qty: 2 }], "RETAIL");
    const line = await prisma.customerOrderLine.findFirstOrThrow({
      where: { customerOrderId: order.id, productId: f.product.id },
    });
    const updatePriceTypes = async (productId: string, retail: number, wholesale: number) => {
      await prisma.storePriceTypes.update({
        where: {
          organizationId_storeId_productId_variantKey: {
            organizationId: f.org.id,
            storeId: f.store.id,
            productId,
            variantKey: "BASE",
          },
        },
        data: { retailPriceKgs: retail, wholesalePriceKgs: wholesale },
      });
    };
    // Catalogue prices change after the sale; the sale return must not follow.
    await updatePriceTypes(f.product.id, 130, 90);
    await updatePriceTypes(f.premium.id, 170, 110);

    const retail = await f.api.salesOrders.correctionQuote({
      originalOrderId: order.id,
      priceMode: "RETAIL",
      returns: [{ lineId: line.id, qty: 1, restock: true }],
      additions: [{ productId: f.premium.id, qty: 1 }],
    });
    expect(retail.retailWholesaleEnabled).toBe(true);
    expect(retail.priceMode).toBe("RETAIL");
    expect(retail.returns[0]).toMatchObject({ unitPriceKgs: 100, returnAmountKgs: 100 });
    expect(retail.additions[0]).toMatchObject({ unitPriceKgs: 170, priceSource: "RETAIL" });
    expect(retail.returnedKgs).toBe(100);
    expect(retail.addedKgs).toBe(170);

    const wholesale = await f.api.salesOrders.correctionQuote({
      originalOrderId: order.id,
      priceMode: "WHOLESALE",
      returns: [{ lineId: line.id, qty: 1, restock: true }],
      additions: [{ productId: f.premium.id, qty: 1 }],
    });
    expect(wholesale.priceMode).toBe("WHOLESALE");
    expect(wholesale.returns[0]).toMatchObject({ unitPriceKgs: 100, returnAmountKgs: 100 });
    expect(wholesale.additions[0]).toMatchObject({ unitPriceKgs: 110, priceSource: "WHOLESALE" });
    expect(wholesale.returnedKgs).toBe(100);

    const manual = await f.api.salesOrders.correctionQuote({
      originalOrderId: order.id,
      priceMode: "WHOLESALE",
      returns: [{ lineId: line.id, qty: 1, restock: true }],
      additions: [{ productId: f.premium.id, qty: 1, unitPriceKgs: 77 }],
    });
    expect(manual.additions[0]).toMatchObject({ unitPriceKgs: 77, priceSource: "MANUAL" });
    expect(manual.returns[0]).toMatchObject({ unitPriceKgs: 100, returnAmountKgs: 100 });
  });

  it("reports the feature as disabled and falls back to regular store pricing", async () => {
    const f = await fixture();
    await prisma.organization.update({
      where: { id: f.org.id },
      data: { retailWholesaleEnabled: false },
    });
    await prisma.storePriceTypes.create({
      data: {
        organizationId: f.org.id,
        storeId: f.store.id,
        productId: f.premium.id,
        variantKey: "BASE",
        retailPriceKgs: 150,
        wholesalePriceKgs: 120,
        updatedById: f.adminUser.id,
      },
    });
    const order = await paidSale(f, [{ productId: f.product.id, qty: 1 }], "RETAIL");

    const disabled = await f.api.salesOrders.correctionQuote({
      originalOrderId: order.id,
      priceMode: "WHOLESALE",
      returns: [],
      additions: [{ productId: f.premium.id, qty: 1 }],
    });
    expect(disabled.retailWholesaleEnabled).toBe(false);
    expect(disabled.priceMode).toBe("RETAIL");
    expect(disabled.additions[0]).toMatchObject({ unitPriceKgs: 150, priceSource: "STANDARD" });
    expect(
      disabled.warnings.some((warning) => warning.includes("Цены розница/опт не включены")),
    ).toBe(true);
  });
});

describeDb("correction settlement and refund confirmation (BZR-01/BZR-02)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("keeps a transfer refund pending until a manager confirms it into an open shift", async () => {
    const f = await fixture();
    const order = await paidSale(f);
    const line = await prisma.customerOrderLine.findFirstOrThrow({
      where: { customerOrderId: order.id, productId: f.product.id },
    });
    const result = await correct(f, order.id, [{ lineId: line.id, qty: 1 }], [], {
      paymentMethod: "TRANSFER",
    });

    expect(result.offsetKgs).toBe(0);
    expect(result.refundKgs).toBe(100);
    expect(result.chargeKgs).toBe(0);
    expect(result.actualRefundKgs).toBe(0);
    expect(result.pendingRefundKgs).toBe(100);
    expect(result.manualRefundRequired).toBe(true);
    expect(result.refundRequestId).not.toBeNull();

    const correction = await prisma.salesOrderCorrection.findUniqueOrThrow({
      where: { id: result.correctionId },
    });
    expect(Number(correction.offsetKgs)).toBe(0);
    expect(Number(correction.refundKgs)).toBe(100);

    const request = await prisma.refundRequest.findUniqueOrThrow({
      where: { saleReturnId: result.saleReturnId! },
    });
    expect(request.status).toBe("OPEN");
    expect(Number(request.amountKgs)).toBe(100);
    expect(request.shiftId).toBe(f.shift.id);
    const pendingPayment = await prisma.salePayment.findUniqueOrThrow({
      where: { refundRequestId: request.id },
    });
    expect(pendingPayment.settlementStatus).toBe("PENDING");
    expect(Number(pendingPayment.amountKgs)).toBe(100);
    expect(pendingPayment.isRefund).toBe(true);
    expect(pendingPayment.shiftId).toBe(f.shift.id);

    const originalReport = await shiftReport(f, f.shift.id);
    expect(originalReport.summary.cashSalesKgs).toBe(250);
    expect(originalReport.summary.cashRefundsKgs).toBe(0);
    expect(originalReport.summary.expectedCashKgs).toBe(250);
    expect((await listedShift(f, f.shift.id))?.summary.totalRefundsKgs).toBe(0);

    const target = await openShift(f, "Payout register");
    const idempotencyKey = randomUUID();
    const resolved = await f.api.salesOrders.resolveCorrectionRefund({
      refundRequestId: request.id,
      action: "RESOLVED",
      shiftId: target.id,
      idempotencyKey,
    });
    expect(resolved.status).toBe("RESOLVED");
    expect(resolved.amountKgs).toBe(100);
    expect(resolved.shiftId).toBe(target.id);
    const replay = await f.api.salesOrders.resolveCorrectionRefund({
      refundRequestId: request.id,
      action: "RESOLVED",
      shiftId: target.id,
      idempotencyKey,
    });
    expect(replay.paymentId).toBe(resolved.paymentId);

    const settledPayment = await prisma.salePayment.findUniqueOrThrow({
      where: { id: resolved.paymentId! },
    });
    expect(settledPayment.settlementStatus).toBe("ACTUAL");
    expect(Number(settledPayment.amountKgs)).toBe(100);
    expect(settledPayment.shiftId).toBe(target.id);
    expect(await prisma.salePayment.count({ where: { refundRequestId: request.id } })).toBe(1);
    const settledRequest = await prisma.refundRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(settledRequest.status).toBe("RESOLVED");
    expect(settledRequest.shiftId).toBe(target.id);
    expect(settledRequest.reviewedById).toBe(f.adminUser.id);
    expect(settledRequest.reviewedAt).not.toBeNull();

    const targetReport = await shiftReport(f, target.id);
    expect(targetReport.summary.totalRefundsKgs).toBe(100);
    expect(targetReport.paymentsByMethod.TRANSFER.refundsKgs).toBe(100);
    const untouchedReport = await shiftReport(f, f.shift.id);
    expect(untouchedReport.summary.cashSalesKgs).toBe(250);
    expect(untouchedReport.summary.cashRefundsKgs).toBe(0);
    expect(untouchedReport.summary.expectedCashKgs).toBe(250);

    await expect(resolveRefund(f, request.id, "RESOLVED", target.id)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(await prisma.salePayment.count({ where: { refundRequestId: request.id } })).toBe(1);

    const balance = await quote(f, order.id, []);
    expect(balance.money).toMatchObject({
      paidKgs: 250,
      returnedKgs: 100,
      actualRefundedKgs: 100,
      pendingRefundKgs: 0,
      offsetKgs: 0,
      netPaidKgs: 150,
      refundedKgs: 100,
    });
  });

  it("keeps an accepted transfer return payable and refuses final cancellation", async () => {
    const f = await fixture();
    const order = await paidSale(f);
    const line = await prisma.customerOrderLine.findFirstOrThrow({
      where: { customerOrderId: order.id, productId: f.product.id },
    });
    const result = await correct(f, order.id, [{ lineId: line.id, qty: 1 }], [], {
      paymentMethod: "TRANSFER",
    });
    const request = await prisma.refundRequest.findUniqueOrThrow({
      where: { saleReturnId: result.saleReturnId! },
    });
    const stockAfterReturn = await stock(f, f.product.id);

    await expect(resolveRefund(f, request.id, "CANCELED")).rejects.toMatchObject({
      code: "CONFLICT",
      message: "salesOrderCorrectionRefundCannotCancel",
    });
    const unchangedRequest = await prisma.refundRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(unchangedRequest.status).toBe("OPEN");
    const unchangedPayment = await prisma.salePayment.findUniqueOrThrow({
      where: { refundRequestId: request.id },
    });
    expect(unchangedPayment.settlementStatus).toBe("PENDING");
    expect(Number(unchangedPayment.amountKgs)).toBe(100);

    await expect(f.api.salesOrders.correctionQuote({
      originalOrderId: order.id,
      returns: [],
      additions: [],
    })).rejects.toMatchObject({ message: "salesOrderCorrectionRefundPending" });

    const settled = await resolveRefund(f, request.id, "RESOLVED", f.shift.id);
    expect(settled.status).toBe("RESOLVED");
    const actual = await prisma.salePayment.findUniqueOrThrow({
      where: { id: settled.paymentId! },
    });
    expect(actual.settlementStatus).toBe("ACTUAL");
    expect(Number(actual.amountKgs)).toBe(100);
    expect(await stock(f, f.product.id)).toBe(stockAfterReturn);
    await expect(resolveRefund(f, request.id, "RESOLVED", f.shift.id)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(
      await prisma.salePayment.count({ where: { refundRequestId: request.id } }),
    ).toBe(1);
    const finalBalance = await quote(f, order.id, []);
    expect(finalBalance.money).toMatchObject({
      actualRefundedKgs: 100,
      pendingRefundKgs: 0,
      netPaidKgs: 150,
    });
  });

  it("requires a manager with store access to resolve a correction refund", async () => {
    const f = await fixture();
    const order = await paidSale(f);
    const line = await prisma.customerOrderLine.findFirstOrThrow({
      where: { customerOrderId: order.id, productId: f.product.id },
    });
    const result = await correct(f, order.id, [{ lineId: line.id, qty: 1 }], [], {
      paymentMethod: "TRANSFER",
    });
    const request = await prisma.refundRequest.findUniqueOrThrow({
      where: { saleReturnId: result.saleReturnId! },
    });

    await expect(
      f.staffApi.salesOrders.resolveCorrectionRefund({
        refundRequestId: request.id,
        action: "RESOLVED",
        shiftId: f.shift.id,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const otherStore = await prisma.store.create({
      data: { organizationId: f.org.id, name: "Refund other store", code: randomUUID() },
    });
    const otherManager = await prisma.user.create({
      data: {
        organizationId: f.org.id,
        email: `refund-other-${randomUUID()}@test.local`,
        name: "Refund other manager",
        passwordHash: "hash",
        role: Role.MANAGER,
      },
    });
    await prisma.userStoreAccess.create({
      data: { organizationId: f.org.id, userId: otherManager.id, storeId: otherStore.id },
    });
    const otherApi = createTestCaller(asUser(otherManager));
    await expect(
      otherApi.salesOrders.resolveCorrectionRefund({
        refundRequestId: request.id,
        action: "RESOLVED",
        shiftId: f.shift.id,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const unchanged = await prisma.refundRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(unchanged.status).toBe("OPEN");
    const unchangedPayment = await prisma.salePayment.findUniqueOrThrow({
      where: { refundRequestId: request.id },
    });
    expect(unchangedPayment.settlementStatus).toBe("PENDING");
  });

  it.each(["CASH", "CARD", "OTHER"] as const)(
    "records a pure %s return as actual money immediately",
    async (method) => {
      const f = await fixture();
      const order = await paidSale(f, undefined, "RETAIL", method);
      const line = await prisma.customerOrderLine.findFirstOrThrow({
        where: { customerOrderId: order.id, productId: f.product.id },
      });
      const result = await correct(f, order.id, [{ lineId: line.id, qty: 1 }], [], {
        paymentMethod: method,
      });
      expect(result.offsetKgs).toBe(0);
      expect(result.refundKgs).toBe(100);
      expect(result.actualRefundKgs).toBe(100);
      expect(result.pendingRefundKgs).toBe(0);
      expect(result.manualRefundRequired).toBe(false);
      const { refunds } = await correctionPayments(result);
      expect(refunds).toHaveLength(1);
      expect(refunds[0]?.settlementStatus).toBe("ACTUAL");
      expect(Number(refunds[0]?.amountKgs)).toBe(100);
      expect(await prisma.refundRequest.count({ where: { originalSaleId: order.id } })).toBe(0);
      const report = await shiftReport(f, f.shift.id);
      expect(report.summary.totalRefundsKgs).toBe(100);
      expect(report.summary.totalNetKgs).toBe(150);
      if (method === "CASH") {
        expect(report.summary.cashRefundsKgs).toBe(100);
        expect(report.summary.expectedCashKgs).toBe(150);
      }
      const balance = await quote(f, order.id, []);
      expect(balance.money).toMatchObject({
        actualRefundedKgs: 100,
        pendingRefundKgs: 0,
        offsetKgs: 0,
        netPaidKgs: 150,
      });
    },
  );

  it.each(["CASH", "CARD", "TRANSFER"] as const)(
    "settles an equal %s exchange entirely by offset without moving money or stock twice",
    async (method) => {
      const f = await fixture();
      const order = await paidSale(f, undefined, "RETAIL", method);
      const line = await prisma.customerOrderLine.findFirstOrThrow({
        where: { customerOrderId: order.id, productId: f.product.id },
      });
      const stockBefore = await stock(f, f.product.id);
      const before = await quote(f, order.id, []);
      expect(before.money).toMatchObject({
        paidKgs: 250,
        returnedKgs: 0,
        actualRefundedKgs: 0,
        pendingRefundKgs: 0,
        offsetKgs: 0,
        netPaidKgs: 250,
      });

      const result = await correct(
        f,
        order.id,
        [{ lineId: line.id, qty: 1 }],
        [{ productId: f.product.id, qty: 1 }],
        { paymentMethod: method },
      );
      expect(result.offsetKgs).toBe(100);
      expect(result.refundKgs).toBe(0);
      expect(result.chargeKgs).toBe(0);
      expect(result.actualRefundKgs).toBe(0);
      expect(result.pendingRefundKgs).toBe(0);
      expect(result.manualRefundRequired).toBe(false);

      const { refunds, sales } = await correctionPayments(result);
      expect(refunds).toHaveLength(1);
      expect(refunds[0]?.settlementStatus).toBe("OFFSET");
      expect(Number(refunds[0]?.amountKgs)).toBe(100);
      expect(sales).toHaveLength(1);
      expect(sales[0]?.settlementStatus).toBe("OFFSET");
      expect(Number(sales[0]?.amountKgs)).toBe(100);
      const addition = await prisma.customerOrder.findUniqueOrThrow({
        where: { id: result.additionOrderId! },
      });
      expect(Number(addition.totalKgs)).toBe(100);
      expect(sales.reduce((sum, payment) => sum + Number(payment.amountKgs), 0)).toBe(100);
      expect(await prisma.refundRequest.count({ where: { originalSaleId: order.id } })).toBe(0);

      const report = await shiftReport(f, f.shift.id);
      expect(report.summary.totalSalesKgs).toBe(250);
      expect(report.summary.totalRefundsKgs).toBe(0);
      expect(report.summary.totalNetKgs).toBe(250);

      expect(await stock(f, f.product.id)).toBe(stockBefore);
      expect(
        await prisma.stockMovement.count({
          where: { referenceType: "SaleReturn", referenceId: result.saleReturnId! },
        }),
      ).toBe(1);
      expect(
        await prisma.stockMovement.count({
          where: {
            referenceType: "CustomerOrder",
            referenceId: result.additionOrderId!,
            type: "SALE",
          },
        }),
      ).toBe(1);

      const balance = await quote(f, order.id, []);
      expect(balance.money).toMatchObject({
        paidKgs: 250,
        returnedKgs: 100,
        actualRefundedKgs: 0,
        pendingRefundKgs: 0,
        offsetKgs: 100,
        netPaidKgs: 150,
      });
    },
  );

  it.each(["CASH", "CARD", "TRANSFER"] as const)(
    "charges only the %s difference when the exchange is more expensive",
    async (method) => {
      const f = await fixture();
      const order = await paidSale(f, undefined, "RETAIL", method);
      const line = await prisma.customerOrderLine.findFirstOrThrow({
        where: { customerOrderId: order.id, productId: f.product.id },
      });
      const result = await correct(
        f,
        order.id,
        [{ lineId: line.id, qty: 1 }],
        [{ productId: f.premium.id, qty: 1 }],
        { paymentMethod: method },
      );
      expect(result.offsetKgs).toBe(100);
      expect(result.refundKgs).toBe(0);
      expect(result.chargeKgs).toBe(50);
      expect(result.actualRefundKgs).toBe(0);
      expect(result.pendingRefundKgs).toBe(0);

      const { refunds, sales } = await correctionPayments(result);
      expect(refunds).toHaveLength(1);
      expect(refunds[0]?.settlementStatus).toBe("OFFSET");
      expect(Number(refunds[0]?.amountKgs)).toBe(100);
      expect(sales.map((payment) => [payment.settlementStatus, Number(payment.amountKgs)])).toEqual(
        [
          ["OFFSET", 100],
          ["ACTUAL", 50],
        ],
      );
      const addition = await prisma.customerOrder.findUniqueOrThrow({
        where: { id: result.additionOrderId! },
      });
      expect(Number(addition.totalKgs)).toBe(150);
      expect(sales.reduce((sum, payment) => sum + Number(payment.amountKgs), 0)).toBe(150);
      expect(await prisma.refundRequest.count({ where: { originalSaleId: order.id } })).toBe(0);
      const paymentInfo = await f.api.salesOrders.paymentInfo({
        customerOrderId: result.additionOrderId!,
      });
      expect(paymentInfo).toMatchObject({
        paidKgs: 150,
        actualPaidKgs: 50,
        offsetKgs: 100,
        remainingKgs: 0,
      });

      const report = await shiftReport(f, f.shift.id);
      expect(report.summary.totalSalesKgs).toBe(300);
      expect(report.summary.totalRefundsKgs).toBe(0);
      expect(report.summary.totalNetKgs).toBe(300);
      const listed = await listedShift(f, f.shift.id);
      expect(listed?.summary.totalSalesKgs).toBe(300);
      expect(listed?.summary.totalRefundsKgs).toBe(0);
    },
  );

  it.each(["CASH", "CARD", "TRANSFER"] as const)(
    "refunds only the %s difference when the exchange is cheaper",
    async (method) => {
      const f = await fixture();
      const order = await paidSale(f, undefined, "RETAIL", method);
      const line = await prisma.customerOrderLine.findFirstOrThrow({
        where: { customerOrderId: order.id, productId: f.product.id },
      });
      const result = await correct(
        f,
        order.id,
        [{ lineId: line.id, qty: 1 }],
        [{ productId: f.second.id, qty: 1 }],
        { paymentMethod: method },
      );
      expect(result.offsetKgs).toBe(50);
      expect(result.refundKgs).toBe(50);
      expect(result.chargeKgs).toBe(0);
      expect(result.actualRefundKgs).toBe(method === "TRANSFER" ? 0 : 50);
      expect(result.pendingRefundKgs).toBe(method === "TRANSFER" ? 50 : 0);
      expect(result.manualRefundRequired).toBe(method === "TRANSFER");

      const { refunds, sales } = await correctionPayments(result);
      expect(refunds).toHaveLength(2);
      expect(
        refunds.map((payment) => [payment.settlementStatus, Number(payment.amountKgs)]),
      ).toEqual(
        method === "TRANSFER"
          ? [
              ["OFFSET", 50],
              ["PENDING", 50],
            ]
          : [
              ["OFFSET", 50],
              ["ACTUAL", 50],
            ],
      );
      expect(sales).toHaveLength(1);
      expect(sales[0]?.settlementStatus).toBe("OFFSET");
      expect(Number(sales[0]?.amountKgs)).toBe(50);
      const addition = await prisma.customerOrder.findUniqueOrThrow({
        where: { id: result.additionOrderId! },
      });
      expect(Number(addition.totalKgs)).toBe(50);
      expect(sales.reduce((sum, payment) => sum + Number(payment.amountKgs), 0)).toBe(50);

      const report = await shiftReport(f, f.shift.id);
      expect(report.summary.totalSalesKgs).toBe(250);
      if (method === "TRANSFER") {
        expect(report.summary.totalRefundsKgs).toBe(0);
        expect(report.summary.totalNetKgs).toBe(250);
        const request = await prisma.refundRequest.findFirstOrThrow({
          where: { originalSaleId: order.id, status: "OPEN" },
        });
        expect(Number(request.amountKgs)).toBe(50);
        expect(request.shiftId).toBe(f.shift.id);
      } else {
        expect(report.summary.totalRefundsKgs).toBe(50);
        expect(report.summary.totalNetKgs).toBe(200);
      }
    },
  );

  it.each(["CASH", "TRANSFER", "CARD"] as const)(
    "keeps the closed original shift untouched for %s and preserves explicit method guards",
    async (method) => {
      const f = await fixture();
      const order = await paidSale(f, undefined, "RETAIL", method);
      const line = await prisma.customerOrderLine.findFirstOrThrow({
        where: { customerOrderId: order.id, productId: f.product.id },
      });
      await prisma.registerShift.update({
        where: { id: f.shift.id },
        data: {
          status: "CLOSED",
          closedAt: new Date(),
          closedById: f.adminUser.id,
          expectedCashKgs: 250,
        },
      });
      const currentShift = await openShift(f, `${method} current register`);

      if (method === "CARD") {
        await expect(
          correct(f, order.id, [{ lineId: line.id, qty: 1 }], [], {
            shiftId: currentShift.id,
            paymentMethod: "CARD",
          }),
        ).rejects.toMatchObject({ message: "posCardRefundShiftMismatch" });
        expect(await prisma.saleReturn.count({ where: { originalSaleId: order.id } })).toBe(0);
        expect(
          await prisma.salePayment.count({
            where: { customerOrderId: order.id, isRefund: true },
          }),
        ).toBe(0);
        expect(
          await prisma.salesOrderCorrection.count({ where: { originalOrderId: order.id } }),
        ).toBe(0);
        return;
      }

      const result = await correct(f, order.id, [{ lineId: line.id, qty: 1 }], [], {
        shiftId: currentShift.id,
        paymentMethod: method,
      });
      const { refunds } = await correctionPayments(result);
      expect(refunds).toHaveLength(1);
      expect(refunds[0]?.shiftId).toBe(currentShift.id);
      expect(refunds[0]?.settlementStatus).toBe(method === "TRANSFER" ? "PENDING" : "ACTUAL");
      if (method === "TRANSFER") {
        const request = await prisma.refundRequest.findUniqueOrThrow({
          where: { saleReturnId: result.saleReturnId! },
        });
        expect(request.shiftId).toBe(currentShift.id);
      }
      const closedReport = await shiftReport(f, f.shift.id);
      expect(closedReport.summary.totalSalesKgs).toBe(250);
      expect(closedReport.summary.cashRefundsKgs).toBe(0);
      expect(closedReport.summary.totalRefundsKgs).toBe(0);
      expect(closedReport.summary.expectedCashKgs).toBe(method === "CASH" ? 250 : 0);
      const currentReport = await shiftReport(f, currentShift.id);
      expect(currentReport.summary.totalRefundsKgs).toBe(method === "CASH" ? 100 : 0);
    },
  );

  it("makes a concurrent shift close wait for the correction and include it exactly once", async () => {
    const f = await fixture();
    const order = await paidSale(f);
    const line = await prisma.customerOrderLine.findFirstOrThrow({
      where: { customerOrderId: order.id, productId: f.product.id },
    });
    const preview = await quote(f, order.id, [{ lineId: line.id, qty: 1 }]);
    const entered = deferred();
    const release = deferred();
    let correctionPid = 0;

    const correctionPromise = correctCompletedCustomerOrder({
      organizationId: f.org.id,
      actorId: f.adminUser.id,
      requestId: randomUUID(),
      originalOrderId: order.id,
      expectedFingerprint: preview.fingerprint,
      reason: "Concurrent close",
      returns: [{ lineId: line.id, qty: 1, restock: true }],
      additions: [],
      shiftId: f.shift.id,
      paymentMethod: "CASH",
      idempotencyKey: randomUUID(),
      testHooks: {
        afterValidation: async (tx) => {
          const rows = await tx.$queryRaw<Array<{ pid: number }>>`
            SELECT pg_backend_pid() AS pid
          `;
          correctionPid = Number(rows[0]?.pid ?? 0);
          entered.resolve();
          await release.promise;
        },
      },
    });

    await entered.promise;
    expect(correctionPid).toBeGreaterThan(0);
    const closePromise = closeRegisterShift({
      organizationId: f.org.id,
      shiftId: f.shift.id,
      closingCashCountedKgs: 150,
      notes: "Synthetic correction race",
      actorId: f.adminUser.id,
      user: adminUser(f),
      requestId: randomUUID(),
      idempotencyKey: randomUUID(),
    });
    let closeSettled = false;
    void closePromise.then(
      () => {
        closeSettled = true;
      },
      () => {
        closeSettled = true;
      },
    );

    await waitForLockWait(correctionPid);
    expect(closeSettled).toBe(false);
    release.resolve();

    const [correctionResult, closed] = await Promise.all([correctionPromise, closePromise]);
    expect(correctionResult.refundKgs).toBe(100);
    expect(closed.status).toBe("CLOSED");
    expect(closed.expectedCashKgs).toBe(150);

    const report = await shiftReport(f, f.shift.id);
    expect(report.summary.salesTotalKgs).toBe(0);
    expect(report.summary.totalSalesKgs).toBe(250);
    expect(report.summary.returnsTotalKgs).toBe(100);
    expect(report.summary.cashSalesKgs).toBe(250);
    expect(report.summary.cashRefundsKgs).toBe(100);
    expect(report.summary.expectedCashKgs).toBe(150);
    expect(await prisma.saleReturn.count({ where: { originalSaleId: order.id } })).toBe(1);
    expect(
      await prisma.salePayment.count({
        where: {
          saleReturnId: correctionResult.saleReturnId!,
          isRefund: true,
          settlementStatus: "ACTUAL",
        },
      }),
    ).toBe(1);
    const refund = await prisma.salePayment.findFirstOrThrow({
      where: { saleReturnId: correctionResult.saleReturnId!, isRefund: true },
    });
    expect(refund.shiftId).toBe(f.shift.id);
    expect(
      await prisma.stockMovement.count({
        where: { referenceType: "SaleReturn", referenceId: correctionResult.saleReturnId! },
      }),
    ).toBe(1);
  });

  it("refuses a correction that starts after its shift is already closed and writes nothing", async () => {
    const f = await fixture();
    const order = await paidSale(f);
    const line = await prisma.customerOrderLine.findFirstOrThrow({
      where: { customerOrderId: order.id, productId: f.product.id },
    });
    const closed = await closeRegisterShift({
      organizationId: f.org.id,
      shiftId: f.shift.id,
      closingCashCountedKgs: 250,
      actorId: f.adminUser.id,
      user: adminUser(f),
      requestId: randomUUID(),
      idempotencyKey: randomUUID(),
    });
    expect(closed.status).toBe("CLOSED");
    const stockBefore = await stock(f, f.product.id);
    const returnsBefore = await prisma.saleReturn.count({ where: { originalSaleId: order.id } });
    const refundsBefore = await prisma.salePayment.count({
      where: { customerOrderId: order.id, isRefund: true },
    });

    await expect(
      correct(f, order.id, [{ lineId: line.id, qty: 1 }], [], {
        shiftId: f.shift.id,
        paymentMethod: "CASH",
      }),
    ).rejects.toMatchObject({ message: "posShiftNotOpen" });

    expect(await stock(f, f.product.id)).toBe(stockBefore);
    expect(await prisma.saleReturn.count({ where: { originalSaleId: order.id } })).toBe(
      returnsBefore,
    );
    expect(
      await prisma.salePayment.count({ where: { customerOrderId: order.id, isRefund: true } }),
    ).toBe(refundsBefore);
    expect(await prisma.salesOrderCorrection.count({ where: { originalOrderId: order.id } })).toBe(
      0,
    );
  });

  it("keeps pending refunds reserved in the paid cap until confirmation", async () => {
    const f = await fixture();
    const order = await paidSale(f);
    const line = await prisma.customerOrderLine.findFirstOrThrow({
      where: { customerOrderId: order.id, productId: f.product.id },
    });
    const result = await correct(f, order.id, [{ lineId: line.id, qty: 1 }], [], {
      paymentMethod: "TRANSFER",
    });
    const request = await prisma.refundRequest.findUniqueOrThrow({
      where: { saleReturnId: result.saleReturnId! },
    });

    await expect(
      prisma.$transaction((tx) =>
        assertRefundWithinPaidAmount(tx, order.id, order.totalKgs, new Prisma.Decimal(200)),
      ),
    ).rejects.toMatchObject({ message: "posPaymentTotalMismatch" });
    await expect(
      prisma.$transaction((tx) =>
        assertRefundWithinPaidAmount(tx, order.id, order.totalKgs, new Prisma.Decimal(150)),
      ),
    ).resolves.toBeUndefined();

    await expect(resolveRefund(f, request.id, "CANCELED")).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(
      prisma.$transaction((tx) =>
        assertRefundWithinPaidAmount(tx, order.id, order.totalKgs, new Prisma.Decimal(250)),
      ),
    ).rejects.toMatchObject({ message: "posPaymentTotalMismatch" });

    await resolveRefund(f, request.id, "RESOLVED", f.shift.id);
    await expect(
      prisma.$transaction((tx) =>
        assertRefundWithinPaidAmount(tx, order.id, order.totalKgs, new Prisma.Decimal(150)),
      ),
    ).resolves.toBeUndefined();
    await expect(
      prisma.$transaction((tx) =>
        assertRefundWithinPaidAmount(tx, order.id, order.totalKgs, new Prisma.Decimal(150.01)),
      ),
    ).rejects.toMatchObject({ message: "posPaymentTotalMismatch" });
  });
});
