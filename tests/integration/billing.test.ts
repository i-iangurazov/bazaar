import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("billing", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns fixed KGS price, limits and features", async () => {
    const previousStarter = process.env.PLAN_PRICE_STARTER_KGS;
    const previousBusiness = process.env.PLAN_PRICE_BUSINESS_KGS;
    const previousEnterprise = process.env.PLAN_PRICE_ENTERPRISE_KGS;

    process.env.PLAN_PRICE_STARTER_KGS = "";
    process.env.PLAN_PRICE_BUSINESS_KGS = "";
    process.env.PLAN_PRICE_ENTERPRISE_KGS = "";

    try {
      const { org, adminUser } = await seedBase({ plan: "STARTER" });
      const caller = createTestCaller({
        id: adminUser.id,
        email: adminUser.email,
        role: adminUser.role,
        organizationId: org.id,
        isOrgOwner: true,
      });

      const summary = await caller.billing.get();
      if (!summary) {
        throw new Error("billing summary is null");
      }

      expect(summary.planTier).toBe("STARTER");
      expect(summary.monthlyPriceKgs).toBe(1750);
      expect(summary.limits).toMatchObject({
        maxStores: 1,
        maxUsers: 5,
        maxProducts: 1000,
      });
      expect(
        Object.fromEntries(
          summary.planCatalog.map((plan) => [plan.planTier, plan.limits.maxStores]),
        ),
      ).toEqual({
        STARTER: 1,
        BUSINESS: 5,
        ENTERPRISE: 15,
      });
      expect(summary.featureFlags.exports).toBe(false);
      expect(summary.featureFlags.analytics).toBe(false);
      expect(summary.featureFlags.priceTags).toBe(true);
    } finally {
      process.env.PLAN_PRICE_STARTER_KGS = previousStarter;
      process.env.PLAN_PRICE_BUSINESS_KGS = previousBusiness;
      process.env.PLAN_PRICE_ENTERPRISE_KGS = previousEnterprise;
    }
  });

  it("lets platform owners read subscription control data", async () => {
    const { org, adminUser } = await seedBase({ plan: "ENTERPRISE" });
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isPlatformOwner: true,
    });

    await expect(caller.platformOwner.summary()).resolves.toMatchObject({
      organizationsTotal: expect.any(Number),
      activeByTier: expect.objectContaining({
        STARTER: expect.any(Number),
        BUSINESS: expect.any(Number),
        ENTERPRISE: expect.any(Number),
      }),
    });
    await expect(caller.platformOwner.listOrganizations()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: org.id,
          plan: "ENTERPRISE",
          subscriptionStatus: "ACTIVE",
        }),
      ]),
    );
  });

  it("does not let an expired trial block an active paid or approved subscription", async () => {
    const { org, adminUser, baseUnit } = await seedBase({ plan: "ENTERPRISE" });
    const past = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await prisma.organization.update({
      where: { id: org.id },
      data: {
        plan: "ENTERPRISE",
        subscriptionStatus: "ACTIVE",
        trialEndsAt: past,
        currentPeriodEndsAt: future,
      },
    });

    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
    });

    const summary = await caller.billing.get();
    expect(summary?.trialExpired).toBe(false);
    expect(summary?.subscriptionActive).toBe(true);
    await expect(
      caller.products.create({
        sku: "ACTIVE-PAID-1",
        name: "Active Paid Product",
        baseUnitId: baseUnit.id,
        basePriceKgs: 100,
        categories: [],
      }),
    ).resolves.toMatchObject({ name: "Active Paid Product" });
  });

  it("blocks an organization when the trial and paid period are both expired", async () => {
    const { org, adminUser, baseUnit } = await seedBase({ plan: "STARTER" });
    const past = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

    await prisma.organization.update({
      where: { id: org.id },
      data: {
        subscriptionStatus: "ACTIVE",
        trialEndsAt: past,
        currentPeriodEndsAt: past,
      },
    });

    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
    });

    const summary = await caller.billing.get();
    expect(summary?.trialExpired).toBe(true);
    expect(summary?.hasAccess).toBe(false);
    await expect(
      caller.products.create({
        sku: "EXPIRED-TRIAL-1",
        name: "Expired Trial Product",
        baseUnitId: baseUnit.id,
        basePriceKgs: 100,
        categories: [],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "trialExpired" });
  });

  it("keeps active trial access without a paid subscription", async () => {
    const { org, adminUser, baseUnit } = await seedBase({ plan: "STARTER" });
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await prisma.organization.update({
      where: { id: org.id },
      data: {
        subscriptionStatus: "ACTIVE",
        trialEndsAt: future,
        currentPeriodEndsAt: future,
      },
    });

    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
    });

    const summary = await caller.billing.get();
    expect(summary?.trialActive).toBe(true);
    expect(summary?.trialExpired).toBe(false);
    await expect(
      caller.products.create({
        sku: "ACTIVE-TRIAL-1",
        name: "Active Trial Product",
        baseUnitId: baseUnit.id,
        basePriceKgs: 100,
        categories: [],
      }),
    ).resolves.toMatchObject({ name: "Active Trial Product" });
  });

  it("blocks inactive paid subscription statuses", async () => {
    const { org, adminUser, baseUnit } = await seedBase({ plan: "BUSINESS" });
    const past = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

    await prisma.organization.update({
      where: { id: org.id },
      data: {
        plan: "BUSINESS",
        subscriptionStatus: "PAST_DUE",
        trialEndsAt: past,
        currentPeriodEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
    });

    await expect(
      caller.products.create({
        sku: "PAST-DUE-1",
        name: "Past Due Product",
        baseUnitId: baseUnit.id,
        basePriceKgs: 100,
        categories: [],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "subscriptionInactive" });

    await prisma.organization.update({
      where: { id: org.id },
      data: {
        subscriptionStatus: "ACTIVE",
        trialEndsAt: past,
        currentPeriodEndsAt: past,
      },
    });

    const ownerApprovedSummary = await caller.billing.get();
    expect(ownerApprovedSummary?.subscriptionActive).toBe(true);
    expect(ownerApprovedSummary?.trialExpired).toBe(false);
    await expect(
      caller.products.create({
        sku: "OWNER-APPROVED-PAID-1",
        name: "Owner Approved Paid Product",
        baseUnitId: baseUnit.id,
        basePriceKgs: 100,
        categories: [],
      }),
    ).resolves.toMatchObject({ name: "Owner Approved Paid Product" });

    await prisma.organization.update({
      where: { id: org.id },
      data: {
        subscriptionStatus: "CANCELED",
        trialEndsAt: past,
        currentPeriodEndsAt: past,
      },
    });

    await expect(
      caller.products.create({
        sku: "EXPIRED-PAID-1",
        name: "Expired Paid Product",
        baseUnitId: baseUnit.id,
        basePriceKgs: 100,
        categories: [],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "subscriptionInactive" });
  });
});
