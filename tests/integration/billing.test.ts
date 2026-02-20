import { beforeEach, describe, expect, it } from "vitest";

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
        maxProducts: 100,
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
});
