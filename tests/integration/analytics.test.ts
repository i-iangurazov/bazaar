import { beforeEach, describe, expect, it } from "vitest";
import { CustomerOrderStatus, PosPaymentMethod, PosReturnStatus, Prisma } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { createTestCaller } from "../helpers/context";
import { withRecordedSalesProjection } from "../helpers/recordedSalesProjection";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("analytics", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns analytics series for admin and allows org scope", async () => {
    const { store, product, adminUser } = await seedBase({ plan: "BUSINESS" });

    await prisma.product.update({
      where: { id: product.id },
      data: { basePriceKgs: new Prisma.Decimal(100) },
    });

    await prisma.inventorySnapshot.create({
      data: {
        storeId: store.id,
        productId: product.id,
        variantKey: "BASE",
        onHand: 10,
        allowNegativeStock: false,
      },
    });

    await prisma.stockMovement.create({
      data: {
        storeId: store.id,
        productId: product.id,
        type: "SALE",
        qtyDelta: -2,
        createdById: adminUser.id,
      },
    });

    const adminCaller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: adminUser.organizationId!,
    });

    const { sales, top, orgSales } = await withRecordedSalesProjection([
      { organizationId: adminUser.organizationId!, storeId: store.id, productId: product.id,
        sku: product.sku, name: product.name, qty: 5, revenueKgs: 450.5, costKgs: 125 },
    ], async () => ({
      sales: await adminCaller.analytics.salesTrend({ storeId: store.id, rangeDays: 30, granularity: "day" }),
      top: await adminCaller.analytics.topProducts({ storeId: store.id, rangeDays: 30, metric: "units" }),
      orgSales: await adminCaller.analytics.salesTrend({ rangeDays: 30, granularity: "day" }),
    }));
    expect(sales.series.map((point) => point.salesKgs)).toEqual([450.5]);
    expect(sales.usesFallback).toBe(false);
    expect(top.items).toEqual([{ sku: product.sku, name: product.name, value: 5 }]);

    const value = await adminCaller.analytics.inventoryValue({ storeId: store.id });
    expect(value.valueKgs).toBeGreaterThan(0);

    expect(orgSales.series).toEqual(sales.series);
  });

  it("denies staff analytics and scopes manager charts to assigned stores", async () => {
    const { store, managerUser, staffUser } = await seedBase({ plan: "BUSINESS" });
    await prisma.userStoreAccess.createMany({
      data: [
        { organizationId: managerUser.organizationId!, userId: managerUser.id, storeId: store.id },
        { organizationId: staffUser.organizationId!, userId: staffUser.id, storeId: store.id },
      ],
      skipDuplicates: true,
    });
    const staffCaller = createTestCaller({
      id: staffUser.id,
      email: staffUser.email,
      role: staffUser.role,
      organizationId: staffUser.organizationId!,
    });
    const managerCaller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: managerUser.organizationId!,
    });

    await expect(
      staffCaller.analytics.salesTrend({
        rangeDays: 30,
        granularity: "day",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      staffCaller.analytics.salesTrend({
        storeId: store.id,
        rangeDays: 30,
        granularity: "day",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const scopedSales = await managerCaller.analytics.salesTrend({
      rangeDays: 30,
      granularity: "day",
    });
    expect(Array.isArray(scopedSales.series)).toBe(true);

    const storeSales = await managerCaller.analytics.salesTrend({
      storeId: store.id,
      rangeDays: 30,
      granularity: "day",
    });
    expect(Array.isArray(storeSales.series)).toBe(true);
  });

  it("aggregates completed POS sales by date/product and subtracts completed returns", async () => {
    const { org, store, product, adminUser, cashierUser } = await seedBase({ plan: "BUSINESS" });
    const completedAt = new Date("2026-06-20T06:00:00.000Z");
    const returnCompletedAt = new Date("2026-06-20T08:00:00.000Z");

    await prisma.product.update({
      where: { id: product.id },
      data: {
        basePriceKgs: new Prisma.Decimal(100),
        category: "Accessories",
        categories: ["Accessories"],
      },
    });
    await prisma.productBarcode.create({
      data: {
        organizationId: org.id,
        productId: product.id,
        value: "1234567890123",
      },
    });
    await prisma.inventorySnapshot.create({
      data: {
        storeId: store.id,
        productId: product.id,
        variantKey: "BASE",
        onHand: 7,
        allowNegativeStock: false,
      },
    });

    const register = await prisma.posRegister.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        name: "Front Desk",
        code: "FRONT",
      },
    });
    const shift = await prisma.registerShift.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        registerId: register.id,
        openedById: cashierUser.id,
        openedAt: new Date("2026-06-20T05:00:00.000Z"),
      },
    });

    const sale = await prisma.customerOrder.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        registerId: register.id,
        shiftId: shift.id,
        number: "POS-AN-1",
        status: CustomerOrderStatus.COMPLETED,
        isPosSale: true,
        isHeld: false,
        subtotalKgs: new Prisma.Decimal(300),
        discountKgs: new Prisma.Decimal(0),
        totalKgs: new Prisma.Decimal(300),
        completedAt,
        createdAt: completedAt,
        createdById: cashierUser.id,
        customerName: "Test Customer",
      },
    });
    const saleLine = await prisma.customerOrderLine.create({
      data: {
        customerOrderId: sale.id,
        productId: product.id,
        variantKey: "BASE",
        qty: 3,
        unitPriceKgs: new Prisma.Decimal(100),
        lineTotalKgs: new Prisma.Decimal(300),
      },
    });
    await prisma.salePayment.createMany({
      data: [
        {
          organizationId: org.id,
          storeId: store.id,
          shiftId: shift.id,
          customerOrderId: sale.id,
          method: PosPaymentMethod.CASH,
          amountKgs: new Prisma.Decimal(100),
          isRefund: false,
          createdById: cashierUser.id,
          createdAt: completedAt,
        },
        {
          organizationId: org.id,
          storeId: store.id,
          shiftId: shift.id,
          customerOrderId: sale.id,
          method: PosPaymentMethod.CARD,
          amountKgs: new Prisma.Decimal(200),
          isRefund: false,
          createdById: cashierUser.id,
          createdAt: completedAt,
        },
      ],
    });

    const saleReturn = await prisma.saleReturn.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        registerId: register.id,
        shiftId: shift.id,
        originalSaleId: sale.id,
        number: "RET-AN-1",
        status: PosReturnStatus.COMPLETED,
        subtotalKgs: new Prisma.Decimal(100),
        totalKgs: new Prisma.Decimal(100),
        completedAt: returnCompletedAt,
        createdAt: returnCompletedAt,
        createdById: cashierUser.id,
        completedById: cashierUser.id,
      },
    });
    await prisma.saleReturnLine.create({
      data: {
        saleReturnId: saleReturn.id,
        customerOrderLineId: saleLine.id,
        productId: product.id,
        variantKey: "BASE",
        qty: 1,
        unitPriceKgs: new Prisma.Decimal(100),
        lineTotalKgs: new Prisma.Decimal(100),
      },
    });
    await prisma.salePayment.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        shiftId: shift.id,
        customerOrderId: sale.id,
        saleReturnId: saleReturn.id,
        method: PosPaymentMethod.CASH,
        amountKgs: new Prisma.Decimal(100),
        isRefund: true,
        createdById: cashierUser.id,
        createdAt: returnCompletedAt,
      },
    });

    await prisma.customerOrder.createMany({
      data: [
        {
          organizationId: org.id,
          storeId: store.id,
          registerId: register.id,
          shiftId: shift.id,
          number: "POS-DRAFT",
          status: CustomerOrderStatus.DRAFT,
          isPosSale: true,
          isHeld: false,
          totalKgs: new Prisma.Decimal(999),
          createdAt: completedAt,
          createdById: cashierUser.id,
        },
        {
          organizationId: org.id,
          storeId: store.id,
          registerId: register.id,
          shiftId: shift.id,
          number: "POS-CANCELED",
          status: CustomerOrderStatus.CANCELED,
          isPosSale: true,
          isHeld: false,
          totalKgs: new Prisma.Decimal(999),
          completedAt,
          createdAt: completedAt,
          createdById: cashierUser.id,
        },
        {
          organizationId: org.id,
          storeId: store.id,
          registerId: register.id,
          shiftId: shift.id,
          number: "POS-HELD",
          status: CustomerOrderStatus.COMPLETED,
          isPosSale: true,
          isHeld: true,
          totalKgs: new Prisma.Decimal(999),
          completedAt,
          createdAt: completedAt,
          createdById: cashierUser.id,
        },
      ],
    });

    const otherRegister = await prisma.posRegister.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        name: "Back Desk",
        code: "BACK",
      },
    });
    const otherShift = await prisma.registerShift.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        registerId: otherRegister.id,
        openedById: cashierUser.id,
        openedAt: new Date("2026-06-20T05:30:00.000Z"),
      },
    });
    const otherSale = await prisma.customerOrder.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        registerId: otherRegister.id,
        shiftId: otherShift.id,
        number: "POS-AN-2",
        status: CustomerOrderStatus.COMPLETED,
        isPosSale: true,
        isHeld: false,
        subtotalKgs: new Prisma.Decimal(500),
        discountKgs: new Prisma.Decimal(0),
        totalKgs: new Prisma.Decimal(500),
        completedAt,
        createdAt: completedAt,
        createdById: cashierUser.id,
        customerName: "Other Register Customer",
      },
    });
    await prisma.customerOrderLine.create({
      data: {
        customerOrderId: otherSale.id,
        productId: product.id,
        variantKey: "BASE",
        qty: 5,
        unitPriceKgs: new Prisma.Decimal(100),
        lineTotalKgs: new Prisma.Decimal(500),
      },
    });
    await prisma.salePayment.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        shiftId: otherShift.id,
        customerOrderId: otherSale.id,
        method: PosPaymentMethod.CARD,
        amountKgs: new Prisma.Decimal(500),
        isRefund: false,
        createdById: cashierUser.id,
        createdAt: completedAt,
      },
    });

    const adminCaller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
    });

    const input = {
      storeId: store.id,
      registerId: register.id,
      cashierId: cashierUser.id,
      dateFrom: "2026-06-20",
      dateTo: "2026-06-20",
    };
    const overview = await adminCaller.analytics.salesOverview(input);
    expect(overview.series).toHaveLength(1);
    expect(overview.series[0]).toMatchObject({
      date: "2026-06-20",
      grossSalesKgs: 300,
      returnsKgs: 100,
      netSalesKgs: 200,
      receiptCount: 1,
      returnCount: 1,
    });
    expect(overview.totals.paymentBreakdown.CASH).toBe(100);
    expect(overview.totals.paymentBreakdown.CARD).toBe(200);
    expect(overview.totals.refundBreakdown.CASH).toBe(100);

    const allRegistersInput = {
      storeId: store.id,
      cashierId: cashierUser.id,
      dateFrom: "2026-06-20",
      dateTo: "2026-06-20",
    };
    const allRegistersOverview = await adminCaller.analytics.salesOverview(allRegistersInput);
    expect(allRegistersOverview.totals).toMatchObject({
      grossSalesKgs: 800,
      netSalesKgs: 700,
      receiptCount: 2,
      averageReceiptKgs: 400,
    });

    const options = await adminCaller.analytics.salesFilterOptions(input);
    expect(options.categories).toContain("Accessories");

    const soldProducts = await adminCaller.analytics.soldProducts({
      ...input,
      category: "Accessories",
      search: "123456",
      page: 1,
      pageSize: 25,
    });
    expect(soldProducts.total).toBe(1);
    expect(soldProducts.items[0]).toMatchObject({
      productId: product.id,
      productSku: product.sku,
      barcode: "1234567890123",
      category: "Accessories",
      quantitySold: 3,
      quantityReturned: 1,
      netQuantity: 2,
      grossRevenueKgs: 300,
      returnedRevenueKgs: 100,
      netRevenueKgs: 200,
      stockRemaining: 7,
      receiptCount: 1,
    });

    const allRegisterProducts = await adminCaller.analytics.soldProducts({
      ...allRegistersInput,
      search: "123456",
      page: 1,
      pageSize: 25,
    });
    expect(allRegisterProducts.items[0]).toMatchObject({
      productId: product.id,
      quantitySold: 8,
      quantityReturned: 1,
      netQuantity: 7,
      grossRevenueKgs: 800,
      returnedRevenueKgs: 100,
      netRevenueKgs: 700,
      receiptCount: 2,
    });

    const dayDetail = await adminCaller.analytics.salesDayDetail({
      storeId: store.id,
      registerId: register.id,
      cashierId: cashierUser.id,
      date: "2026-06-20",
    });
    expect(dayDetail.summary?.netSalesKgs).toBe(200);
    expect(dayDetail.products).toHaveLength(1);
    expect(dayDetail.receipts).toHaveLength(1);
    expect(dayDetail.receipts[0]?.number).toBe("POS-AN-1");

    const productReceipts = await adminCaller.analytics.productReceipts({
      ...input,
      productId: product.id,
      variantKey: "BASE",
      page: 1,
      pageSize: 25,
    });
    expect(productReceipts.items).toHaveLength(1);
    expect(productReceipts.items[0]?.paymentBreakdown.CASH).toBe(100);
    expect(productReceipts.items[0]?.paymentBreakdown.CARD).toBe(200);

    const preview = await adminCaller.pos.sales.get({ saleId: sale.id });
    expect(preview?.lines).toHaveLength(1);
    expect(preview?.lines[0]?.product.primaryBarcode).toBe("1234567890123");
  });

  it("excludes correction returns and non-actual settlement rows from POS analytics", async () => {
    const { org, store, adminUser } = await seedBase({ plan: "BUSINESS" });
    const call = { id: adminUser.id, email: adminUser.email, role: adminUser.role, organizationId: org.id };
    const adminCaller = createTestCaller(call);
    const completedAt = new Date("2026-07-01T10:00:00Z");
    const register = await prisma.posRegister.create({
      data: { organizationId: org.id, storeId: store.id, name: "Analytics register", code: "AN-REG" },
    });
    const shift = await prisma.registerShift.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        registerId: register.id,
        openedById: adminUser.id,
      },
    });
    const posSale = await prisma.customerOrder.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        registerId: register.id,
        shiftId: shift.id,
        number: "POS-AN-SETTLE",
        status: "COMPLETED",
        isPosSale: true,
        completedAt,
        createdAt: completedAt,
        createdById: adminUser.id,
        subtotalKgs: 100,
        totalKgs: 100,
      },
    });
    await prisma.salePayment.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        shiftId: shift.id,
        customerOrderId: posSale.id,
        method: PosPaymentMethod.CASH,
        amountKgs: 100,
        isRefund: false,
        settlementStatus: "ACTUAL",
        createdAt: completedAt,
      },
    });

    // Historical behaviour: a POS-processed return stays in POS analytics even
    // when its original order was online. Only R7 correction returns are new
    // documents that must not move POS analytics.
    const onlineOrder = await prisma.customerOrder.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        number: "ONLINE-RETURNED",
        status: "COMPLETED",
        isPosSale: false,
        completedAt,
        createdAt: completedAt,
        createdById: adminUser.id,
        subtotalKgs: 100,
        totalKgs: 100,
      },
    });
    const posReturn = await prisma.saleReturn.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        registerId: register.id,
        shiftId: shift.id,
        originalSaleId: onlineOrder.id,
        number: "POS-RETURN-LEGACY",
        status: "COMPLETED",
        completedAt,
        createdAt: completedAt,
        createdById: adminUser.id,
        completedById: adminUser.id,
        subtotalKgs: 20,
        totalKgs: 20,
      },
    });
    await prisma.salePayment.createMany({
      data: [
        {
          organizationId: org.id,
          storeId: store.id,
          shiftId: shift.id,
          customerOrderId: onlineOrder.id,
          saleReturnId: posReturn.id,
          method: PosPaymentMethod.CASH,
          amountKgs: 20,
          isRefund: true,
          settlementStatus: "ACTUAL",
          createdAt: completedAt,
        },
        {
          organizationId: org.id,
          storeId: store.id,
          shiftId: shift.id,
          customerOrderId: onlineOrder.id,
          saleReturnId: posReturn.id,
          method: PosPaymentMethod.TRANSFER,
          amountKgs: 5,
          isRefund: true,
          settlementStatus: "PENDING",
          createdAt: completedAt,
        },
      ],
    });

    const correctedOrder = await prisma.customerOrder.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        number: "ONLINE-CORRECTED",
        status: "COMPLETED",
        isPosSale: false,
        completedAt,
        createdAt: completedAt,
        createdById: adminUser.id,
        subtotalKgs: 100,
        totalKgs: 100,
      },
    });
    const correctionReturn = await prisma.saleReturn.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        registerId: register.id,
        shiftId: shift.id,
        originalSaleId: correctedOrder.id,
        number: "CORRECTION-RETURN-1",
        status: "COMPLETED",
        completedAt,
        createdAt: completedAt,
        createdById: adminUser.id,
        completedById: adminUser.id,
        subtotalKgs: 40,
        totalKgs: 40,
      },
    });
    await prisma.salesOrderCorrection.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        number: "CR-AN-1",
        originalOrderId: correctedOrder.id,
        saleReturnId: correctionReturn.id,
        reason: "Analytics settlement test",
        createdById: adminUser.id,
      },
    });
    await prisma.salePayment.createMany({
      data: [
        {
          organizationId: org.id,
          storeId: store.id,
          shiftId: shift.id,
          customerOrderId: correctedOrder.id,
          saleReturnId: correctionReturn.id,
          method: PosPaymentMethod.TRANSFER,
          amountKgs: 25,
          isRefund: true,
          settlementStatus: "PENDING",
          createdAt: completedAt,
        },
        {
          organizationId: org.id,
          storeId: store.id,
          shiftId: shift.id,
          customerOrderId: correctedOrder.id,
          saleReturnId: correctionReturn.id,
          method: PosPaymentMethod.CASH,
          amountKgs: 15,
          isRefund: true,
          settlementStatus: "OFFSET",
          createdAt: completedAt,
        },
      ],
    });

    const overview = await adminCaller.analytics.salesOverview({
      storeId: store.id,
      dateFrom: "2026-07-01",
      dateTo: "2026-07-01",
    });
    expect(overview.series[0]).toMatchObject({
      date: "2026-07-01",
      grossSalesKgs: 100,
      returnsKgs: 20,
      netSalesKgs: 80,
      receiptCount: 1,
      returnCount: 1,
    });
    expect(overview.totals.paymentBreakdown.CASH).toBe(100);
    expect(overview.totals.refundBreakdown.CASH).toBe(20);
    expect(overview.totals.refundBreakdown.TRANSFER).toBe(0);
  });
});
