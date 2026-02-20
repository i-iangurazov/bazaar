import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("inline edit mutations", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("updates product price via products.inlineUpdate and enforces RBAC, validation, and tenancy", async () => {
    const { org, product, adminUser, managerUser } = await seedBase();
    const adminCaller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });
    const managerCaller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
    });

    await adminCaller.products.inlineUpdate({
      productId: product.id,
      patch: { basePriceKgs: 155 },
    });

    const stored = await prisma.product.findUnique({
      where: { id: product.id },
      select: { basePriceKgs: true },
    });
    expect(Number(stored?.basePriceKgs ?? 0)).toBe(155);

    await expect(
      managerCaller.products.inlineUpdate({
        productId: product.id,
        patch: { basePriceKgs: 160 },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      adminCaller.products.inlineUpdate({
        productId: product.id,
        patch: {},
      } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const otherOrg = await prisma.organization.create({ data: { name: "Other Org Inline" } });
    const otherUnit = await prisma.unit.create({
      data: {
        organizationId: otherOrg.id,
        code: "each",
        labelRu: "шт",
        labelKg: "даана",
      },
    });
    const otherProduct = await prisma.product.create({
      data: {
        organizationId: otherOrg.id,
        sku: "OTHER-1",
        name: "Other Product",
        unit: otherUnit.code,
        baseUnitId: otherUnit.id,
      },
    });

    await expect(
      adminCaller.products.inlineUpdate({
        productId: otherProduct.id,
        patch: { basePriceKgs: 180 },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("updates inventory minStock and enforces RBAC and validation", async () => {
    const { org, store, product, managerUser, staffUser } = await seedBase();
    const managerCaller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
    });
    const staffCaller = createTestCaller({
      id: staffUser.id,
      email: staffUser.email,
      role: staffUser.role,
      organizationId: org.id,
    });

    await managerCaller.inventory.setMinStock({
      storeId: store.id,
      productId: product.id,
      minStock: 7,
    });

    const policy = await prisma.reorderPolicy.findUnique({
      where: {
        storeId_productId: {
          storeId: store.id,
          productId: product.id,
        },
      },
      select: { minStock: true },
    });
    expect(policy?.minStock).toBe(7);

    await expect(
      staffCaller.inventory.setMinStock({
        storeId: store.id,
        productId: product.id,
        minStock: 6,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      managerCaller.inventory.setMinStock({
        storeId: store.id,
        productId: product.id,
        minStock: -1,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("updates user role/locale via users.update and enforces RBAC and validation", async () => {
    const { org, adminUser, managerUser, staffUser } = await seedBase({ plan: "BUSINESS" });
    const adminCaller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });
    const managerCaller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
    });

    await adminCaller.users.update({
      userId: staffUser.id,
      email: "staff.promoted@test.local",
      name: "Staff Promoted",
      role: "MANAGER",
      preferredLocale: "kg",
    });

    const storedUser = await prisma.user.findUnique({
      where: { id: staffUser.id },
      select: { email: true, role: true, preferredLocale: true },
    });
    expect(storedUser).toMatchObject({
      email: "staff.promoted@test.local",
      role: "MANAGER",
      preferredLocale: "kg",
    });

    await expect(
      managerCaller.users.update({
        userId: staffUser.id,
        email: "blocked.manager@test.local",
        name: "Blocked Manager",
        role: "STAFF",
        preferredLocale: "ru",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      adminCaller.users.update({
        userId: managerUser.id,
        email: managerUser.email,
        name: managerUser.name,
        role: "OWNER",
        preferredLocale: "ru",
      } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
