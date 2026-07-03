import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";

import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("email marketing product search", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("searches store products by contains name, SKU, barcode, Cyrillic, Latin, and includes selected products outside the first page", async () => {
    const { org, store, supplier, baseUnit, adminUser } = await seedBase();
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
    });

    await prisma.product.createMany({
      data: Array.from({ length: 45 }, (_, index) => ({
        organizationId: org.id,
        supplierId: supplier.id,
        baseUnitId: baseUnit.id,
        unit: baseUnit.code,
        sku: `A-FILL-${String(index).padStart(2, "0")}`,
        name: `A filler product ${String(index).padStart(2, "0")}`,
      })),
    });
    const fillers = await prisma.product.findMany({
      where: { organizationId: org.id, sku: { startsWith: "A-FILL-" } },
      select: { id: true },
    });
    await prisma.storeProduct.createMany({
      data: fillers.map((product) => ({
        organizationId: org.id,
        storeId: store.id,
        productId: product.id,
        isActive: true,
      })),
    });

    const zebra = await prisma.product.create({
      data: {
        organizationId: org.id,
        supplierId: supplier.id,
        baseUnitId: baseUnit.id,
        unit: baseUnit.code,
        sku: "ZEB-LAT-77",
        name: "Zebra Summit Backpack",
        basePriceKgs: 990,
        storeProducts: {
          create: {
            organizationId: org.id,
            storeId: store.id,
            isActive: true,
          },
        },
        barcodes: {
          create: {
            organizationId: org.id,
            value: "9900771234567",
          },
        },
      },
    });
    const cyrillic = await prisma.product.create({
      data: {
        organizationId: org.id,
        supplierId: supplier.id,
        baseUnitId: baseUnit.id,
        unit: baseUnit.code,
        sku: "KOF-BISH-01",
        name: "Кофе зерновой Бишкек",
        storeProducts: {
          create: {
            organizationId: org.id,
            storeId: store.id,
            isActive: true,
          },
        },
      },
    });
    const otherStore = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: "Other Store",
        code: "OTH",
      },
    });
    await prisma.product.create({
      data: {
        organizationId: org.id,
        supplierId: supplier.id,
        baseUnitId: baseUnit.id,
        unit: baseUnit.code,
        sku: "OTHER-ONLY",
        name: "Other Store Only Match",
        storeProducts: {
          create: {
            organizationId: org.id,
            storeId: otherStore.id,
            isActive: true,
          },
        },
      },
    });

    await expect(
      caller.emailMarketing.products({ storeId: store.id, search: "summ", limit: 10 }),
    ).resolves.toMatchObject({ items: [expect.objectContaining({ id: zebra.id })] });
    await expect(
      caller.emailMarketing.products({ storeId: store.id, search: "lat-77", limit: 10 }),
    ).resolves.toMatchObject({ items: [expect.objectContaining({ id: zebra.id })] });
    await expect(
      caller.emailMarketing.products({ storeId: store.id, search: "771234", limit: 10 }),
    ).resolves.toMatchObject({ items: [expect.objectContaining({ id: zebra.id })] });
    await expect(
      caller.emailMarketing.products({ storeId: store.id, search: "зернов", limit: 10 }),
    ).resolves.toMatchObject({ items: [expect.objectContaining({ id: cyrillic.id })] });

    const firstPageWithSelected = await caller.emailMarketing.products({
      storeId: store.id,
      search: null,
      limit: 5,
      includeIds: [zebra.id],
    });
    expect(firstPageWithSelected.items.map((product) => product.id)).toContain(zebra.id);

    const dedupedSelected = await caller.emailMarketing.products({
      storeId: store.id,
      search: "summ",
      limit: 10,
      includeIds: [zebra.id],
    });
    expect(dedupedSelected.items.filter((product) => product.id === zebra.id)).toHaveLength(1);

    const otherStoreScoped = await caller.emailMarketing.products({
      storeId: store.id,
      search: "Other Store Only",
      limit: 10,
    });
    expect(otherStoreScoped.items).toHaveLength(0);
  });
});
