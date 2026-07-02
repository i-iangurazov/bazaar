import type { OrganizationPlan } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("plan limits", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it.each([
    { plan: "STARTER" as OrganizationPlan, limit: 1, message: "planLimitStores1" },
    { plan: "BUSINESS" as OrganizationPlan, limit: 5, message: "planLimitStores5" },
    { plan: "ENTERPRISE" as OrganizationPlan, limit: 15, message: "planLimitStores15" },
  ])("$plan cannot create more than $limit stores", async ({ plan, limit, message }) => {
    const { org, adminUser } = await seedBase({ plan });

    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });

    for (let index = 2; index <= limit; index += 1) {
      await caller.stores.create({
        name: `Limit store ${index}`,
        code: `LIM-${plan}-${index}`,
        allowNegativeStock: false,
        trackExpiryLots: false,
      });
    }

    await expect(
      caller.stores.create({
        name: "Overflow store",
        code: `OVR-${plan}`,
        allowNegativeStock: false,
        trackExpiryLots: false,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", message });
  });

  it("starter cannot exceed 1000 products", async () => {
    const { org, adminUser, baseUnit, supplier } = await seedBase({ plan: "STARTER" });

    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });

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

  it("starter cannot exceed 5 active users", async () => {
    const { org, adminUser } = await seedBase({ plan: "STARTER" });

    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });

    await caller.users.create({
      email: "limit-user-1@test.local",
      name: "Limit User 1",
      role: "STAFF",
      password: "Password123!",
    });

    await expect(
      caller.users.create({
        email: "limit-user-2@test.local",
        name: "Limit User 2",
        role: "STAFF",
        password: "Password123!",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "planLimitUsers" });
  });
});
