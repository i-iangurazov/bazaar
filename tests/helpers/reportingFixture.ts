import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { seedBase } from "./db";

/** Synthetic, explicitly priced documents. Never calls payment, mail or fiscal providers. */
export async function seedReportingFixture(db: PrismaClient) {
  const base = await seedBase({ plan: "ENTERPRISE" });
  const { org, store, adminUser, baseUnit } = base;
  await db.organization.update({
    where: { id: org.id },
    data: { name: "REPORT QA · Базар Маркет" },
  });
  await db.store.update({ where: { id: store.id }, data: { name: "Бишкек · Центр" } });
  const otherStore = await db.store.create({
    data: {
      organizationId: org.id,
      name: "Ош · Южный",
      code: "OSH",
      currencyCode: "USD",
      currencyRateKgsPerUnit: 90,
    },
  });
  const register = await db.posRegister.create({
    data: { organizationId: org.id, storeId: store.id, name: "Основная касса", code: "MAIN" },
  });
  const shift = await db.registerShift.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      registerId: register.id,
      openedById: adminUser.id,
    },
  });
  const makeProduct = (name: string, sku: string, category: string) =>
    db.product.create({
      data: {
        organizationId: org.id,
        name,
        sku,
        category,
        categories: [category],
        unit: baseUnit.code,
        baseUnitId: baseUnit.id,
      },
    });
  const tea = await makeProduct("Чай · историческая стоимость", "REPORT-TEA", "Чай");
  const gift = await makeProduct("Подарок · нулевая стоимость", "REPORT-ZERO", "Подарки");
  const unknown = await makeProduct("Кофе · нет снимка стоимости", "REPORT-UNKNOWN", "Кофе");
  await db.productCost.createMany({
    data: [
      { organizationId: org.id, productId: tea.id, avgCostKgs: 999, costBasisQty: 100 },
      { organizationId: org.id, productId: gift.id, avgCostKgs: 0, costBasisQty: 20 },
      { organizationId: org.id, productId: unknown.id, avgCostKgs: 77, costBasisQty: 10 },
    ],
  });
  const sale = await db.customerOrder.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      registerId: register.id,
      shiftId: shift.id,
      number: "REPORT-POS-1",
      status: "COMPLETED",
      isPosSale: true,
      completedAt: new Date("2026-09-01T18:00:00Z"),
      createdAt: new Date("2026-01-01T00:00:00Z"),
      createdById: adminUser.id,
      customerName: "Учебный покупатель",
      customerEmail: "report@example.invalid",
      subtotalKgs: 400,
      discountKgs: 40,
      totalKgs: 360,
      lines: {
        create: [
          {
            productId: tea.id,
            qty: 3,
            unitPriceKgs: 100,
            baseUnitPriceKgs: 120,
            lineTotalKgs: 300,
            unitCostKgs: 10,
            lineCostTotalKgs: 30,
          },
          {
            productId: gift.id,
            qty: 2,
            unitPriceKgs: 50,
            lineTotalKgs: 100,
            unitCostKgs: 0,
            lineCostTotalKgs: 0,
          },
        ],
      },
    },
    include: { lines: true },
  });
  await db.salePayment.createMany({
    data: [
      {
        organizationId: org.id,
        storeId: store.id,
        shiftId: shift.id,
        customerOrderId: sale.id,
        method: "CASH",
        amountKgs: 100,
        createdAt: sale.completedAt!,
      },
      {
        organizationId: org.id,
        storeId: store.id,
        shiftId: shift.id,
        customerOrderId: sale.id,
        method: "CARD",
        amountKgs: 260,
        createdAt: sale.completedAt!,
      },
    ],
  });
  const uncostedSale = await db.customerOrder.create({
    data: {
      organizationId: org.id,
      storeId: otherStore.id,
      number: "REPORT-POS-2",
      status: "COMPLETED",
      isPosSale: true,
      completedAt: new Date("2026-09-02T04:00:00Z"),
      totalKgs: 80,
      subtotalKgs: 80,
      createdById: adminUser.id,
      currencyCode: "USD",
      currencyRateKgsPerUnit: 80,
      lines: { create: { productId: unknown.id, qty: 1, unitPriceKgs: 80, lineTotalKgs: 80 } },
    },
  });
  const order = await db.customerOrder.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      number: "REPORT-ORDER-1",
      status: "COMPLETED",
      isPosSale: false,
      completedAt: new Date("2026-09-02T05:00:00Z"),
      totalKgs: 200,
      subtotalKgs: 200,
      createdById: adminUser.id,
      customerName: "Учебный покупатель",
      customerEmail: "REPORT@example.invalid",
      lines: {
        create: {
          productId: tea.id,
          qty: 2,
          unitPriceKgs: 100,
          lineTotalKgs: 200,
          unitCostKgs: 12,
          lineCostTotalKgs: 24,
        },
      },
    },
  });
  const originalLine = sale.lines.find((line) => line.productId === tea.id)!;
  const saleReturn = await db.saleReturn.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      registerId: register.id,
      shiftId: shift.id,
      originalSaleId: sale.id,
      number: "REPORT-RETURN-1",
      status: "COMPLETED",
      completedAt: new Date("2026-09-02T19:00:00Z"),
      createdById: adminUser.id,
      completedById: adminUser.id,
      subtotalKgs: 100,
      totalKgs: 100,
      lines: {
        create: {
          customerOrderLineId: originalLine.id,
          productId: tea.id,
          qty: 1,
          unitPriceKgs: 100,
          lineTotalKgs: 100,
          unitCostKgs: 10,
          lineCostTotalKgs: 10,
        },
      },
    },
  });
  await db.salePayment.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      shiftId: shift.id,
      customerOrderId: sale.id,
      saleReturnId: saleReturn.id,
      isRefund: true,
      method: "CASH",
      amountKgs: 100,
      createdAt: saleReturn.completedAt!,
    },
  });
  for (const [number, status, isHeld, completedAt] of [
    ["CANCELED", "CANCELED", false, "2026-09-02T03:00:00Z"],
    ["HELD", "COMPLETED", true, "2026-09-02T03:00:00Z"],
    ["BEFORE", "COMPLETED", false, "2026-09-01T17:59:59.999Z"],
    ["AFTER", "COMPLETED", false, "2026-09-03T18:00:00Z"],
  ] as const) {
    await db.customerOrder.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        number: `REPORT-${number}`,
        status,
        isHeld,
        isPosSale: true,
        completedAt: new Date(completedAt),
        subtotalKgs: 700,
        totalKgs: 700,
        lines: {
          create: {
            productId: tea.id,
            qty: 1,
            unitPriceKgs: 700,
            lineTotalKgs: 700,
            unitCostKgs: 10,
            lineCostTotalKgs: 10,
          },
        },
      },
    });
  }
  const otherOrg = await db.organization.create({
    data: { name: "REPORT QA · Другая организация", plan: "ENTERPRISE" },
  });
  const foreignStore = await db.store.create({
    data: { organizationId: otherOrg.id, name: "Чужой магазин", code: "PRIVATE" },
  });
  const foreignUnit = await db.unit.create({
    data: { organizationId: otherOrg.id, code: "each", labelRu: "шт", labelKg: "даана" },
  });
  const foreignProduct = await db.product.create({
    data: {
      organizationId: otherOrg.id,
      sku: randomUUID(),
      name: "PRIVATE PRODUCT",
      unit: "each",
      baseUnitId: foreignUnit.id,
    },
  });
  await db.customerOrder.create({
    data: {
      organizationId: otherOrg.id,
      storeId: foreignStore.id,
      number: "PRIVATE-SALE",
      status: "COMPLETED",
      completedAt: new Date("2026-09-02T00:00:00Z"),
      subtotalKgs: 999999,
      totalKgs: 999999,
      lines: {
        create: {
          productId: foreignProduct.id,
          qty: 1,
          unitPriceKgs: new Prisma.Decimal(999999),
          lineTotalKgs: 999999,
        },
      },
    },
  });
  return {
    ...base,
    tea,
    gift,
    unknown,
    otherStore,
    register,
    shift,
    sale,
    order,
    uncostedSale,
    saleReturn,
    foreignStore,
    input: {
      organizationId: org.id,
      storeIds: [store.id, otherStore.id],
      dateFrom: "2026-09-02",
      dateTo: "2026-09-03",
    },
    now: new Date("2026-09-04T00:00:00Z"),
  };
}
