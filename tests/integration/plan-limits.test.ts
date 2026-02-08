import { describe, it, expect, beforeEach } from "vitest";

import { prisma } from "@/server/db/prisma";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("plan limits", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("blocks creating stores, users and products when trial limits are reached", async () => {
    const { org, adminUser, baseUnit, supplier } = await seedBase();

    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });

    await prisma.store.createMany({
      data: [
        {
          organizationId: org.id,
          name: "Branch 1",
          code: "BR1",
          allowNegativeStock: false,
        },
        {
          organizationId: org.id,
          name: "Branch 2",
          code: "BR2",
          allowNegativeStock: false,
        },
      ],
    });

    await expect(
      caller.stores.create({
        name: "Overflow store",
        code: "BR3",
        allowNegativeStock: false,
        trackExpiryLots: false,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "planLimitStores" });

    await prisma.user.createMany({
      data: Array.from({ length: 7 }).map((_, index) => ({
        organizationId: org.id,
        email: `limit-user-${index}@test.local`,
        name: `Limit User ${index}`,
        passwordHash: "hash",
        role: "STAFF",
        emailVerifiedAt: new Date(),
      })),
    });

    await expect(
      caller.users.create({
        email: "overflow-user@test.local",
        name: "Overflow User",
        role: "STAFF",
        password: "Password123!",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "planLimitUsers" });

    await prisma.product.createMany({
      data: Array.from({ length: 999 }).map((_, index) => ({
        organizationId: org.id,
        supplierId: supplier.id,
        sku: `SKU-LIMIT-${index}`,
        name: `Limit Product ${index}`,
        unit: baseUnit.code,
        baseUnitId: baseUnit.id,
      })),
    });

    await expect(
      caller.products.create({
        sku: "SKU-LIMIT-OVER",
        name: "Overflow Product",
        baseUnitId: baseUnit.id,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "planLimitProducts" });
  });
});
