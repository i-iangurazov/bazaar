import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { bulkUpdateStorePrices, upsertStorePrice } from "@/server/services/storePrices";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("product form retail and wholesale prices", () => {
  beforeEach(resetDatabase);

  const fixture = async () => {
    const f = await seedBase({ plan: "BUSINESS", allowNegativeStock: true });
    await prisma.organization.update({
      where: { id: f.org.id },
      data: { retailWholesaleEnabled: true },
    });
    const caller = createTestCaller({ ...f.adminUser, organizationId: f.org.id });
    return { ...f, caller };
  };

  it("requires retail only in the enabled editor, accepts zero and rolls back invalid saves", async () => {
    const f = await fixture();
    const create = {
      idempotencyKey: "required-retail-create",
      storeId: f.store.id,
      name: "Required retail",
      baseUnitId: f.baseUnit.id,
    };
    await expect(f.caller.products.create(create)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "retailPriceRequired",
    });
    await expect(
      f.caller.products.create({ ...create, retailPriceKgs: null }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "retailPriceRequired",
    });
    expect(await prisma.product.count({ where: { name: create.name } })).toBe(0);
    const product = await f.caller.products.create({ ...create, retailPriceKgs: 0 });
    expect(
      (await f.caller.products.storePricing({ productId: product.id })).stores[0],
    ).toMatchObject({ retailPriceKgs: 0, effectivePriceKgs: 0 });
    await expect(
      f.caller.products.update({
        productId: product.id,
        storeId: f.store.id,
        sku: product.sku,
        name: "Must not persist",
        baseUnitId: f.baseUnit.id,
        retailPriceKgs: null,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "retailPriceRequired" });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).name).toBe(
      create.name,
    );
    // Photo-only and inline writers do not impose the full editor's requirement.
    await f.caller.products.update({
      imagesOnly: true,
      productId: f.product.id,
      storeId: f.store.id,
      sku: f.product.sku,
      name: f.product.name,
      baseUnitId: f.baseUnit.id,
      images: [{ url: "/uploads/products/editor-photo.webp", position: 0 }],
    });
    await f.caller.products.inlineUpdate({
      productId: f.product.id,
      patch: { name: "Inline rename" },
    });
    await prisma.organization.update({
      where: { id: f.org.id },
      data: { retailWholesaleEnabled: false },
    });
    const ordinary = await f.caller.products.create({
      ...create,
      idempotencyKey: "disabled-no-price",
      name: "Optional ordinary",
    });
    expect(ordinary.basePriceKgs).toBeNull();
  });

  it("hydrates legacy prices, preserves hidden base values and keeps prices current across toggles", async () => {
    const f = await fixture();
    const product = await f.caller.products.create({
      idempotencyKey: "legacy-retail-price",
      storeId: f.store.id,
      name: "Legacy price",
      baseUnitId: f.baseUnit.id,
      basePriceKgs: 75,
    });
    expect(
      (await f.caller.products.storePricing({ productId: product.id })).stores[0],
    ).toMatchObject({ retailPriceKgs: 75, effectivePriceKgs: 75 });
    const edit = {
      productId: product.id,
      storeId: f.store.id,
      sku: product.sku,
      name: product.name,
      baseUnitId: f.baseUnit.id,
    };
    await f.caller.products.update({ ...edit, retailPriceKgs: 120, wholesalePriceKgs: 90 });
    expect(
      (
        await prisma.product.findUniqueOrThrow({ where: { id: product.id } })
      ).basePriceKgs?.toNumber(),
    ).toBe(75);
    expect(
      (
        await prisma.storePrice.findFirstOrThrow({ where: { productId: product.id } })
      ).priceKgs?.toNumber(),
    ).toBe(120);
    // The ordinary field in an older client must update the retail alias too.
    await f.caller.products.update({ ...edit, storePriceKgs: 130 });
    expect(
      (await f.caller.products.storePricing({ productId: product.id })).stores[0],
    ).toMatchObject({ retailPriceKgs: 130, wholesalePriceKgs: 90 });
    await prisma.organization.update({
      where: { id: f.org.id },
      data: { retailWholesaleEnabled: false },
    });
    await f.caller.products.update({ ...edit, storePriceKgs: 150 });
    await prisma.organization.update({
      where: { id: f.org.id },
      data: { retailWholesaleEnabled: true },
    });
    expect(
      (await f.caller.products.storePricing({ productId: product.id })).stores[0],
    ).toMatchObject({ retailPriceKgs: 150, wholesalePriceKgs: 90, effectivePriceKgs: 150 });
    await upsertStorePrice({
      organizationId: f.org.id,
      actorId: f.adminUser.id,
      requestId: "retail-direct-sync",
      storeId: f.store.id,
      productId: product.id,
      priceKgs: 160,
    });
    await bulkUpdateStorePrices({
      organizationId: f.org.id,
      actorId: f.adminUser.id,
      requestId: "retail-bulk-sync",
      storeId: f.store.id,
      mode: "increaseAbs",
      value: 10,
      filter: { search: product.name },
    });
    expect(
      (await f.caller.products.storePricing({ productId: product.id })).stores[0],
    ).toMatchObject({ retailPriceKgs: 170, wholesalePriceKgs: 90, effectivePriceKgs: 170 });
  });

  it("uses legacy retail values consistently in lists, price sorting and missing-price filters", async () => {
    const f = await fixture();
    const product = await f.caller.products.create({
      idempotencyKey: "retail-list-price",
      storeId: f.store.id,
      name: "Retail list item",
      baseUnitId: f.baseUnit.id,
      retailPriceKgs: 125,
    });
    // Simulate a row saved before the retail/ordinary aliases were synchronized.
    await prisma.storePrice.updateMany({
      where: { productId: product.id },
      data: { priceKgs: 10, discountType: "PERCENTAGE", discountPercentage: 20 },
    });
    const list = await f.caller.products.list({
      storeId: f.store.id,
      sortKey: "salePrice",
      sortDirection: "desc",
    });
    expect(list.items.find((row) => row.id === product.id)?.effectivePriceKgs).toBe(100);
    expect(
      (await f.caller.products.storePricing({ productId: product.id })).stores[0].effectivePriceKgs,
    ).toBe(125);
    const missing = await f.caller.products.list({
      storeId: f.store.id,
      readiness: "missingPrice",
    });
    expect(missing.items.map((row) => row.id)).toContain(f.product.id);
    expect(missing.items.map((row) => row.id)).not.toContain(product.id);
    const missingIds = await f.caller.products.listIds({
      storeId: f.store.id,
      readiness: "missingPrice",
    });
    expect(missingIds).not.toContain(product.id);
    await upsertStorePrice({
      organizationId: f.org.id,
      actorId: f.adminUser.id,
      requestId: "retail-discount-preserve",
      storeId: f.store.id,
      productId: product.id,
      retailPriceKgs: 200,
    });
    const ordinary = await prisma.storePrice.findFirstOrThrow({ where: { productId: product.id } });
    expect(ordinary.discountPercentage?.toNumber()).toBe(20);
    expect(ordinary.priceKgs?.toNumber()).toBe(200);
    expect(
      (await f.caller.products.list({ storeId: f.store.id })).items.find(
        (row) => row.id === product.id,
      )?.effectivePriceKgs,
    ).toBe(160);
  });

  it("creates and edits product and variant prices through the form API and applies them in POS", async () => {
    const f = await fixture();
    const input = {
      idempotencyKey: "product-price-form-create",
      storeId: f.store.id,
      name: "Product with prices",
      baseUnitId: f.baseUnit.id,
      basePriceKgs: 100,
      retailPriceKgs: 125,
      wholesalePriceKgs: 85,
      variants: [
        { name: "Small", attributes: { size: "S" }, retailPriceKgs: 0, wholesalePriceKgs: null },
        { name: "Large", attributes: { size: "L" }, retailPriceKgs: null, wholesalePriceKgs: 60 },
      ],
    };
    const product = await f.caller.products.create(input);
    expect((await f.caller.products.create(input)).id).toBe(product.id);
    const variants = await prisma.productVariant.findMany({ where: { productId: product.id } });
    const small = variants.find((row) => row.name === "Small")!;
    const large = variants.find((row) => row.name === "Large")!;
    const pricing = await f.caller.products.storePricing({ productId: product.id });
    expect(pricing.stores[0]).toMatchObject({ retailPriceKgs: 125, wholesalePriceKgs: 85 });
    expect(pricing.stores[0].variants.find((row) => row.variantId === small.id)).toMatchObject({
      retailPriceKgs: 0,
      wholesalePriceKgs: null,
    });
    expect(await prisma.storePriceTypes.count({ where: { productId: product.id } })).toBe(3);

    const register = await f.caller.pos.registers.create({
      storeId: f.store.id,
      name: "Price form",
      code: "PRICES",
    });
    await f.caller.pos.shifts.open({
      registerId: register.id,
      openingCashKgs: 0,
      idempotencyKey: "product-price-form-shift",
    });
    const checkTotal = async (priceMode: "RETAIL" | "WHOLESALE", expected: number) => {
      const sale = await f.caller.pos.sales.createDraft({
        registerId: register.id,
        priceMode,
        lines: [
          { productId: product.id, qty: 1 },
          { productId: product.id, variantId: small.id, qty: 1 },
          { productId: product.id, variantId: large.id, qty: 1 },
        ],
      });
      const saved = await prisma.customerOrder.findUniqueOrThrow({ where: { id: sale.id } });
      expect(saved.totalKgs.toNumber()).toBe(expected);
      await f.caller.pos.sales.cancelDraft({ saleId: sale.id });
    };
    await checkTotal("RETAIL", 185);
    await checkTotal("WHOLESALE", 145);
    await f.caller.products.update({
      productId: product.id,
      storeId: f.store.id,
      sku: product.sku,
      name: product.name,
      baseUnitId: f.baseUnit.id,
      basePriceKgs: 100,
      retailPriceKgs: 125,
      wholesalePriceKgs: 95,
      variants: [
        { id: small.id, name: small.name!, retailPriceKgs: null, wholesalePriceKgs: 40 },
        { id: large.id, name: large.name!, retailPriceKgs: 90, wholesalePriceKgs: 0 },
      ],
    });
    await checkTotal("RETAIL", 255);
    await checkTotal("WHOLESALE", 135);
    const reloaded = await f.caller.products.storePricing({ productId: product.id });
    expect(reloaded.stores[0]).toMatchObject({ retailPriceKgs: 125, wholesalePriceKgs: 95 });
    expect(reloaded.stores[0].variants.find((row) => row.variantId === large.id)).toMatchObject({
      retailPriceKgs: 90,
      wholesalePriceKgs: 0,
    });
    expect(
      await prisma.auditLog.count({
        where: { organizationId: f.org.id, action: "STORE_PRICE_UPDATE" },
      }),
    ).toBe(6);
  });

  it("keeps saved prices when fields are omitted, including after the organization disables them", async () => {
    const f = await fixture();
    const product = await f.caller.products.create({
      idempotencyKey: "product-price-form-keep",
      storeId: f.store.id,
      name: "Keep prices",
      baseUnitId: f.baseUnit.id,
      basePriceKgs: 100,
      retailPriceKgs: 0,
      wholesalePriceKgs: 80,
    });
    await prisma.organization.update({
      where: { id: f.org.id },
      data: { retailWholesaleEnabled: false },
    });
    await f.caller.products.update({
      productId: product.id,
      storeId: f.store.id,
      sku: product.sku,
      name: "Renamed",
      baseUnitId: f.baseUnit.id,
    });
    const prices = await prisma.storePriceTypes.findFirstOrThrow({
      where: { productId: product.id },
    });
    expect(prices.retailPriceKgs?.toNumber()).toBe(0);
    expect(prices.wholesalePriceKgs?.toNumber()).toBe(80);
    await expect(
      f.caller.products.update({
        productId: product.id,
        storeId: f.store.id,
        sku: product.sku,
        name: "Must roll back",
        baseUnitId: f.baseUnit.id,
        retailPriceKgs: null,
        wholesalePriceKgs: 90,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "retailWholesaleDisabled" });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).name).toBe(
      "Renamed",
    );
    expect(
      (
        await prisma.storePriceTypes.findFirstOrThrow({ where: { productId: product.id } })
      ).wholesalePriceKgs?.toNumber(),
    ).toBe(80);
    await expect(
      f.caller.products.create({
        idempotencyKey: "product-price-form-disabled",
        storeId: f.store.id,
        name: "Disabled create",
        baseUnitId: f.baseUnit.id,
        retailPriceKgs: 123,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      await prisma.product.count({ where: { organizationId: f.org.id, name: "Disabled create" } }),
    ).toBe(0);
  });

  it("changes only the selected store and enforces store and role access", async () => {
    const f = await fixture();
    const second = await prisma.store.create({
      data: { organizationId: f.org.id, code: "SECOND", name: "Second" },
    });
    await prisma.storeProduct.create({
      data: {
        organizationId: f.org.id,
        storeId: second.id,
        productId: f.product.id,
        isActive: true,
        isDirect: true,
      },
    });
    const update = {
      productId: f.product.id,
      sku: f.product.sku,
      name: f.product.name,
      baseUnitId: f.baseUnit.id,
    };
    await f.caller.products.update({
      ...update,
      storeId: f.store.id,
      retailPriceKgs: 100,
      wholesalePriceKgs: 80,
    });
    await f.caller.products.update({
      ...update,
      storeId: second.id,
      retailPriceKgs: 200,
      wholesalePriceKgs: 160,
    });
    const rows = await f.caller.products.storePricing({ productId: f.product.id });
    expect(rows.stores.find((row) => row.storeId === f.store.id)).toMatchObject({
      retailPriceKgs: 100,
      wholesalePriceKgs: 80,
    });
    expect(rows.stores.find((row) => row.storeId === second.id)).toMatchObject({
      retailPriceKgs: 200,
      wholesalePriceKgs: 160,
    });
    const manager = createTestCaller({ ...f.managerUser, organizationId: f.org.id });
    await expect(
      manager.products.update({ ...update, storeId: second.id, wholesalePriceKgs: 1 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const staff = createTestCaller({ ...f.staffUser, organizationId: f.org.id });
    await expect(
      staff.products.update({ ...update, storeId: f.store.id, wholesalePriceKgs: 1 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const otherOrg = await prisma.organization.create({ data: { name: "Other" } });
    const otherStore = await prisma.store.create({
      data: { organizationId: otherOrg.id, code: "OTHER", name: "Other" },
    });
    await expect(
      f.caller.products.update({ ...update, storeId: otherStore.id, wholesalePriceKgs: 1 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      (
        await prisma.storePriceTypes.findFirstOrThrow({
          where: { productId: f.product.id, storeId: second.id },
        })
      ).wholesalePriceKgs?.toNumber(),
    ).toBe(160);
  });
});
