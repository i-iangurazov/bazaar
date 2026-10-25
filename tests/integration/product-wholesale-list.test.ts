import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("product list wholesale prices", () => {
  beforeEach(resetDatabase);

  it("returns the selected store's configured wholesale price, preserves zero and never substitutes retail", async () => {
    const f = await seedBase({ plan: "BUSINESS" });
    await prisma.organization.update({
      where: { id: f.org.id },
      data: { retailWholesaleEnabled: true },
    });
    const other = await prisma.store.create({
      data: { organizationId: f.org.id, name: "Other", code: "OTHER" },
    });
    await prisma.storeProduct.create({
      data: {
        organizationId: f.org.id,
        storeId: other.id,
        productId: f.product.id,
        isActive: true,
      },
    });
    for (const [storeId, retail, wholesale] of [
      [f.store.id, 120, 80],
      [other.id, 200, 0],
    ] as const) {
      await prisma.storePriceTypes.create({
        data: {
          organizationId: f.org.id,
          storeId,
          productId: f.product.id,
          variantKey: "BASE",
          retailPriceKgs: retail,
          wholesalePriceKgs: wholesale,
        },
      });
    }
    const caller = createTestCaller({ ...f.adminUser, organizationId: f.org.id });
    const before = await prisma.storePriceTypes.findMany({ orderBy: { storeId: "asc" } });
    const first = await caller.products.bootstrap({ storeId: f.store.id });
    expect(first.list.priceTypesEnabled).toBe(true);
    expect(first.list.items.find((row) => row.id === f.product.id)).toMatchObject({
      wholesalePriceKgs: 80,
      effectivePriceKgs: 120,
    });
    const second = await caller.products.list({ storeId: other.id });
    expect(second.items.find((row) => row.id === f.product.id)).toMatchObject({
      wholesalePriceKgs: 0,
      effectivePriceKgs: 200,
    });
    expect(await prisma.storePriceTypes.findMany({ orderBy: { storeId: "asc" } })).toEqual(before);

    const stockBefore = await prisma.inventorySnapshot.findMany({
      where: { productId: f.product.id },
    });
    await caller.storePrices.upsert({
      storeId: f.store.id,
      productId: f.product.id,
      wholesalePriceKgs: 55,
    });
    expect((await caller.products.list({ storeId: f.store.id })).items[0]).toMatchObject({
      wholesalePriceKgs: 55,
      effectivePriceKgs: 120,
    });
    expect(
      (
        await prisma.storePriceTypes.findFirstOrThrow({ where: { storeId: f.store.id } })
      ).retailPriceKgs?.toNumber(),
    ).toBe(120);
    expect((await caller.products.list({ storeId: other.id })).items[0].wholesalePriceKgs).toBe(0);
    expect(await prisma.inventorySnapshot.findMany({ where: { productId: f.product.id } })).toEqual(
      stockBefore,
    );
    await caller.storePrices.upsert({
      storeId: f.store.id,
      productId: f.product.id,
      wholesalePriceKgs: null,
    });
    expect((await caller.products.list({ storeId: f.store.id })).items[0]).toMatchObject({
      wholesalePriceKgs: null,
      effectivePriceKgs: 120,
    });

    await prisma.storePriceTypes.updateMany({
      where: { storeId: f.store.id },
      data: { wholesalePriceKgs: null },
    });
    expect((await caller.products.list({ storeId: f.store.id })).items[0]).toMatchObject({
      wholesalePriceKgs: null,
      effectivePriceKgs: 120,
    });
    await prisma.organization.update({
      where: { id: f.org.id },
      data: { retailWholesaleEnabled: false },
    });
    const disabled = await caller.products.list({ storeId: other.id });
    expect(disabled.priceTypesEnabled).toBe(false);
    expect(disabled.items[0].wholesalePriceKgs).toBeNull();
    expect(
      (
        await prisma.storePriceTypes.findFirstOrThrow({ where: { storeId: other.id } })
      ).wholesalePriceKgs?.toNumber(),
    ).toBe(0);
  });

  it("keeps store and organization authorization and exposes no arbitrary wholesale price across stores", async () => {
    const f = await seedBase({ plan: "BUSINESS" });
    await prisma.organization.update({
      where: { id: f.org.id },
      data: { retailWholesaleEnabled: true },
    });
    const other = await prisma.store.create({
      data: { organizationId: f.org.id, name: "Restricted", code: "RESTRICTED" },
    });
    const manager = createTestCaller({ ...f.managerUser, organizationId: f.org.id });
    await expect(manager.products.list({ storeId: other.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const admin = createTestCaller({ ...f.adminUser, organizationId: f.org.id });
    const all = await admin.products.list({});
    expect(all.priceTypesEnabled).toBe(false);
    expect(all.items[0].wholesalePriceKgs).toBeNull();
    const foreign = await prisma.organization.create({ data: { name: "Foreign" } });
    const store = await prisma.store.create({
      data: { organizationId: foreign.id, name: "Foreign", code: "F" },
    });
    await expect(admin.products.list({ storeId: store.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    for (const user of [f.managerUser, f.staffUser, f.cashierUser]) {
      const caller = createTestCaller({ ...user, organizationId: f.org.id });
      expect((await caller.products.list({ storeId: f.store.id })).priceTypesEnabled).toBe(true);
      if (user.role !== "MANAGER") {
        await expect(
          caller.storePrices.upsert({
            storeId: f.store.id,
            productId: f.product.id,
            wholesalePriceKgs: 1,
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
    }
  });
});
