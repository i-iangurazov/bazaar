import { mkdir, writeFile } from "node:fs/promises";
import { reportingEnvironment, assertReportingDatabase } from "./environment";
Object.assign(process.env, reportingEnvironment());
assertReportingDatabase();
const { prisma } = await import("../../src/server/db/prisma");
try {
  if (await prisma.organization.count())
    throw new Error("Reporting seed requires an empty dedicated DB; never resets existing data");
  const { seedReportingFixture } = await import("../../tests/helpers/reportingFixture");
  const { default: bcrypt } = await import("bcryptjs");
  const f = await seedReportingFixture(prisma);
  await prisma.user.updateMany({
    where: { organizationId: f.org.id },
    data: {
      passwordHash: await bcrypt.hash("BazaarReportTest123!", 10),
      emailVerifiedAt: new Date(),
    },
  });
  await prisma.storeProduct.createMany({
    data: [f.tea, f.gift, f.unknown].flatMap((product) =>
      [f.store, f.otherStore].map((store) => ({
        organizationId: f.org.id,
        storeId: store.id,
        productId: product.id,
      })),
    ),
  });
  await prisma.inventorySnapshot.createMany({
    data: [
      { storeId: f.store.id, productId: f.tea.id, onHand: 20 },
      { storeId: f.otherStore.id, productId: f.tea.id, onHand: 3 },
      { storeId: f.store.id, productId: f.gift.id, onHand: -2, allowNegativeStock: true },
      { storeId: f.otherStore.id, productId: f.unknown.id, onHand: 10 },
    ],
  });
  for (let i = 1; i <= 32; i++) {
    const product = await prisma.product.create({
      data: {
        organizationId: f.org.id,
        name: `Учебный товар ${i} · длинное название для проверки таблицы`,
        sku: `REPORT-${i}`,
        unit: f.baseUnit.code,
        baseUnitId: f.baseUnit.id,
        category: i % 2 ? "Для дома" : "Продукты",
        basePriceKgs: 10,
      },
    });
    await prisma.productCost.create({
      data: { organizationId: f.org.id, productId: product.id, avgCostKgs: 7, costBasisQty: 100 },
    });
    await prisma.inventorySnapshot.create({
      data: { storeId: f.store.id, productId: product.id, onHand: i },
    });
    await prisma.customerOrder.create({
      data: {
        organizationId: f.org.id,
        storeId: f.store.id,
        number: `REPORT-QA-${i}`,
        status: "COMPLETED",
        isPosSale: true,
        registerId: f.register.id,
        shiftId: f.shift.id,
        completedAt: new Date("2026-09-02T08:00:00Z"),
        createdById: f.adminUser.id,
        subtotalKgs: 10,
        totalKgs: 10,
        lines: {
          create: {
            productId: product.id,
            qty: 1,
            unitPriceKgs: 10,
            lineTotalKgs: 10,
            unitCostKgs: 4,
            lineCostTotalKgs: 4,
          },
        },
      },
    });
  }
  const po = await prisma.purchaseOrder.create({
    data: {
      organizationId: f.org.id,
      storeId: f.store.id,
      supplierId: f.supplier.id,
      status: "PARTIALLY_RECEIVED",
      lines: { create: { productId: f.tea.id, qtyOrdered: 50, qtyReceived: 20, unitCost: 9 } },
    },
  });
  await prisma.stockMovement.createMany({
    data: [
      {
        storeId: f.store.id,
        productId: f.tea.id,
        type: "RECEIVE",
        qtyDelta: 20,
        unitCostKgs: 9,
        lineTotalKgs: 180,
        referenceType: "PURCHASE_ORDER",
        referenceId: po.id,
        createdAt: f.sale.completedAt!,
      },
      {
        storeId: f.otherStore.id,
        productId: f.unknown.id,
        type: "RECEIVE",
        qtyDelta: 10,
        referenceType: "STOCK_RECEIVING",
        createdAt: f.sale.completedAt!,
      },
    ],
  });
  await prisma.cashDrawerMovement.create({
    data: {
      organizationId: f.org.id,
      storeId: f.store.id,
      shiftId: f.shift.id,
      type: "PAY_OUT",
      amountKgs: 50,
      reason: "Учебное изъятие · без внешних операций",
      createdAt: f.sale.completedAt!,
    },
  });
  await mkdir("artifacts/reporting", { recursive: true });
  await writeFile(
    "artifacts/reporting/fixture.json",
    JSON.stringify(
      {
        organizationId: f.org.id,
        storeId: f.store.id,
        otherStoreId: f.otherStore.id,
        foreignStoreId: f.foreignStore.id,
        teaId: f.tea.id,
        saleId: f.sale.id,
        purchaseOrderId: po.id,
        ...f.input,
        expected: {
          netSalesKgs: 860,
          grossSalesKgs: 960,
          returnsKgs: 100,
          knownCostKgs: 172,
          knownProfitKgs: 608,
          unknownCostLines: 1,
          products: 35,
        },
      },
      null,
      2,
    ),
  );
  console.log("Seeded isolated reporting browser fixture");
} finally {
  await prisma.$disconnect();
}
