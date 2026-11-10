import { Prisma, StockMovementType } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { applyStockMovement, postStockReceiving, transferStock } from "@/server/services/inventory";
import { readStoreStockValuation } from "@/server/services/storeStockValuation";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;
type Fixture = Awaited<ReturnType<typeof seedBase>>;
async function receive(
  f: Fixture,
  quantity: number,
  unitCost: number,
  key: string,
  storeId = f.store.id,
  date = new Date("2026-01-01T00:00:01Z"),
) {
  return postStockReceiving({
    storeId,
    date,
    lines: [{ productId: f.product.id, quantity, unitCost }],
    actorId: f.adminUser.id,
    organizationId: f.org.id,
    requestId: key,
    idempotencyKey: key,
  });
}
async function move(
  f: Fixture,
  type: StockMovementType,
  qtyDelta: number,
  options: { referenceType?: string; referenceId?: string; date?: Date } = {},
) {
  return prisma.$transaction((tx) =>
    applyStockMovement(tx, {
      storeId: f.store.id,
      productId: f.product.id,
      type,
      qtyDelta,
      organizationId: f.org.id,
      actorId: f.adminUser.id,
      allowNegativeStock: true,
      referenceType: options.referenceType,
      referenceId: options.referenceId,
      movementDate: options.date ?? new Date("2026-01-01T00:00:02Z"),
    }),
  );
}
async function preview(f: Fixture, quantity = 10, unitCost = 200) {
  return prisma.$transaction(
    (tx) =>
      readStoreStockValuation(tx, {
        organizationId: f.org.id,
        storeId: f.store.id,
        lines: [{ productId: f.product.id, quantity, unitCost }],
      }),
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

describeDb("read-only receiving stock valuation with real stock journals", () => {
  beforeEach(resetDatabase);
  it("preserves a sub-cent fractional stock value while stored movement totals round to zero", async () => {
    const f = await seedBase();
    await prisma.unit.update({ where: { id: f.baseUnit.id }, data: { quantityPrecision: 3 } });
    await receive(f, 0.001, 0.01, "valuation-fraction-old");
    const reviewed = await preview(f, 0.001, 0.01);
    expect(reviewed.lines[0].current).toMatchObject({
      quantity: 0.001,
      unitCostKgs: 0.01,
      status: "KNOWN",
    });
    expect(reviewed.lines[0].projected).toMatchObject({
      quantity: 0.002,
      unitCostKgs: 0.01,
      status: "KNOWN",
    });
    await receive(
      f,
      0.001,
      0.01,
      "valuation-fraction-new",
      f.store.id,
      new Date("2026-01-01T00:00:03Z"),
    );
    expect((await preview(f, 0.001, 0.01)).lines[0].current).toEqual(reviewed.lines[0].projected);
    const movements = await prisma.stockMovement.findMany({ where: { productId: f.product.id } });
    expect(movements.every((movement) => Number(movement.lineTotalKgs) === 0)).toBe(true);
    expect(
      Number(
        (await prisma.productCost.findFirstOrThrow({ where: { productId: f.product.id } }))
          .avgCostKgs,
      ),
    ).toBe(0.01);
  });
  it("matches the posted replay for a backdated receipt without changing a later sale's historical cost", async () => {
    const f = await seedBase();
    await receive(f, 10, 100, "valuation-backdated-original");
    const sale = await prisma.customerOrder.create({
      data: {
        organizationId: f.org.id,
        storeId: f.store.id,
        number: "VAL-BACKDATED-SALE",
        status: "COMPLETED",
      },
    });
    const saleLine = await prisma.customerOrderLine.create({
      data: {
        customerOrderId: sale.id,
        productId: f.product.id,
        qty: 5,
        unitPriceKgs: 250,
        lineTotalKgs: 1250,
        unitCostKgs: 100,
        lineCostTotalKgs: 500,
      },
    });
    await move(f, StockMovementType.SALE, -5, {
      referenceType: "CustomerOrder",
      referenceId: sale.id,
      date: new Date("2026-01-01T00:00:03Z"),
    });
    const movementDate = new Date("2026-01-01T00:00:02Z");
    const reviewed = await prisma.$transaction(
      (tx) =>
        readStoreStockValuation(tx, {
          organizationId: f.org.id,
          storeId: f.store.id,
          movementDate,
          lines: [{ productId: f.product.id, quantity: 10, unitCost: 200 }],
        }),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    expect(reviewed.lines[0].current).toMatchObject({
      quantity: 5,
      unitCostKgs: 100,
      status: "KNOWN",
    });
    expect(reviewed.lines[0].projected).toMatchObject({
      quantity: 15,
      unitCostKgs: 150,
      status: "KNOWN",
    });
    await receive(f, 10, 200, "valuation-backdated-incoming", f.store.id, movementDate);
    expect((await preview(f)).lines[0].current).toEqual(reviewed.lines[0].projected);
    expect(await prisma.customerOrderLine.findUnique({ where: { id: saleLine.id } })).toEqual(
      saleLine,
    );
  });
  it("previews the remaining batch, matches the posted read-model, and preserves the separate global cost policy", async () => {
    const f = await seedBase();
    await receive(f, 100, 100, "valuation-old-receipt");
    await move(f, StockMovementType.SALE, -90, {
      referenceType: "CustomerOrder",
      referenceId: "valuation-sale",
    });
    const beforeCounts = await Promise.all([
      prisma.stockMovement.count(),
      prisma.auditLog.count(),
      prisma.productCost.findMany(),
    ]);
    const reviewed = await preview(f);
    expect(reviewed.lines[0]).toMatchObject({
      current: { quantity: 10, unitCostKgs: 100, status: "KNOWN" },
      projected: { quantity: 20, unitCostKgs: 150, status: "KNOWN" },
    });
    expect(
      await Promise.all([
        prisma.stockMovement.count(),
        prisma.auditLog.count(),
        prisma.productCost.findMany(),
      ]),
    ).toEqual(beforeCounts);
    await receive(
      f,
      10,
      200,
      "valuation-new-receipt",
      f.store.id,
      new Date("2026-01-01T00:00:03Z"),
    );
    const posted = await preview(f);
    expect(posted.lines[0].current).toEqual(reviewed.lines[0].projected);
    const global = await prisma.productCost.findUniqueOrThrow({
      where: {
        organizationId_productId_variantKey: {
          organizationId: f.org.id,
          productId: f.product.id,
          variantKey: "BASE",
        },
      },
    });
    expect(Number(global.avgCostKgs)).toBe(109.09);
    expect(global.costBasisQty).toBe(110);
  });
  it("traces an actual transfer pair from the source-store value rather than its recorded global cost", async () => {
    const f = await seedBase();
    const source = await prisma.store.create({
      data: { organizationId: f.org.id, name: "Source", code: "VAL-SRC" },
    });
    await prisma.storeProduct.create({
      data: { organizationId: f.org.id, storeId: source.id, productId: f.product.id },
    });
    await receive(f, 10, 100, "valuation-source-receipt", source.id);
    await receive(
      f,
      10,
      200,
      "valuation-target-receipt",
      f.store.id,
      new Date("2026-01-01T00:00:02Z"),
    );
    const transferred = await transferStock({
      fromStoreId: source.id,
      toStoreId: f.store.id,
      lines: [{ productId: f.product.id, qty: 10 }],
      organizationId: f.org.id,
      actorId: f.adminUser.id,
      requestId: "valuation-transfer",
      idempotencyKey: "valuation-transfer",
    });
    const out = await prisma.stockMovement.findFirstOrThrow({
      where: {
        referenceType: "TRANSFER",
        referenceId: transferred.transferId,
        type: "TRANSFER_OUT",
      },
    });
    expect(Number(out.unitCostKgs)).toBe(150);
    const result = await preview(f);
    expect(result.lines[0].current).toMatchObject({
      quantity: 20,
      unitCostKgs: 150,
      status: "KNOWN",
    });
    expect(result.lines[0]).not.toHaveProperty("sourceMovements");
    expect(JSON.stringify(result)).not.toContain(source.id);
  });
  it("resolves SaleReturn provenance without rewriting historical sale and return snapshots", async () => {
    const f = await seedBase();
    const register = await prisma.posRegister.create({
      data: { organizationId: f.org.id, storeId: f.store.id, name: "Valuation", code: "VAL" },
    });
    const shift = await prisma.registerShift.create({
      data: {
        organizationId: f.org.id,
        storeId: f.store.id,
        registerId: register.id,
        openedById: f.adminUser.id,
      },
    });
    const sale = await prisma.customerOrder.create({
      data: {
        organizationId: f.org.id,
        storeId: f.store.id,
        number: "VAL-SALE",
        status: "COMPLETED",
      },
    });
    const saleLine = await prisma.customerOrderLine.create({
      data: {
        customerOrderId: sale.id,
        productId: f.product.id,
        qty: 5,
        unitPriceKgs: 250,
        lineTotalKgs: 1250,
        unitCostKgs: 999,
        lineCostTotalKgs: 4995,
      },
    });
    const returned = await prisma.saleReturn.create({
      data: {
        organizationId: f.org.id,
        storeId: f.store.id,
        registerId: register.id,
        shiftId: shift.id,
        originalSaleId: sale.id,
        number: "VAL-RETURN",
        createdById: f.adminUser.id,
        status: "COMPLETED",
      },
    });
    const returnLine = await prisma.saleReturnLine.create({
      data: {
        saleReturnId: returned.id,
        customerOrderLineId: saleLine.id,
        productId: f.product.id,
        qty: 5,
        unitPriceKgs: 250,
        lineTotalKgs: 1250,
        unitCostKgs: 999,
        lineCostTotalKgs: 4995,
      },
    });
    await receive(f, 10, 100, "valuation-return-old");
    await move(f, StockMovementType.SALE, -5, {
      referenceType: "CustomerOrder",
      referenceId: sale.id,
    });
    await receive(f, 10, 200, "valuation-return-new", f.store.id, new Date("2026-01-01T00:00:03Z"));
    await move(f, StockMovementType.RETURN, 5, {
      referenceType: "SaleReturn",
      referenceId: returned.id,
      date: new Date("2026-01-01T00:00:04Z"),
    });
    const result = await preview(f);
    expect(result.lines[0].current).toMatchObject({
      quantity: 20,
      unitCostKgs: 150,
      status: "KNOWN",
    });
    expect(await prisma.customerOrderLine.findUnique({ where: { id: saleLine.id } })).toEqual(
      saleLine,
    );
    expect(await prisma.saleReturnLine.findUnique({ where: { id: returnLine.id } })).toEqual(
      returnLine,
    );
  });
  it("reports unvalued opening stock even when a global manually configured cost exists", async () => {
    const f = await seedBase();
    await prisma.productCost.create({
      data: { organizationId: f.org.id, productId: f.product.id, avgCostKgs: 123, costBasisQty: 1 },
    });
    await move(f, StockMovementType.ADJUSTMENT, 5, {
      referenceType: "INITIAL_STOCK",
      referenceId: "initial",
    });
    const result = await preview(f);
    expect(result.lines[0].current).toMatchObject({
      quantity: 5,
      unitCostKgs: null,
      status: "UNKNOWN",
      reason: "UNVALUED_STOCK",
    });
    expect(result.lines[0].projected).toMatchObject({
      quantity: 15,
      unitCostKgs: null,
      status: "UNKNOWN",
    });
  });
  it("changes the review fingerprint after a real stock movement but is stable during repeated reads", async () => {
    const f = await seedBase();
    await receive(f, 10, 100, "valuation-fingerprint");
    const before = await preview(f);
    expect((await preview(f)).fingerprint).toBe(before.fingerprint);
    await move(f, StockMovementType.SALE, -1, {
      referenceType: "CustomerOrder",
      referenceId: "fingerprint-sale",
    });
    const after = await preview(f);
    expect(after.fingerprint).not.toBe(before.fingerprint);
    expect(after.lines[0].current.quantity).toBe(9);
  });
  it("never reads a foreign product or store as a local valuation", async () => {
    const f = await seedBase();
    const foreignOrg = await prisma.organization.create({
      data: { name: "Foreign valuation org" },
    });
    const foreignStore = await prisma.store.create({
      data: { organizationId: foreignOrg.id, name: "Foreign", code: "FOREIGN" },
    });
    const foreignUnit = await prisma.unit.create({
      data: { organizationId: foreignOrg.id, code: "each", labelRu: "each", labelKg: "each" },
    });
    const foreignProduct = await prisma.product.create({
      data: {
        organizationId: foreignOrg.id,
        sku: "FOREIGN",
        name: "Foreign",
        unit: "each",
        baseUnitId: foreignUnit.id,
      },
    });
    await expect(
      prisma.$transaction((tx) =>
        readStoreStockValuation(tx, {
          organizationId: f.org.id,
          storeId: foreignStore.id,
          lines: [{ productId: f.product.id, quantity: 1, unitCost: 1 }],
        }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      prisma.$transaction((tx) =>
        readStoreStockValuation(tx, {
          organizationId: f.org.id,
          storeId: f.store.id,
          lines: [{ productId: foreignProduct.id, quantity: 1, unitCost: 1 }],
        }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
