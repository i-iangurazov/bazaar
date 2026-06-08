import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { createTestCaller } from "../helpers/context";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("manager operational permissions", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("allows managers to manage product support data", async () => {
    const { org, managerUser } = await seedBase();
    const caller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
    });

    const unit = await caller.units.create({
      code: "box",
      labelRu: "коробка",
      labelKg: "куту",
    });
    const updatedUnit = await caller.units.update({
      unitId: unit.id,
      labelRu: "кор.",
      labelKg: "кут.",
    });
    expect(updatedUnit.labelRu).toBe("кор.");

    const category = await caller.productCategories.create({ name: "Shoes" });
    expect(category.name).toBe("Shoes");
    await caller.attributes.create({
      key: "size",
      labelRu: "Размер",
      labelKg: "Өлчөм",
      type: "TEXT",
    });
    await caller.attributes.create({
      key: "color",
      labelRu: "Цвет",
      labelKg: "Түс",
      type: "TEXT",
    });

    const template = await caller.categoryTemplates.set({
      category: "Shoes",
      attributeKeys: ["size", "color"],
    });
    expect(template.map((row) => row.attributeKey)).toEqual(["size", "color"]);

    await caller.categoryTemplates.remove({ category: "Shoes" });
    await caller.productCategories.remove({ name: "Shoes" });
    await caller.units.remove({ unitId: unit.id });
  });

  it("allows managers to manage master products", async () => {
    const { org, baseUnit, managerUser } = await seedBase();
    const caller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
    });

    const created = await caller.products.create({
      sku: "MGR-PRODUCT-1",
      name: "Manager Product",
      baseUnitId: baseUnit.id,
      basePriceKgs: 1200,
      avgCostKgs: 700,
      categories: ["Shoes"],
    });
    expect(created.name).toBe("Manager Product");

    const updated = await caller.products.update({
      productId: created.id,
      sku: "MGR-PRODUCT-1",
      name: "Manager Product Updated",
      baseUnitId: baseUnit.id,
      basePriceKgs: 1300,
      avgCostKgs: 800,
      categories: ["Shoes", "Sale"],
      barcodes: ["1234567890123"],
    });
    expect(updated.name).toBe("Manager Product Updated");
    expect(updated.categories).toEqual(["Shoes", "Sale"]);

    await caller.products.archive({ productId: created.id });
    await expect(
      prisma.product.findUniqueOrThrow({ where: { id: created.id } }),
    ).resolves.toMatchObject({ isDeleted: true });

    await caller.products.restore({ productId: created.id });
    await expect(
      prisma.product.findUniqueOrThrow({ where: { id: created.id } }),
    ).resolves.toMatchObject({ isDeleted: false });
  });

  it("allows managers to manually adjust inventory in accessible stores", async () => {
    const { org, store, product, baseUnit, managerUser } = await seedBase();
    const caller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
    });

    await expect(
      caller.products.create({
        sku: "MGR-STOCK-1",
        name: "Manager Stock Product",
        baseUnitId: baseUnit.id,
        basePriceKgs: 100,
        initialOnHand: 5,
        categories: [],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "inventoryAdminRequired" });

    const adjustment = await caller.inventory.adjust({
      storeId: store.id,
      productId: product.id,
      qtyDelta: 1,
      reason: "manual test adjustment",
      idempotencyKey: "manager-stock-adjust",
    });
    const snapshot = await prisma.inventorySnapshot.findUnique({
      where: {
        storeId_productId_variantKey: {
          storeId: store.id,
          productId: product.id,
          variantKey: "BASE",
        },
      },
    });

    expect(adjustment.onHand).toBe(1);
    expect(snapshot?.onHand).toBe(1);
  });

  it("allows managers to create and update registers only in accessible stores", async () => {
    const { org, store, managerUser } = await seedBase({ plan: "BUSINESS" });
    await prisma.userStoreAccess.createMany({
      data: [{ organizationId: org.id, userId: managerUser.id, storeId: store.id }],
      skipDuplicates: true,
    });
    const otherStore = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: "Other Store",
        code: "OTH",
        allowNegativeStock: false,
      },
    });
    const caller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
    });

    const register = await caller.pos.registers.create({
      storeId: store.id,
      name: "Front",
      code: "front",
    });
    expect(register.code).toBe("FRONT");

    const updated = await caller.pos.registers.update({
      registerId: register.id,
      name: "Front Desk",
    });
    expect(updated.name).toBe("Front Desk");

    await expect(
      caller.pos.registers.create({
        storeId: otherStore.id,
        name: "Back",
        code: "back",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
