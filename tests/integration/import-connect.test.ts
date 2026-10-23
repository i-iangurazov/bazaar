import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("connecting existing products during import", () => {
  beforeEach(resetDatabase);

  async function fixture() {
    const f = await seedBase({ plan: "BUSINESS" });
    await prisma.organization.update({
      where: { id: f.org.id },
      data: { retailWholesaleEnabled: true },
    });
    const catalog = await prisma.productCatalog.create({
      data: { organizationId: f.org.id, name: "Target catalog" },
    });
    const target = await prisma.store.create({
      data: {
        organizationId: f.org.id,
        name: "Дордой-2",
        code: "DRD",
        productCatalogId: catalog.id,
      },
    });
    const peer = await prisma.store.create({
      data: {
        organizationId: f.org.id,
        name: "Catalog peer",
        code: "PEER",
        productCatalogId: catalog.id,
      },
    });
    const product = await prisma.product.update({
      where: { id: f.product.id },
      data: {
        name: "Original product",
        sku: "SKU-008513",
        basePriceKgs: 100,
        description: "Original description",
        category: "Original category",
        categories: ["Original category"],
        photoUrl: "https://example.invalid/original.jpg",
      },
    });
    const barcode = "6952348364235";
    await prisma.productBarcode.create({
      data: { organizationId: f.org.id, productId: product.id, value: barcode },
    });
    await prisma.productCost.create({
      data: {
        organizationId: f.org.id,
        productId: product.id,
        variantKey: "BASE",
        avgCostKgs: 70,
        costBasisQty: 10,
      },
    });
    await prisma.inventorySnapshot.createMany({
      data: [
        { storeId: f.store.id, productId: product.id, variantKey: "BASE", onHand: 10 },
        { storeId: target.id, productId: product.id, variantKey: "BASE", onHand: 2 },
      ],
    });
    await prisma.storePrice.create({
      data: {
        organizationId: f.org.id,
        storeId: f.store.id,
        productId: product.id,
        variantKey: "BASE",
        priceKgs: 180,
      },
    });
    await prisma.storePriceTypes.create({
      data: {
        organizationId: f.org.id,
        storeId: target.id,
        productId: product.id,
        variantKey: "BASE",
        retailPriceKgs: 150,
        wholesalePriceKgs: 120,
      },
    });
    const caller = createTestCaller({ ...f.adminUser, organizationId: f.org.id });
    const row = {
      sourceRowNumber: 1,
      sku: product.sku,
      name: "Replacement name",
      unit: "DO-NOT-CREATE",
      description: "Replacement description",
      category: "DO-NOT-CREATE",
      basePriceKgs: 225,
      purchasePriceKgs: 1,
      avgCostKgs: 1,
      minStock: 7,
      stockQty: 5,
      barcodes: [barcode],
      photoUrl: "https://example.invalid/never-download.jpg",
    };
    const decision = {
      sourceRowNumber: 1,
      action: "connect" as const,
      existingProductId: product.id,
    };
    const input = {
      storeId: target.id,
      rows: [row],
      rowActions: [decision],
      idempotencyKey: randomUUID(),
    };
    const stock = (storeId: string) =>
      prisma.inventorySnapshot.findUniqueOrThrow({
        where: {
          storeId_productId_variantKey: { storeId, productId: product.id, variantKey: "BASE" },
        },
      });
    return { ...f, product, barcode, target, peer, caller, row, decision, input, stock };
  }

  it("shows the actual existing card, requires a decision, and previews only store-local changes", async () => {
    const f = await fixture();
    const preview = await f.caller.products.previewImportCsv({
      storeId: f.target.id,
      rows: [f.row],
    });
    expect(preview.rows[0]).toMatchObject({
      canConnect: true,
      existingProduct: { id: f.product.id },
      hasBlockingWarnings: true,
    });
    const chosen = await f.caller.products.previewImportCsv(f.input);
    expect(chosen.summary).toMatchObject({
      connected: 1,
      creates: 0,
      updates: 0,
      skipped: 0,
      blockingWarningCount: 0,
    });
    expect(chosen.rows[0].changes.map((change) => change.field).sort()).toEqual([
      "basePriceKgs",
      "minStock",
      "stockQty",
    ]);
    expect(chosen.rows[0].changes.find((change) => change.field === "stockQty")).toMatchObject({
      before: 2,
      after: 5,
    });
    const ignored = await f.caller.products.previewImportCsv({
      ...f.input,
      stockBehavior: "ignore",
    });
    expect(ignored.rows[0].changes.some((change) => change.field === "stockQty")).toBe(false);
    const skipped = await f.caller.products.previewImportCsv({
      ...f.input,
      rowActions: [{ ...f.decision, action: "skip" }],
    });
    expect(skipped.summary).toMatchObject({ skipped: 1, connected: 0, blockingWarningCount: 0 });
  });

  it.each(["set", "add", "ignore"] as const)(
    "connects safely with stock mode %s and preserves other stores and common fields",
    async (stockBehavior) => {
      const f = await fixture();
      const input = { ...f.input, stockBehavior, existingBehavior: "skip" as const };
      const result = await f.caller.products.importCsv(input);
      const replay = await f.caller.products.importCsv(input);
      expect(replay.batchId).toBe(result.batchId);
      expect(result.summary).toMatchObject({ created: 0, updated: 0, connected: 1, skipped: 0 });
      expect(await prisma.product.findUnique({ where: { id: f.product.id } })).toEqual(f.product);
      expect(await prisma.product.count()).toBe(1);
      expect((await f.stock(f.store.id)).onHand).toBe(10);
      expect((await f.stock(f.target.id)).onHand).toBe(
        stockBehavior === "set" ? 5 : stockBehavior === "add" ? 7 : 2,
      );
      expect(
        await prisma.storeProduct.findUnique({
          where: { storeId_productId: { storeId: f.target.id, productId: f.product.id } },
        }),
      ).toMatchObject({ isActive: true, isDirect: true });
      expect(await prisma.storeProduct.count({ where: { storeId: f.peer.id } })).toBe(0);
      const prices = await prisma.storePrice.findMany({ orderBy: { priceKgs: "asc" } });
      expect(prices.map((price) => Number(price.priceKgs))).toEqual([180, 225]);
      const extra = await prisma.storePriceTypes.findFirstOrThrow({
        where: { storeId: f.target.id },
      });
      expect(Number(extra.retailPriceKgs)).toBe(225);
      expect(Number(extra.wholesalePriceKgs)).toBe(120);
      expect(Number((await prisma.productCost.findFirstOrThrow()).avgCostKgs)).toBe(70);
      expect(await prisma.unit.count()).toBe(1);
      expect(
        await prisma.reorderPolicy.findFirst({ where: { storeId: f.target.id } }),
      ).toMatchObject({ minStock: 7 });
      expect(await prisma.reorderPolicy.count({ where: { storeId: f.store.id } })).toBe(0);
      expect(await prisma.productBarcode.findMany()).toHaveLength(1);
    },
  );

  it("restores an archived, unassigned card explicitly and keeps its identity and history on rollback", async () => {
    const f = await fixture();
    await prisma.product.update({ where: { id: f.product.id }, data: { isDeleted: true } });
    await prisma.storeProduct.updateMany({
      where: { productId: f.product.id },
      data: { isActive: false },
    });
    const preview = await f.caller.products.previewImportCsv(f.input);
    expect(preview.rows[0].warnings).toContainEqual(
      expect.objectContaining({ code: "archivedProductWillBeRestored" }),
    );
    const result = await f.caller.products.importCsv(f.input);
    expect(await prisma.product.findUnique({ where: { id: f.product.id } })).toMatchObject({
      name: f.product.name,
      sku: f.product.sku,
      isDeleted: false,
    });
    await f.caller.imports.rollback({ batchId: result.batchId });
    expect((await f.stock(f.target.id)).onHand).toBe(2);
    expect((await f.stock(f.store.id)).onHand).toBe(10);
    expect(await prisma.product.findUnique({ where: { id: f.product.id } })).toMatchObject({
      isDeleted: false,
    });
    expect(await prisma.productBarcode.count()).toBe(1);
    await expect(f.caller.imports.rollback({ batchId: result.batchId })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it.each([true, false])(
    "applies the local sale price with retail/wholesale enabled=%s and no retail price",
    async (enabled) => {
      const f = await fixture();
      await prisma.organization.update({
        where: { id: f.org.id },
        data: { retailWholesaleEnabled: enabled },
      });
      await prisma.store.update({
        where: { id: f.store.id },
        data: { currencyCode: "USD", currencyRateKgsPerUnit: 86 },
      });
      await prisma.storePriceTypes.updateMany({
        where: { storeId: f.target.id },
        data: { retailPriceKgs: null },
      });
      const preview = await f.caller.products.previewImportCsv(f.input);
      expect(
        preview.rows[0].changes.find((change) => change.field === "basePriceKgs"),
      ).toMatchObject({ before: enabled ? 120 : 100, after: 225 });
      await f.caller.products.importCsv({ ...f.input, stockBehavior: "ignore" });
      const prices = await prisma.storePriceTypes.findFirstOrThrow({
        where: { storeId: f.target.id },
      });
      expect(prices.retailPriceKgs === null ? null : Number(prices.retailPriceKgs)).toBe(
        enabled ? 225 : null,
      );
      expect(Number(prices.wholesalePriceKgs)).toBe(120);
      expect(await prisma.store.findUnique({ where: { id: f.store.id } })).toMatchObject({
        currencyCode: "USD",
      });
      expect((await f.stock(f.store.id)).onHand).toBe(10);
    },
  );

  it("rejects conflicting identifiers and a changed selected identity without any partial writes", async () => {
    const f = await fixture();
    const other = await prisma.product.create({
      data: {
        organizationId: f.org.id,
        name: "Other",
        sku: "OTHER",
        unit: f.baseUnit.code,
        baseUnitId: f.baseUnit.id,
      },
    });
    await prisma.productBarcode.create({
      data: { organizationId: f.org.id, productId: other.id, value: "OTHER-BARCODE" },
    });
    const bad = { ...f.input, rows: [{ ...f.row, barcodes: [f.barcode, "OTHER-BARCODE"] }] };
    const preview = await f.caller.products.previewImportCsv(bad);
    expect(preview.rows[0]).toMatchObject({ canConnect: false, hasBlockingWarnings: true });
    await expect(f.caller.products.importCsv(bad)).rejects.toMatchObject({
      code: "CONFLICT",
      message: "importProductMatchChanged",
    });
    await expect(
      f.caller.products.importCsv({
        ...f.input,
        rowActions: [{ ...f.decision, existingProductId: other.id }],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await prisma.importBatch.count()).toBe(0);
    expect(await prisma.storeProduct.count({ where: { storeId: f.target.id } })).toBe(0);
    expect((await f.stock(f.target.id)).onHand).toBe(2);
  });

  it("retains organization, role and import feature boundaries", async () => {
    const f = await fixture();
    const foreign = await prisma.organization.create({
      data: { name: "Other organization", plan: "BUSINESS" },
    });
    const foreignStore = await prisma.store.create({
      data: { organizationId: foreign.id, name: "Foreign", code: "FOREIGN" },
    });
    for (const user of [f.managerUser, f.staffUser, f.cashierUser]) {
      const caller = createTestCaller({ ...user, organizationId: f.org.id });
      await expect(caller.products.previewImportCsv(f.input)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(caller.products.importCsv(f.input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(
      f.caller.products.importCsv({ ...f.input, storeId: foreignStore.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const foreignUnit = await prisma.unit.create({
      data: { organizationId: foreign.id, code: "each", labelRu: "шт", labelKg: "даана" },
    });
    const foreignProduct = await prisma.product.create({
      data: {
        organizationId: foreign.id,
        name: "Foreign product",
        sku: f.row.sku,
        unit: "each",
        baseUnitId: foreignUnit.id,
      },
    });
    await expect(
      f.caller.products.importCsv({
        ...f.input,
        rowActions: [{ ...f.decision, existingProductId: foreignProduct.id }],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await prisma.importBatch.count()).toBe(0);
    await prisma.organization.update({
      where: { id: f.org.id },
      data: { subscriptionStatus: "PAST_DUE" },
    });
    await expect(f.caller.products.importCsv(f.input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
