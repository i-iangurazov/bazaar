import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/prisma";
import { getSubscriptionQuote } from "@/server/billing/subscriptionQuotes";
import { verifyPurchaseQuote } from "@/server/billing/purchaseSnapshot";
import {
  assertFeatureCanBeConfigured,
  assertWithinLimits,
  getOrganizationPlan,
} from "@/server/services/planLimits";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;
describeDb.each(["PENDING", "PAID"] as const)(
  "scheduled %s Starter protections on PostgreSQL",
  (status) => {
    let f: Awaited<ReturnType<typeof seedBase>>;
    let network: ReturnType<typeof vi.fn>;
    beforeEach(async () => {
      await resetDatabase();
      vi.stubEnv("NEXTAUTH_SECRET", "synthetic-scheduled-quote-test-secret");
      network = vi.fn(() => {
        throw new Error("Scheduled guard tests must not call any provider");
      });
      vi.stubGlobal("fetch", network);
      f = await seedBase({ plan: "ENTERPRISE" });
      await prisma.user.updateMany({
        where: { organizationId: f.org.id, id: { not: f.adminUser.id } },
        data: { isActive: false },
      });
      await prisma.subscriptionContract.create({
        data: { organizationId: f.org.id, catalogVersion: "2026-11" },
      });
      await prisma.organization.update({
        where: { id: f.org.id },
        data: {
          subscriptionBillingMode: "SELF_SERVE",
          subscriptionStatus: "ACTIVE",
          trialEndsAt: null,
          currentPeriodEndsAt: null,
        },
      });
      // A real signed Enterprise purchase gives two store slots now; a future
      // Starter has only one. The test cannot pass merely on today's base cap.
      const active = await getSubscriptionQuote(f.org.id, {
        plan: "ENTERPRISE",
        months: 1,
        action: "RENEW",
        extras: { stores: 1, productPacks: 0, userPacks: 0 },
      });
      const activeSnapshot = verifyPurchaseQuote(active.quoteToken, f.org.id);
      const first = await prisma.subscriptionInvoice.create({
        data: {
          organizationId: f.org.id,
          createdById: f.adminUser.id,
          idempotencyKey: randomUUID(),
          plan: "ENTERPRISE",
          amountMinor: activeSnapshot.amountMinor,
          purchaseSnapshot: activeSnapshot,
          status: "PAID",
          paidAt: new Date(),
          merchantId: "synthetic",
          isTest: true,
          termsVersion: "synthetic-guards",
          termsUrl: "https://example.invalid/offer",
          sellerName: "Synthetic seller",
          expiresAt: new Date(activeSnapshot.expiresAt),
        },
      });
      await prisma.subscriptionPeriod.create({
        data: {
          invoiceId: first.id,
          organizationId: f.org.id,
          plan: "ENTERPRISE",
          startsAt: new Date(activeSnapshot.startsAt),
          endsAt: new Date(activeSnapshot.endsAt),
          purchaseSnapshot: activeSnapshot,
        },
      });
      await prisma.organization.update({
        where: { id: f.org.id },
        data: { currentPeriodEndsAt: new Date(activeSnapshot.endsAt) },
      });
      expect((await getOrganizationPlan(f.org.id)).entitlements.limits.maxStores).toBe(2);
      const issued = await getSubscriptionQuote(f.org.id, {
        plan: "STARTER",
        months: 6,
        action: "RENEW",
        extras: { stores: 0, productPacks: 0, userPacks: 0 },
      });
      const snapshot = verifyPurchaseQuote(issued.quoteToken, f.org.id);
      const next = await prisma.subscriptionInvoice.create({
        data: {
          organizationId: f.org.id,
          createdById: f.adminUser.id,
          idempotencyKey: randomUUID(),
          pendingSlot: status === "PENDING" ? f.org.id : null,
          plan: snapshot.plan,
          amountMinor: snapshot.amountMinor,
          purchaseSnapshot: snapshot,
          status,
          paidAt: status === "PAID" ? new Date() : null,
          merchantId: "synthetic",
          isTest: true,
          termsVersion: "synthetic-guards",
          termsUrl: "https://example.invalid/offer",
          sellerName: "Synthetic seller",
          expiresAt: new Date(snapshot.expiresAt),
        },
      });
      if (status === "PAID")
        await prisma.subscriptionPeriod.create({
          data: {
            invoiceId: next.id,
            organizationId: f.org.id,
            plan: snapshot.plan,
            startsAt: new Date(snapshot.startsAt),
            endsAt: new Date(snapshot.endsAt),
            purchaseSnapshot: snapshot,
          },
        });
      // The current paid period remains Enterprise. Only incompatible new
      // configuration/capacity is constrained by the already agreed next period.
      expect((await getOrganizationPlan(f.org.id)).entitlements.features.expiryLots).toBe(true);
    });
    afterEach(() => {
      expect(network).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    });

    it("blocks a second store in the service and raw database despite two currently paid slots", async () => {
      await expect(
        assertWithinLimits({ organizationId: f.org.id, kind: "stores" }),
      ).rejects.toThrow();
      await expect(
        prisma.store.create({
          data: { organizationId: f.org.id, name: "Blocked second", code: "SECOND" },
        }),
      ).rejects.toThrow("subscriptionCapacityExceeded");
      expect(await prisma.store.count({ where: { organizationId: f.org.id } })).toBe(1);
    });
    it("permits the second active user but blocks activation of a third", async () => {
      await prisma.user.update({ where: { id: f.managerUser.id }, data: { isActive: true } });
      await expect(
        assertWithinLimits({ organizationId: f.org.id, kind: "users" }),
      ).rejects.toThrow();
      await expect(
        prisma.user.update({ where: { id: f.staffUser.id }, data: { isActive: true } }),
      ).rejects.toThrow("subscriptionCapacityExceeded");
      expect(await prisma.user.count({ where: { organizationId: f.org.id, isActive: true } })).toBe(
        2,
      );
    });
    it("permits exactly 1000 active cards and cannot bypass the boundary by reactivating an archived card", async () => {
      await prisma.product.createMany({
        data: Array.from({ length: 999 }, (_, index) => ({
          organizationId: f.org.id,
          sku: `QUOTA-${index}`,
          name: `Synthetic ${index}`,
          unit: f.baseUnit.code,
          baseUnitId: f.baseUnit.id,
        })),
      });
      await expect(
        assertWithinLimits({ organizationId: f.org.id, kind: "products" }),
      ).rejects.toThrow();
      await expect(
        prisma.product.create({
          data: {
            organizationId: f.org.id,
            sku: "OVER",
            name: "Blocked",
            unit: f.baseUnit.code,
            baseUnitId: f.baseUnit.id,
          },
        }),
      ).rejects.toThrow("subscriptionCapacityExceeded");
      const archived = await prisma.product.create({
        data: {
          organizationId: f.org.id,
          sku: "ARCHIVED",
          name: "Archived",
          unit: f.baseUnit.code,
          baseUnitId: f.baseUnit.id,
          isDeleted: true,
        },
      });
      await expect(
        prisma.product.update({ where: { id: archived.id }, data: { isDeleted: false } }),
      ).rejects.toThrow("subscriptionCapacityExceeded");
      expect(
        await prisma.product.count({ where: { organizationId: f.org.id, isDeleted: false } }),
      ).toBe(1000);
    }, 15000);
    it.each(["expiryLots", "bundles", "loyalty"] as const)(
      "blocks newly enabling %s in both application and raw database",
      async (feature) => {
        await expect(
          prisma.$transaction((tx) => assertFeatureCanBeConfigured(f.org.id, feature, tx)),
        ).rejects.toThrow("billingScheduledFeatureRestriction");
        if (feature === "expiryLots")
          await expect(
            prisma.store.update({ where: { id: f.store.id }, data: { trackExpiryLots: true } }),
          ).rejects.toThrow("billingScheduledFeatureRestriction");
        if (feature === "bundles")
          await expect(
            prisma.product.update({ where: { id: f.product.id }, data: { isBundle: true } }),
          ).rejects.toThrow("billingScheduledFeatureRestriction");
        if (feature === "loyalty") {
          const program = await prisma.loyaltyProgram.create({
            data: { organizationId: f.org.id, enabled: false },
          });
          await expect(
            prisma.loyaltyProgram.update({ where: { id: program.id }, data: { enabled: true } }),
          ).rejects.toThrow("billingScheduledFeatureRestriction");
        }
      },
    );
  },
);
