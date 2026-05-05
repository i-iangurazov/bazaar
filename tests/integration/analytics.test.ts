import { beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { createTestCaller } from "../helpers/context";
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

    const sales = await adminCaller.analytics.salesTrend({
      storeId: store.id,
      rangeDays: 30,
      granularity: "day",
    });
    expect(sales.series.length).toBeGreaterThan(0);

    const top = await adminCaller.analytics.topProducts({
      storeId: store.id,
      rangeDays: 30,
      metric: "units",
    });
    expect(top.items.length).toBeGreaterThan(0);

    const value = await adminCaller.analytics.inventoryValue({ storeId: store.id });
    expect(value.valueKgs).toBeGreaterThan(0);

    const orgSales = await adminCaller.analytics.salesTrend({
      rangeDays: 30,
      granularity: "day",
    });
    expect(Array.isArray(orgSales.series)).toBe(true);
  });

  it("scopes org-wide charts for staff to assigned stores", async () => {
    const { store, staffUser } = await seedBase({ plan: "BUSINESS" });
    await prisma.userStoreAccess.create({
      data: { organizationId: staffUser.organizationId!, userId: staffUser.id, storeId: store.id },
    });
    const staffCaller = createTestCaller({
      id: staffUser.id,
      email: staffUser.email,
      role: staffUser.role,
      organizationId: staffUser.organizationId!,
    });

    const scopedSales = await staffCaller.analytics.salesTrend({
      rangeDays: 30,
      granularity: "day",
    });
    expect(Array.isArray(scopedSales.series)).toBe(true);

    const storeSales = await staffCaller.analytics.salesTrend({
      storeId: store.id,
      rangeDays: 30,
      granularity: "day",
    });
    expect(Array.isArray(storeSales.series)).toBe(true);
  });
});
