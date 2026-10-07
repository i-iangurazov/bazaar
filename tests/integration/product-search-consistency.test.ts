import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("product search consistency", () => {
  beforeEach(resetDatabase);

  it("ranks Щит before защитный in every product search, before applying result limits", async () => {
    const f = await seedBase();
    const products = await prisma.product.createManyAndReturn({
      data: [
        ...Array.from({ length: 250 }, (_, i) => ({
          organizationId: f.org.id,
          unit: f.baseUnit.code,
          baseUnitId: f.baseUnit.id,
          sku: `A-${i}`,
          name: `Зубило с защитной рукояткой ${i}`,
        })),
        ...["Щит", "Щит 12 секций", "Корпус щита"].map((name, i) => ({
          organizationId: f.org.id,
          unit: f.baseUnit.code,
          baseUnitId: f.baseUnit.id,
          sku: `Z-${i}`,
          name,
        })),
      ],
    });
    await prisma.storeProduct.createMany({
      data: products.map((product) => ({
        organizationId: f.org.id,
        storeId: f.store.id,
        productId: product.id,
        isActive: true,
      })),
    });
    const caller = createTestCaller({ ...f.adminUser, organizationId: f.org.id, isOrgOwner: true });
    for (const q of ["щит", "  ЩИТ  "]) {
      const [inventory, quick, list, global, scan] = await Promise.all([
        caller.inventory.searchProducts({
          storeId: f.store.id,
          search: q,
          searchFields: ["name"],
          limit: 1,
        }),
        caller.products.searchQuick({ q, storeId: f.store.id, limit: 1 }),
        caller.products.list({ search: q, storeId: f.store.id, pageSize: 10 }),
        caller.search.global({ q }),
        caller.products.lookupScan({ q }),
      ]);
      expect(inventory.map((row) => row.product.name)).toEqual(["Щит"]);
      expect(quick.map((product) => product.name)).toEqual(["Щит"]);
      expect(list.items[0]?.name).toBe("Щит");
      expect(global.results.filter((result) => result.type === "product")[0]?.label).toBe("Щит");
      expect(scan.items.slice(0, 3).map((product) => product.name)).toEqual([
        "Щит",
        "Щит 12 секций",
        "Корпус щита",
      ]);
    }
    const words = await caller.products.lookupScan({ q: "щит секций" });
    expect(words.items.map((item) => item.name)).toEqual(["Щит 12 секций"]);
  });

  it("keeps identifier priority, field selection and literal search characters", async () => {
    const f = await seedBase();
    const caller = createTestCaller({ ...f.adminUser, organizationId: f.org.id, isOrgOwner: true });
    await prisma.product.update({
      where: { id: f.product.id },
      data: { sku: "ЩИТ", name: "Дрель 100%_точная" },
    });
    const named = await prisma.product.create({
      data: {
        organizationId: f.org.id,
        sku: "OTHER",
        name: "Щит",
        unit: f.baseUnit.code,
        baseUnitId: f.baseUnit.id,
        storeProducts: {
          create: { organizationId: f.org.id, storeId: f.store.id, isActive: true },
        },
      },
    });
    const results = await caller.inventory.searchProducts({
      storeId: f.store.id,
      search: "щит",
      limit: 1,
    });
    expect(results[0]?.product.id).toBe(f.product.id);
    const names = await caller.inventory.searchProducts({
      storeId: f.store.id,
      search: "щит",
      searchFields: ["name"],
      limit: 1,
    });
    expect(names[0]?.product.id).toBe(named.id);
    const mixed = await caller.inventory.searchProducts({
      storeId: f.store.id,
      search: "дрель щит",
    });
    expect(mixed.map((row) => row.product.id)).toEqual([f.product.id]);
    expect(
      (await caller.products.searchQuick({ q: "%_", storeId: f.store.id })).map(
        (product) => product.id,
      ),
    ).toEqual([f.product.id]);
    await prisma.productBarcode.create({
      data: { organizationId: f.org.id, productId: f.product.id, value: "5901234123457" },
    });
    expect(
      (await caller.products.searchQuick({ q: "5901234123457", storeId: f.store.id, limit: 1 }))[0]
        ?.id,
    ).toBe(f.product.id);
    expect((await caller.products.lookupScan({ q: "5901234123457" })).exactMatch).toBe(true);
  });

  it("applies organization, store and archive scope before choosing the top match", async () => {
    const f = await seedBase();
    await prisma.product.update({ where: { id: f.product.id }, data: { name: "Щит доступный" } });
    const hiddenStore = await prisma.store.create({
      data: { organizationId: f.org.id, name: "Hidden", code: "HIDDEN" },
    });
    await prisma.product.create({
      data: {
        organizationId: f.org.id,
        sku: "HIDDEN",
        name: "Щит",
        unit: f.baseUnit.code,
        baseUnitId: f.baseUnit.id,
        storeProducts: {
          create: { organizationId: f.org.id, storeId: hiddenStore.id, isActive: true },
        },
      },
    });
    await prisma.product.create({
      data: {
        organizationId: f.org.id,
        sku: "ARCHIVED",
        name: "Щит",
        isDeleted: true,
        unit: f.baseUnit.code,
        baseUnitId: f.baseUnit.id,
        storeProducts: {
          create: { organizationId: f.org.id, storeId: f.store.id, isActive: true },
        },
      },
    });
    const other = await prisma.organization.create({ data: { name: "Other" } });
    const otherUnit = await prisma.unit.create({
      data: { organizationId: other.id, code: "each", labelRu: "шт", labelKg: "даана" },
    });
    await prisma.product.create({
      data: {
        organizationId: other.id,
        sku: "OTHER",
        name: "Щит",
        unit: "each",
        baseUnitId: otherUnit.id,
      },
    });
    const caller = createTestCaller({ ...f.managerUser, organizationId: f.org.id });
    const [inventory, quick, global, scan] = await Promise.all([
      caller.inventory.searchProducts({ storeId: f.store.id, search: "щит", limit: 1 }),
      caller.products.searchQuick({ q: "щит", limit: 1 }),
      caller.search.global({ q: "щит" }),
      caller.products.lookupScan({ q: "щит" }),
    ]);
    expect(inventory.map((row) => row.product.id)).toEqual([f.product.id]);
    expect(quick.map((product) => product.id)).toEqual([f.product.id]);
    expect(
      global.results.filter((result) => result.type === "product").map((result) => result.id),
    ).toEqual([f.product.id]);
    expect(scan.items.map((product) => product.id)).toEqual([f.product.id]);
    await expect(
      caller.inventory.searchProducts({ storeId: hiddenStore.id, search: "щит" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
