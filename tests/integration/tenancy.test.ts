import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/server/db/prisma";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { createTestCaller } from "../helpers/context";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("tenant isolation and signup", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates org/store/admin on signup in open mode", async () => {
    vi.stubEnv("SIGNUP_MODE", "open");
    const caller = createTestCaller();

    const result = await caller.publicAuth.signup({
      email: "owner@test.local",
      password: "Password123!",
      name: "Owner",
      orgName: "Owner Org",
      storeName: "First Store",
      phone: "+996555010200",
      preferredLocale: "ru",
    });

    const org = await prisma.organization.findUnique({ where: { id: result.organizationId } });
    expect(org?.plan).toBe("TRIAL");

    const store = await prisma.store.findFirst({
      where: { organizationId: result.organizationId, name: "First Store" },
    });
    expect(store).not.toBeNull();

    const user = await prisma.user.findUnique({ where: { id: result.userId } });
    expect(user?.email).toBe("owner@test.local");
    expect(user?.emailVerifiedAt).toBeNull();

    try {
      await caller.publicAuth.signup({
        email: "owner@test.local",
        password: "Password123!",
        name: "Owner",
        orgName: "Owner Org",
        storeName: "Second Store",
        preferredLocale: "ru",
      });
      throw new Error("expected signup to fail");
    } catch (error) {
      const code = (error as { code?: string }).code;
      expect(["CONFLICT", "TOO_MANY_REQUESTS"]).toContain(code);
    }

    const usersWithEmail = await prisma.user.count({ where: { email: "owner@test.local" } });
    expect(usersWithEmail).toBe(1);

  });

  it("accepts invite within the correct organization", async () => {
    const { org, adminUser } = await seedBase();
    const adminCaller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });

    const invite = await adminCaller.invites.create({
      email: "new.user@test.local",
      role: "STAFF",
    });

    const publicCaller = createTestCaller();
    const accepted = await publicCaller.publicAuth.acceptInvite({
      token: invite.token,
      name: "Invited User",
      password: "Password123!",
      preferredLocale: "ru",
    });

    const created = await prisma.user.findUnique({ where: { id: accepted.id } });
    expect(created?.organizationId).toBe(org.id);
  });

  it("blocks cross-org access for stores, products, inventory, and POs", async () => {
    const { org, adminUser } = await seedBase();

    const orgB = await prisma.organization.create({ data: { name: "Other Org" } });
    const baseUnitB = await prisma.unit.create({
      data: {
        organizationId: orgB.id,
        code: "each",
        labelRu: "each",
        labelKg: "each",
      },
    });
    const storeB = await prisma.store.create({
      data: {
        organizationId: orgB.id,
        name: "Other Store",
        code: "OTH",
        allowNegativeStock: false,
      },
    });
    const supplierB = await prisma.supplier.create({
      data: { organizationId: orgB.id, name: "Other Supplier" },
    });
    const productB = await prisma.product.create({
      data: {
        organizationId: orgB.id,
        supplierId: supplierB.id,
        sku: "OTH-1",
        name: "Other Product",
        unit: baseUnitB.code,
        baseUnitId: baseUnitB.id,
      },
    });
    const poB = await prisma.purchaseOrder.create({
      data: {
        organizationId: orgB.id,
        storeId: storeB.id,
        supplierId: supplierB.id,
        status: "DRAFT",
      },
    });
    await prisma.purchaseOrderLine.create({
      data: {
        purchaseOrderId: poB.id,
        productId: productB.id,
        qtyOrdered: 1,
      },
    });

    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });

    const stores = await caller.stores.list();
    expect(stores.find((store) => store.id === storeB.id)).toBeUndefined();

    const product = await caller.products.getById({ productId: productB.id });
    expect(product).toBeNull();

    await expect(
      caller.inventory.receive({
        storeId: storeB.id,
        productId: productB.id,
        qtyReceived: 1,
        idempotencyKey: "cross-org-receive",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const po = await caller.purchaseOrders.getById({ id: poB.id });
    expect(po).toBeNull();
  });
});
