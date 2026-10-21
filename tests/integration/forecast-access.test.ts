import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("forecast access with persisted store grants", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("blocks unassigned staff, manager and cashier before reading another store's movements", async () => {
    const f = await seedBase({ plan: "BUSINESS" });
    const otherStore = await prisma.store.create({
      data: { organizationId: f.org.id, name: "Restricted store", code: "OTHER" },
    });
    await prisma.stockMovement.create({
      data: { storeId: otherStore.id, productId: f.product.id, type: "SALE", qtyDelta: -7 },
    });
    for (const user of [f.staffUser, f.managerUser, f.cashierUser]) {
      await expect(
        createTestCaller({ ...user, organizationId: f.org.id }).forecast.explain({
          storeId: otherStore.id,
          productId: f.product.id,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN", message: "storeAccessDenied" });
    }
  });

  it("keeps assigned and administrator reads working and honors grant revocation", async () => {
    const f = await seedBase({ plan: "BUSINESS" });
    await prisma.stockMovement.create({
      data: { storeId: f.store.id, productId: f.product.id, type: "SALE", qtyDelta: -3 },
    });
    const input = { storeId: f.store.id, productId: f.product.id, windowDays: 7 };
    const staff = createTestCaller({ ...f.staffUser, organizationId: f.org.id });
    const admin = createTestCaller({ ...f.adminUser, organizationId: f.org.id });
    expect(
      (await staff.forecast.explain(input)).dailySales.reduce((sum, d) => sum + d.qty, 0),
    ).toBe(3);
    expect(
      (await admin.forecast.explain(input)).dailySales.reduce((sum, d) => sum + d.qty, 0),
    ).toBe(3);
    await prisma.userStoreAccess.deleteMany({
      where: { userId: f.staffUser.id, storeId: f.store.id },
    });
    await expect(staff.forecast.explain(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "storeAccessDenied",
    });
  });

  it("rejects a foreign organization's store and product", async () => {
    const f = await seedBase({ plan: "BUSINESS" });
    const org = await prisma.organization.create({ data: { name: "Foreign" } });
    const store = await prisma.store.create({
      data: { organizationId: org.id, name: "Foreign", code: "FOREIGN" },
    });
    const unit = await prisma.unit.create({
      data: { organizationId: org.id, code: "each", labelRu: "each", labelKg: "each" },
    });
    const product = await prisma.product.create({
      data: {
        organizationId: org.id,
        name: "Foreign product",
        sku: "FOREIGN",
        unit: unit.code,
        baseUnitId: unit.id,
      },
    });
    const admin = createTestCaller({ ...f.adminUser, organizationId: f.org.id });
    await expect(
      admin.forecast.explain({ storeId: store.id, productId: f.product.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "storeAccessDenied" });
    await expect(
      admin.forecast.explain({ storeId: f.store.id, productId: product.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "productAccessDenied" });
  });
});
