import { PosPaymentMethod, Prisma, StockMovementType } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";

import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

const readBaseCost = (organizationId: string, productId: string) =>
  prisma.productCost.findUniqueOrThrow({
    where: {
      organizationId_productId_variantKey: {
        organizationId,
        productId,
        variantKey: "BASE",
      },
    },
  });

describeDb("product cost across POS sales and returns", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("removes frozen COGS on sale and restores that original value on return", async () => {
    const { org, store, product, adminUser, managerUser, cashierUser } = await seedBase({
      plan: "BUSINESS",
    });

    await Promise.all([
      prisma.product.update({
        where: { id: product.id },
        data: { basePriceKgs: 250 },
      }),
      prisma.inventorySnapshot.create({
        data: {
          storeId: store.id,
          productId: product.id,
          variantKey: "BASE",
          onHand: 8,
        },
      }),
      prisma.productCost.create({
        data: {
          organizationId: org.id,
          productId: product.id,
          variantKey: "BASE",
          avgCostKgs: new Prisma.Decimal(95),
          costBasisQty: 8,
          costBasisValueKgs: new Prisma.Decimal(760),
        },
      }),
    ]);

    const register = await prisma.posRegister.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        name: "Cost lifecycle register",
        code: "COST-LIFECYCLE",
      },
    });
    const cashierCaller = createTestCaller({
      id: cashierUser.id,
      email: cashierUser.email,
      role: cashierUser.role,
      organizationId: org.id,
      isOrgOwner: false,
    });
    const managerCaller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
      isOrgOwner: false,
    });
    const adminCaller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
    });

    const shift = await cashierCaller.pos.shifts.open({
      registerId: register.id,
      openingCashKgs: 0,
      idempotencyKey: "cost-lifecycle-open-shift",
    });
    const sale = await cashierCaller.pos.sales.createDraft({ registerId: register.id });
    const saleLine = await cashierCaller.pos.sales.addLine({
      saleId: sale.id,
      productId: product.id,
      qty: 3,
    });
    await cashierCaller.pos.sales.complete({
      saleId: sale.id,
      idempotencyKey: "cost-lifecycle-complete-sale",
      payments: [{ method: PosPaymentMethod.CASH, amountKgs: 750 }],
    });

    const [costAfterSale, frozenSaleLine, saleMovement] = await Promise.all([
      readBaseCost(org.id, product.id),
      prisma.customerOrderLine.findUniqueOrThrow({ where: { id: saleLine.id } }),
      prisma.stockMovement.findFirstOrThrow({
        where: {
          storeId: store.id,
          productId: product.id,
          type: StockMovementType.SALE,
          referenceId: sale.id,
        },
      }),
    ]);

    expect(costAfterSale.costBasisQty).toBe(5);
    expect(Number(costAfterSale.costBasisValueKgs)).toBe(475);
    expect(Number(costAfterSale.avgCostKgs)).toBe(95);
    expect(Number(frozenSaleLine.unitCostKgs)).toBe(95);
    expect(Number(frozenSaleLine.lineCostTotalKgs)).toBe(285);
    expect(saleMovement.qtyDelta).toBe(-3);
    expect(Number(saleMovement.unitCostKgs)).toBe(95);
    expect(Number(saleMovement.inventoryValueDeltaKgs)).toBe(-285);
    expect(Number(saleMovement.inventoryValueDeltaKgs)).not.toBe(-750);

    await adminCaller.pos.sales.editCompleted({
      saleId: sale.id,
      reason: "correct sold quantity",
      discountKgs: 0,
      lines: [
        {
          lineId: saleLine.id,
          productId: product.id,
          qty: 2,
          unitPriceKgs: 250,
        },
      ],
      idempotencyKey: "cost-lifecycle-edit-sale",
    });

    const [costAfterSaleEdit, editedSaleLine, saleEditMovement] = await Promise.all([
      readBaseCost(org.id, product.id),
      prisma.customerOrderLine.findUniqueOrThrow({ where: { id: saleLine.id } }),
      prisma.stockMovement.findFirstOrThrow({
        where: {
          storeId: store.id,
          productId: product.id,
          type: StockMovementType.SALE,
          referenceId: sale.id,
          qtyDelta: 1,
        },
      }),
    ]);

    expect(costAfterSaleEdit.costBasisQty).toBe(6);
    expect(Number(costAfterSaleEdit.costBasisValueKgs)).toBe(570);
    expect(Number(editedSaleLine.unitCostKgs)).toBe(95);
    expect(Number(editedSaleLine.lineCostTotalKgs)).toBe(190);
    expect(Number(saleEditMovement.inventoryValueDeltaKgs)).toBe(95);

    await adminCaller.inventory.postStockReceiving({
      storeId: store.id,
      referenceNumber: "COST-LIFECYCLE-RECEIPT",
      lines: [{ productId: product.id, quantity: 5, unitCost: 115 }],
      idempotencyKey: "cost-lifecycle-intervening-receipt",
    });
    const costBeforeReturn = await readBaseCost(org.id, product.id);
    expect(costBeforeReturn.costBasisQty).toBe(11);
    expect(Number(costBeforeReturn.costBasisValueKgs)).toBe(1145);
    expect(Number(costBeforeReturn.avgCostKgs)).toBe(104.09);

    const saleReturn = await cashierCaller.pos.returns.createDraft({
      shiftId: shift.id,
      originalSaleId: sale.id,
    });
    const returnLineDraft = await cashierCaller.pos.returns.addLine({
      saleReturnId: saleReturn.id,
      customerOrderLineId: saleLine.id,
      qty: 2,
    });
    await managerCaller.pos.returns.complete({
      saleReturnId: saleReturn.id,
      idempotencyKey: "cost-lifecycle-complete-return",
      payments: [{ method: PosPaymentMethod.CASH, amountKgs: 500 }],
    });

    const [costAfterReturn, returnLine, returnMovement, snapshot] = await Promise.all([
      readBaseCost(org.id, product.id),
      prisma.saleReturnLine.findFirstOrThrow({ where: { saleReturnId: saleReturn.id } }),
      prisma.stockMovement.findFirstOrThrow({
        where: {
          storeId: store.id,
          productId: product.id,
          type: StockMovementType.RETURN,
          referenceId: saleReturn.id,
        },
      }),
      prisma.inventorySnapshot.findUniqueOrThrow({
        where: {
          storeId_productId_variantKey: {
            storeId: store.id,
            productId: product.id,
            variantKey: "BASE",
          },
        },
      }),
    ]);

    expect(Number(returnLine.unitCostKgs)).toBe(95);
    expect(Number(returnLine.lineCostTotalKgs)).toBe(190);
    expect(returnMovement.qtyDelta).toBe(2);
    expect(Number(returnMovement.unitCostKgs)).toBe(95);
    expect(Number(returnMovement.inventoryValueDeltaKgs)).toBe(190);
    expect(Number(returnMovement.inventoryValueDeltaKgs)).not.toBe(500);
    expect(costAfterReturn.costBasisQty).toBe(13);
    expect(Number(costAfterReturn.costBasisValueKgs)).toBe(1335);
    expect(Number(costAfterReturn.avgCostKgs)).toBe(102.69);
    expect(snapshot.onHand).toBe(13);

    await managerCaller.pos.returns.editCompleted({
      saleReturnId: saleReturn.id,
      reason: "correct returned quantity",
      lines: [
        {
          lineId: returnLineDraft.id,
          customerOrderLineId: saleLine.id,
          productId: product.id,
          qty: 1,
          unitPriceKgs: 250,
        },
      ],
      idempotencyKey: "cost-lifecycle-edit-return",
    });

    const [costAfterReturnEdit, editedReturnLine, returnEditMovement, editedSnapshot] =
      await Promise.all([
        readBaseCost(org.id, product.id),
        prisma.saleReturnLine.findUniqueOrThrow({ where: { id: returnLineDraft.id } }),
        prisma.stockMovement.findFirstOrThrow({
          where: {
            storeId: store.id,
            productId: product.id,
            type: StockMovementType.RETURN,
            referenceId: saleReturn.id,
            qtyDelta: -1,
          },
        }),
        prisma.inventorySnapshot.findUniqueOrThrow({
          where: {
            storeId_productId_variantKey: {
              storeId: store.id,
              productId: product.id,
              variantKey: "BASE",
            },
          },
        }),
      ]);

    expect(costAfterReturnEdit.costBasisQty).toBe(12);
    expect(Number(costAfterReturnEdit.costBasisValueKgs)).toBe(1240);
    expect(Number(costAfterReturnEdit.avgCostKgs)).toBe(103.33);
    expect(Number(editedReturnLine.unitCostKgs)).toBe(95);
    expect(Number(editedReturnLine.lineCostTotalKgs)).toBe(95);
    expect(Number(returnEditMovement.inventoryValueDeltaKgs)).toBe(-95);
    expect(editedSnapshot.onHand).toBe(12);
  });
});
