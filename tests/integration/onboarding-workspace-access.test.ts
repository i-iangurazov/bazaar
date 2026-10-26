import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

(shouldRunDbTests ? describe : describe.skip)(
  "onboarding workspace existing permissions and progress",
  () => {
    beforeEach(resetDatabase);
    it.each(["managerUser", "staffUser", "cashierUser"] as const)(
      "rejects %s before reading or skipping progress",
      async (role) => {
        const f = await seedBase({ plan: "ENTERPRISE" });
        const caller = createTestCaller({ ...f[role], organizationId: f.org.id });
        await expect(caller.onboarding.get()).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(caller.onboarding.skipStep({ step: "catalog" })).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
        expect(await prisma.onboardingProgress.count()).toBe(0);
      },
    );
    it("derives administrator progress from persisted evidence and does not complete missing business steps", async () => {
      const f = await seedBase({ plan: "ENTERPRISE" });
      const caller = createTestCaller({ ...f.adminUser, organizationId: f.org.id });
      for (let i = 0; i < 2; i++) {
        const progress = await caller.onboarding.get();
        expect(progress.steps).toEqual({
          store: "pending",
          users: "completed",
          catalog: "pending",
          inventory: "pending",
          procurement: "pending",
          receive: "pending",
        });
        expect(progress.completedAt).toBeNull();
        expect(progress.stats).toMatchObject({
          productCount: 1,
          legalStoreCount: 0,
          movementCount: 0,
          purchaseOrderCount: 0,
        });
      }
      expect(await prisma.onboardingProgress.count()).toBe(1);
      expect(await prisma.stockMovement.count()).toBe(0);
      expect(await prisma.customerOrder.count()).toBe(0);
      expect(await prisma.purchaseOrder.count()).toBe(0);
    });
  },
);
