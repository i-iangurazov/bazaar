import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/server/db/prisma";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { createTestCaller } from "../helpers/context";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("tenant isolation and signup", () => {
  const getTokenFromPath = (path?: string | null) => path?.split("/").pop() ?? null;

  beforeEach(async () => {
    await resetDatabase();
  });

  it("blocks open signup when invite-only mode is enabled", async () => {
    vi.stubEnv("SIGNUP_MODE", "invite_only");
    const caller = createTestCaller();

    await expect(
      caller.publicAuth.signup({
        email: "blocked-signup@test.local",
        password: "Password123!",
        name: "Blocked User",
        preferredLocale: "ru",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "signupInviteOnly" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates org/store/admin on signup in open mode", async () => {
    vi.stubEnv("SIGNUP_MODE", "open");
    const caller = createTestCaller();

    const signup = await caller.publicAuth.signup({
      email: "owner@test.local",
      password: "Password123!",
      name: "Owner",
      preferredLocale: "ru",
    });

    expect(signup.sent).toBe(true);
    expect(Boolean(signup.verifyLink) || Boolean(signup.nextPath)).toBe(true);

    const userBeforeVerify = await prisma.user.findUnique({
      where: { email: "owner@test.local" },
    });
    expect(userBeforeVerify).not.toBeNull();
    expect(userBeforeVerify?.organizationId).toBeNull();
    if (signup.verifyLink) {
      expect(userBeforeVerify?.emailVerifiedAt).toBeNull();
    } else {
      expect(userBeforeVerify?.emailVerifiedAt).not.toBeNull();
    }

    let registrationToken: string | null = null;
    if (signup.verifyLink) {
      const verifyToken = getTokenFromPath(signup.verifyLink);
      expect(verifyToken).toBeTruthy();
      const verify = await caller.publicAuth.verifyEmail({ token: verifyToken ?? "" });
      expect(verify.verified).toBe(true);
      expect(verify.registrationToken).toBeTruthy();
      registrationToken = verify.registrationToken;
    } else {
      registrationToken = getTokenFromPath(signup.nextPath);
    }
    expect(registrationToken).toBeTruthy();

    const register = await caller.publicAuth.registerBusiness({
      token: registrationToken ?? "",
      orgName: "Owner Org",
      storeName: "First Store",
      storeCode: "OWN1",
      legalEntityType: "IP",
      inn: "1234567890",
      phone: "+996555010200",
    });
    expect(register.organizationId).toBeTruthy();
    expect(register.storeId).toBeTruthy();

    const org = await prisma.organization.findUnique({ where: { id: register.organizationId } });
    expect(org?.name).toBe("Owner Org");
    expect(org?.plan).toBe("STARTER");

    const store = await prisma.store.findUnique({ where: { id: register.storeId } });
    expect(store?.name).toBe("First Store");

    const user = await prisma.user.findUnique({ where: { id: register.userId } });
    expect(user?.email).toBe("owner@test.local");
    expect(user?.role).toBe("ADMIN");
    expect(user?.emailVerifiedAt).not.toBeNull();

    const anotherCaller = createTestCaller();
    const duplicate = await anotherCaller.publicAuth.signup({
      email: "owner@test.local",
      password: "Password123!",
      name: "Owner",
      preferredLocale: "ru",
    });
    expect(duplicate.sent).toBe(true);

    const usersWithEmail = await prisma.user.count({ where: { email: "owner@test.local" } });
    expect(usersWithEmail).toBe(1);
  });

  it("accepts invite within the correct organization", async () => {
    const { org, adminUser } = await seedBase({ plan: "BUSINESS" });
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

    expect(Boolean(accepted.verifyLink) || Boolean(accepted.user?.emailVerifiedAt)).toBe(true);
    const created = await prisma.user.findUnique({ where: { email: "new.user@test.local" } });
    expect(created?.organizationId).toBe(org.id);
    if (accepted.verifyLink) {
      expect(created?.emailVerifiedAt).toBeNull();
      const verifyToken = getTokenFromPath(accepted.verifyLink);
      expect(verifyToken).toBeTruthy();
      const verifyResult = await publicCaller.publicAuth.verifyEmail({ token: verifyToken ?? "" });
      expect(verifyResult.verified).toBe(true);
      expect(verifyResult.nextPath).toBe("/login");
    } else {
      expect(created?.emailVerifiedAt).not.toBeNull();
    }
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
