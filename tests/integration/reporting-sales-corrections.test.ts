import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { businessDateKey, businessDateOnlyEndUtc, businessDateOnlyToUtc } from "@/lib/timezone";
import { adjustStock } from "@/server/services/inventory";
import { closePeriod } from "@/server/services/periodClose";
import { getSalesReport } from "@/server/services/reporting/sales";
import {
  correctCompletedCustomerOrder,
  quoteSalesOrderCorrection,
} from "@/server/services/salesOrderCorrections";
import { recordOrderPayment } from "@/server/services/salesOrderPayments";
import { createCustomerSaleOperation } from "@/server/services/salesOrders";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

async function fixture() {
  const base = await seedBase({ plan: "ENTERPRISE" });
  const { org, store, adminUser, managerUser } = base;
  await prisma.userStoreAccess.upsert({
    where: { userId_storeId: { userId: managerUser.id, storeId: store.id } },
    update: {},
    create: { organizationId: org.id, userId: managerUser.id, storeId: store.id },
  });
  const additionProduct = await prisma.product.create({
    data: {
      organizationId: org.id,
      supplierId: base.supplier.id,
      sku: "REPORT-CORRECTION-ADD",
      name: "Добавленный товар",
      unit: base.baseUnit.code,
      baseUnitId: base.baseUnit.id,
      basePriceKgs: 100,
    },
  });
  for (const product of [base.product, additionProduct]) {
    await prisma.storeProduct.upsert({
      where: { storeId_productId: { storeId: store.id, productId: product.id } },
      update: { isActive: true },
      create: {
        organizationId: org.id,
        storeId: store.id,
        productId: product.id,
        isActive: true,
      },
    });
    await adjustStock({
      organizationId: org.id,
      actorId: adminUser.id,
      storeId: store.id,
      productId: product.id,
      qtyDelta: 100,
      reason: "reporting correction fixture",
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
    });
  }
  const register = await prisma.posRegister.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      name: "Report register",
      code: randomUUID(),
    },
  });
  const shift = await prisma.registerShift.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      registerId: register.id,
      openedById: adminUser.id,
      openingCashKgs: 0,
    },
  });
  return {
    ...base,
    additionProduct,
    register,
    shift,
    organizationId: org.id,
    storeId: store.id,
    employeeA: managerUser,
    employeeB: adminUser,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

const storeUser = (f: Fixture, user: Fixture["employeeA"]) => ({
  id: user.id,
  organizationId: f.organizationId,
  role: user.role,
  isOrgOwner: Boolean(user.isOrgOwner),
});

/** A completed non-POS order created through the real service by employee A. */
async function saleByA(f: Fixture, qty = 10, unitPriceKgs = 100) {
  const operation = await createCustomerSaleOperation({
    organizationId: f.organizationId,
    storeId: f.storeId,
    actorId: f.employeeA.id,
    requestId: randomUUID(),
    idempotencyKey: randomUUID(),
    lines: [{ productId: f.product.id, qty, unitPriceKgs }],
  });
  const order = await prisma.customerOrder.findUniqueOrThrow({
    where: { id: operation.response.order.id },
    include: { lines: true },
  });
  await recordOrderPayment({
    user: storeUser(f, f.employeeA),
    customerOrderId: order.id,
    shiftId: f.shift.id,
    amountKgs: Number(order.totalKgs),
    method: "CASH",
    idempotencyKey: randomUUID(),
    requestId: randomUUID(),
  });
  return order;
}

/** The real correction service; employee B performs the correction. */
async function correctByB(
  f: Fixture,
  originalOrderId: string,
  returns: Array<{ lineId: string; qty: number }>,
  additions: Array<{ productId: string; qty: number }> = [],
) {
  const request = {
    organizationId: f.organizationId,
    actorId: f.employeeB.id,
    originalOrderId,
    returns: returns.map((line) => ({ ...line, restock: true })),
    additions,
  };
  const quote = await quoteSalesOrderCorrection(request);
  return correctCompletedCustomerOrder({
    ...request,
    expectedFingerprint: quote.fingerprint,
    reason: "Reporting fixture correction",
    shiftId: f.shift.id,
    paymentMethod: "CASH",
    idempotencyKey: randomUUID(),
    requestId: randomUUID(),
  });
}

/** A POS-channel document pair, seeded as historical evidence for the channel filter. */
async function seedPosPair(f: Fixture, completedAt: Date) {
  const sale = await prisma.customerOrder.create({
    data: {
      organizationId: f.organizationId,
      storeId: f.storeId,
      registerId: f.register.id,
      shiftId: f.shift.id,
      number: `POS-${randomUUID()}`,
      status: "COMPLETED",
      isPosSale: true,
      completedAt,
      createdById: f.cashierUser.id,
      subtotalKgs: 500,
      totalKgs: 500,
      lines: {
        create: {
          productId: f.product.id,
          qty: 5,
          unitPriceKgs: 100,
          lineTotalKgs: 500,
        },
      },
    },
    include: { lines: true },
  });
  const saleReturn = await prisma.saleReturn.create({
    data: {
      organizationId: f.organizationId,
      storeId: f.storeId,
      registerId: f.register.id,
      shiftId: f.shift.id,
      originalSaleId: sale.id,
      number: `POSR-${randomUUID()}`,
      status: "COMPLETED",
      completedAt,
      completedById: f.cashierUser.id,
      createdById: f.cashierUser.id,
      subtotalKgs: 100,
      totalKgs: 100,
      lines: {
        create: {
          customerOrderLineId: sale.lines[0]!.id,
          productId: f.product.id,
          qty: 1,
          unitPriceKgs: 100,
          lineTotalKgs: 100,
        },
      },
    },
  });
  return { sale, saleReturn };
}

const report = (f: Fixture, now: Date, overrides: Record<string, unknown> = {}) => {
  const today = businessDateKey(now);
  return getSalesReport(
    prisma,
    {
      organizationId: f.organizationId,
      storeIds: [f.storeId],
      dateFrom: today,
      dateTo: today,
      ...overrides,
    },
    { now },
  );
};

describeDb("sales reporting after real completed-order corrections", () => {
  beforeEach(resetDatabase);

  it("includes the correction return in the original sale channel with completion attribution", async () => {
    const f = await fixture();
    const order = await saleByA(f);
    const pos = await seedPosPair(f, new Date());
    const line = order.lines.find((row) => row.productId === f.product.id)!;
    const correction = await correctByB(f, order.id, [{ lineId: line.id, qty: 2 }]);
    const now = new Date();
    expect(correction).toMatchObject({ returnedKgs: 200, refundKgs: 200, addedKgs: 0 });
    const saleReturn = await prisma.saleReturn.findUniqueOrThrow({
      where: { id: correction.saleReturnId! },
    });
    const completedAt = saleReturn.completedAt!;
    expect(completedAt.getTime()).toBeGreaterThanOrEqual(order.completedAt!.getTime());
    const today = businessDateKey(now);
    expect(businessDateKey(completedAt)).toBe(today);

    // Reproduction: before the fix channel "orders" dropped every return, so
    // this assertion failed with returnsKgs 0 / netSalesKgs 1000.
    const orders = await report(f, now, { channel: "orders", view: "staff" });
    expect(orders.totals).toMatchObject({
      grossSalesKgs: 1000,
      returnsKgs: 200,
      netSalesKgs: 800,
      receiptCount: 1,
      returnCount: 1,
    });
    expect(orders.items).toHaveLength(2);
    const employeeARow = orders.items.find((row) => row.employeeId === f.employeeA.id)!;
    const employeeBRow = orders.items.find((row) => row.employeeId === f.employeeB.id)!;
    expect(employeeARow).toMatchObject({
      name: f.employeeA.name,
      grossSalesKgs: 1000,
      returnsKgs: 0,
      netSalesKgs: 1000,
      receiptCount: 1,
    });
    expect(employeeBRow).toMatchObject({
      name: f.employeeB.name,
      grossSalesKgs: 0,
      returnsKgs: 200,
      netSalesKgs: -200,
      returnCount: 1,
    });

    const documents = await report(f, now, { channel: "orders", view: "documents" });
    const saleDocument = documents.items.find((row) => row.documentId === order.id)!;
    const returnDocument = documents.items.find((row) => row.documentId === saleReturn.id)!;
    expect(saleDocument).toMatchObject({
      kind: "sale",
      documentNumber: order.number,
      employeeId: f.employeeA.id,
      grossSalesKgs: 1000,
      returnsKgs: 0,
      netSalesKgs: 1000,
      date: businessDateKey(order.completedAt!),
    });
    expect(returnDocument).toMatchObject({
      kind: "return",
      documentNumber: saleReturn.number,
      employeeId: f.employeeB.id,
      originalSaleId: order.id,
      grossSalesKgs: 0,
      returnsKgs: 200,
      netSalesKgs: -200,
      date: today,
    });
    expect(businessDateKey(new Date(returnDocument.eventAt!))).toBe(today);

    const posReport = await report(f, now, { channel: "pos", view: "documents" });
    expect(posReport.totals).toMatchObject({
      grossSalesKgs: 500,
      returnsKgs: 100,
      netSalesKgs: 400,
      receiptCount: 1,
      returnCount: 1,
    });
    expect(posReport.items.some((row) => row.documentId === saleReturn.id)).toBe(false);
    expect(posReport.items.some((row) => row.documentId === order.id)).toBe(false);

    const all = await report(f, now, { view: "documents" });
    expect(all.totals).toMatchObject({
      grossSalesKgs: 1500,
      returnsKgs: 300,
      netSalesKgs: 1200,
      receiptCount: 2,
      returnCount: 2,
    });
    expect(all.items.some((row) => row.documentId === pos.sale.id)).toBe(true);
    expect(all.items.some((row) => row.documentId === saleReturn.id)).toBe(true);
    expect(all.items.some((row) => row.documentId === pos.saleReturn.id)).toBe(true);
  });

  it("reports exchange-more, exchange-less and addition-only corrections by document", async () => {
    const f = await fixture();
    const orderMore = await saleByA(f);
    const orderLess = await saleByA(f);
    const orderAddition = await saleByA(f);

    const more = await correctByB(
      f,
      orderMore.id,
      [{ lineId: orderMore.lines[0]!.id, qty: 3 }],
      [{ productId: f.additionProduct.id, qty: 5 }],
    );
    expect(more).toMatchObject({
      returnedKgs: 300,
      addedKgs: 500,
      offsetKgs: 300,
      refundKgs: 0,
      chargeKgs: 200,
    });
    const less = await correctByB(
      f,
      orderLess.id,
      [{ lineId: orderLess.lines[0]!.id, qty: 5 }],
      [{ productId: f.additionProduct.id, qty: 3 }],
    );
    expect(less).toMatchObject({
      returnedKgs: 500,
      addedKgs: 300,
      offsetKgs: 300,
      refundKgs: 200,
      chargeKgs: 0,
    });
    const additionOnly = await correctByB(
      f,
      orderAddition.id,
      [],
      [{ productId: f.additionProduct.id, qty: 2 }],
    );
    expect(additionOnly).toMatchObject({
      returnedKgs: 0,
      addedKgs: 200,
      offsetKgs: 0,
      refundKgs: 0,
      chargeKgs: 200,
      saleReturnId: null,
    });
    expect(additionOnly.additionOrderId).not.toBeNull();
    const now = new Date();

    // Three original 1000 sales, plus added goods 500 + 300 + 200.
    const orders = await report(f, now, { channel: "orders", view: "documents" });
    expect(orders.totals).toMatchObject({
      grossSalesKgs: 4000,
      returnsKgs: 800,
      netSalesKgs: 3200,
      receiptCount: 6,
      returnCount: 2,
    });
    const additionDocument = orders.items.find(
      (row) => row.documentId === additionOnly.additionOrderId,
    )!;
    expect(additionDocument).toMatchObject({
      kind: "sale",
      grossSalesKgs: 200,
      netSalesKgs: 200,
      employeeId: f.employeeB.id,
      date: businessDateKey(now),
    });
    expect(
      orders.items
        .filter((row) => row.kind === "return")
        .map((row) => row.returnsKgs)
        .sort((a, b) => a - b),
    ).toEqual([300, 500]);
    expect(
      orders.items
        .filter((row) => row.kind === "sale" && row.documentId !== orderMore.id)
        .reduce((sum, row) => sum + row.grossSalesKgs, 0),
    ).toBe(3000);

    const staff = await report(f, now, { channel: "orders", view: "staff" });
    expect(staff.items.find((row) => row.employeeId === f.employeeB.id)).toMatchObject({
      grossSalesKgs: 1000,
      returnsKgs: 800,
      netSalesKgs: 200,
    });
  });

  it("inherits the original commercial sale channel on correction additions", async () => {
    for (const saleChannel of ["ONLINE", "IN_STORE", null] as const) {
      await resetDatabase();
      const f = await fixture();
      const order = await saleByA(f);
      await prisma.customerOrder.update({
        where: { id: order.id },
        data: { saleChannel },
      });
      const line = await prisma.customerOrderLine.findFirstOrThrow({
        where: { customerOrderId: order.id },
      });
      const correction = await correctByB(
        f,
        order.id,
        [{ lineId: line.id, qty: 2 }],
        [{ productId: f.additionProduct.id, qty: 3 }],
      );
      const addition = await prisma.customerOrder.findUniqueOrThrow({
        where: { id: correction.additionOrderId! },
      });
      expect(addition.saleChannel).toBe(saleChannel);

      const now = new Date();
      const filter = saleChannel === null ? "UNKNOWN" : saleChannel;
      const filtered = await report(f, now, { channel: "orders", saleChannel: filter });
      expect(filtered.totals).toMatchObject({
        grossSalesKgs: 1300,
        returnsKgs: 200,
        netSalesKgs: 1100,
      });
      const otherChannel = saleChannel === "ONLINE" ? "IN_STORE" : "ONLINE";
      const excluded = await report(f, now, { channel: "orders", saleChannel: otherChannel });
      expect(excluded.totals).toMatchObject({
        grossSalesKgs: 0,
        returnsKgs: 0,
        netSalesKgs: 0,
      });
    }
  });

  it("dates the correction now and excludes it from a period closed around the original sale", async () => {
    const f = await fixture();
    const order = await saleByA(f);
    const closedDay = "2026-11-10";
    await prisma.customerOrder.update({
      where: { id: order.id },
      data: { completedAt: businessDateOnlyToUtc(closedDay, 0) },
    });
    await closePeriod({
      organizationId: f.organizationId,
      storeId: f.storeId,
      periodStart: businessDateOnlyToUtc(closedDay),
      periodEnd: businessDateOnlyEndUtc(closedDay),
      closedById: f.employeeB.id,
      requestId: randomUUID(),
    });
    const line = await prisma.customerOrderLine.findFirstOrThrow({
      where: { customerOrderId: order.id },
    });
    const correction = await correctByB(f, order.id, [{ lineId: line.id, qty: 2 }]);
    const reportNow = new Date();
    const saleReturn = await prisma.saleReturn.findUniqueOrThrow({
      where: { id: correction.saleReturnId! },
    });
    expect(businessDateKey(saleReturn.completedAt!)).toBe(businessDateKey(reportNow));
    expect(businessDateKey(saleReturn.completedAt!)).not.toBe(closedDay);

    const closed = await getSalesReport(
      prisma,
      {
        organizationId: f.organizationId,
        storeIds: [f.storeId],
        dateFrom: closedDay,
        dateTo: closedDay,
        channel: "orders",
      },
      { now: reportNow },
    );
    expect(closed.totals).toMatchObject({
      grossSalesKgs: 1000,
      returnsKgs: 0,
      netSalesKgs: 1000,
      receiptCount: 1,
      returnCount: 0,
    });

    const current = await report(f, reportNow, { channel: "orders" });
    expect(current.totals).toMatchObject({
      grossSalesKgs: 0,
      returnsKgs: 200,
      netSalesKgs: -200,
      receiptCount: 0,
      returnCount: 1,
    });
    const anotherDay = await getSalesReport(
      prisma,
      {
        organizationId: f.organizationId,
        storeIds: [f.storeId],
        dateFrom: "2026-11-12",
        dateTo: "2026-11-12",
        channel: "orders",
      },
      { now: reportNow },
    );
    expect(anotherDay.totals).toMatchObject({
      grossSalesKgs: 0,
      returnsKgs: 0,
      netSalesKgs: 0,
      receiptCount: 0,
      returnCount: 0,
    });
  });
});
