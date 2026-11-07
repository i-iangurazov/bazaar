import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { createContractTerms } from "@/server/billing/contractTerms";
import { getSubscriptionUsage } from "@/server/billing/subscriptionUsage";
import { calculateSubscriptionQuote } from "@/server/billing/subscriptionQuotes";
import {
  assertMarketplaceFeature,
  authorizeMarketplaceExchange,
  claimMarketplaceChannel,
} from "@/server/services/marketplaceSubscription";
import { updateMMarketConnection, requestMMarketExport } from "@/server/services/mMarket";
import { updateBakaiStoreSettings } from "@/server/services/bakaiStore";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const modern = async (plan: "STARTER" | "BUSINESS" | "ENTERPRISE" = "ENTERPRISE") => {
  const f = await seedBase({ plan });
  await prisma.user.updateMany({
    where: { organizationId: f.org.id, id: { not: f.adminUser.id } },
    data: { isActive: false },
  });
  await prisma.organization.update({
    where: { id: f.org.id },
    data: { currentPeriodEndsAt: new Date(Date.now() + 30 * 86400000) },
  });
  await prisma.subscriptionContract.create({
    data: {
      organizationId: f.org.id,
      catalogVersion: "2026-11",
      termsSnapshot: createContractTerms("2026-11"),
    },
  });
  return f;
};

(shouldRunDbTests ? describe : describe.skip)(
  "marketplace subscription boundaries on PostgreSQL",
  () => {
    beforeEach(resetDatabase);
    it("keeps file-only Bakai settings on Business and rejects live API before connection work", async () => {
      const f = await modern("BUSINESS");
      await assertMarketplaceFeature(f.org.id, "FILE");
      await updateBakaiStoreSettings({
        organizationId: f.org.id,
        actorId: f.adminUser.id,
        requestId: randomUUID(),
        connectionMode: "TEMPLATE",
      });
      await expect(
        updateBakaiStoreSettings({
          organizationId: f.org.id,
          actorId: f.adminUser.id,
          requestId: randomUUID(),
          connectionMode: "API",
          apiToken: "synthetic-test-token",
        }),
      ).rejects.toThrow("featureLockedPlan");
      await expect(
        prisma.mMarketIntegration.create({
          data: { orgId: f.org.id, apiTokenEncrypted: "synthetic-not-a-real-credential" },
        }),
      ).rejects.toThrow();
      expect(await prisma.subscriptionUsageBucket.count()).toBe(0);
    });
    it("does not let Starter obtain even the file export module", async () => {
      const f = await modern("STARTER");
      await expect(assertMarketplaceFeature(f.org.id, "FILE")).rejects.toThrow("featureLockedPlan");
      await expect(claimMarketplaceChannel(f.org.id, "MMARKET")).rejects.toThrow(
        "featureLockedPlan",
      );
      expect(await prisma.subscriptionUsageBucket.count()).toBe(0);
    });
    it("serializes concurrent provider selection and also protects raw integration inserts", async () => {
      const f = await modern();
      const results = await Promise.allSettled([
        prisma.mMarketIntegration.create({
          data: { orgId: f.org.id, apiTokenEncrypted: "synthetic-one" },
        }),
        prisma.oMarketIntegration.create({
          data: { orgId: f.org.id, apiTokenEncrypted: "synthetic-two" },
        }),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const contract = await prisma.subscriptionContract.findUniqueOrThrow({
        where: { organizationId: f.org.id },
      });
      expect(["MMARKET", "OMARKET"]).toContain(contract.selectedMarketplaceChannel);
      expect(
        (await prisma.mMarketIntegration.count()) + (await prisma.oMarketIntegration.count()),
      ).toBe(1);
    });
    it("keeps the old channel reserved until its token is removed and running work finishes", async () => {
      const f = await modern();
      await prisma.mMarketIntegration.create({
        data: { orgId: f.org.id, apiTokenEncrypted: "synthetic-one" },
      });
      const job = await prisma.mMarketExportJob.create({
        data: {
          orgId: f.org.id,
          requestedById: f.adminUser.id,
          environment: "DEV",
          status: "RUNNING",
          requestIdempotencyKey: randomUUID(),
        },
      });
      await updateMMarketConnection({
        organizationId: f.org.id,
        actorId: f.adminUser.id,
        requestId: randomUUID(),
        environment: "DEV",
        clearToken: true,
      });
      await expect(claimMarketplaceChannel(f.org.id, "OMARKET")).rejects.toThrow(
        "billingMarketplaceChannelInUse",
      );
      await prisma.mMarketExportJob.update({ where: { id: job.id }, data: { status: "DONE" } });
      await claimMarketplaceChannel(f.org.id, "OMARKET");
      expect(
        (
          await prisma.subscriptionContract.findUniqueOrThrow({
            where: { organizationId: f.org.id },
          })
        ).selectedMarketplaceChannel,
      ).toBe("OMARKET");
    });
    it("does not consume any daily allowance for a failed local preflight", async () => {
      const f = await modern();
      await expect(
        requestMMarketExport({
          organizationId: f.org.id,
          actorId: f.adminUser.id,
          requestId: randomUUID(),
        }),
      ).rejects.toThrow("mMarketNotConfigured");
      expect(await prisma.subscriptionUsageBucket.count()).toBe(0);
    });
    it("reserves both daily ceilings atomically and does not double-count a replayed job", async () => {
      const f = await modern();
      const first = {
        organizationId: f.org.id,
        channel: "MMARKET" as const,
        jobId: randomUUID(),
        full: true,
      };
      await authorizeMarketplaceExchange(first);
      await expect(authorizeMarketplaceExchange(first)).rejects.toThrow(
        "billingUsageAlreadyCompleted",
      );
      await expect(authorizeMarketplaceExchange({ ...first, jobId: randomUUID() })).rejects.toThrow(
        "billingUsageLimitReached",
      );
      const usage = await getSubscriptionUsage(f.org.id);
      expect(usage.find((row) => row.resource === "marketplaceRunsDaily")).toMatchObject({
        used: 1,
        reserved: 0,
      });
      expect(usage.find((row) => row.resource === "marketplaceFullRunsDaily")).toMatchObject({
        used: 1,
        reserved: 0,
      });
    });
    it("admits exactly 24 stock/price exchange starts per business day", async () => {
      const f = await modern();
      for (let index = 0; index < 24; index++)
        await authorizeMarketplaceExchange({
          organizationId: f.org.id,
          channel: "OMARKET",
          jobId: randomUUID(),
          full: false,
        });
      await expect(
        authorizeMarketplaceExchange({
          organizationId: f.org.id,
          channel: "OMARKET",
          jobId: randomUUID(),
          full: false,
        }),
      ).rejects.toThrow("billingUsageLimitReached");
      expect(
        (await getSubscriptionUsage(f.org.id)).find(
          (row) => row.resource === "marketplaceRunsDaily",
        ),
      ).toMatchObject({ used: 24, reserved: 0, remaining: 0 });
    });
    it("preserves all legacy provider connections without imposing new quota or selection", async () => {
      const f = await seedBase({ plan: "BUSINESS" });
      await prisma.subscriptionContract.create({ data: { organizationId: f.org.id } });
      await prisma.mMarketIntegration.create({
        data: { orgId: f.org.id, apiTokenEncrypted: "synthetic-one" },
      });
      await prisma.oMarketIntegration.create({
        data: { orgId: f.org.id, apiTokenEncrypted: "synthetic-two" },
      });
      await prisma.bakaiStoreIntegration.create({
        data: { orgId: f.org.id, apiTokenEncrypted: "synthetic-three", connectionMode: "API" },
      });
      await authorizeMarketplaceExchange({
        organizationId: f.org.id,
        channel: "MMARKET",
        jobId: randomUUID(),
        full: true,
      });
      await authorizeMarketplaceExchange({
        organizationId: f.org.id,
        channel: "OMARKET",
        jobId: randomUUID(),
        full: true,
      });
      expect(await prisma.subscriptionUsageBucket.count()).toBe(0);
      expect(
        (
          await prisma.subscriptionContract.findUniqueOrThrow({
            where: { organizationId: f.org.id },
          })
        ).selectedMarketplaceChannel,
      ).toBeNull();
    });
    it("prevents first channel activation while a lower-feature future invoice is pending", async () => {
      const f = await modern();
      await prisma.organization.update({
        where: { id: f.org.id },
        data: { subscriptionBillingMode: "SELF_SERVE" },
      });
      const purchase = await calculateSubscriptionQuote(f.org.id, {
        plan: "STARTER",
        months: 1,
        extras: { stores: 0, productPacks: 0, userPacks: 0 },
        action: "RENEW",
      });
      await prisma.subscriptionInvoice.create({
        data: {
          organizationId: f.org.id,
          createdById: f.adminUser.id,
          idempotencyKey: randomUUID(),
          pendingSlot: f.org.id,
          plan: "STARTER",
          amountMinor: purchase.amountMinor,
          merchantId: "synthetic",
          isTest: true,
          termsVersion: "synthetic-v1",
          termsUrl: "https://example.invalid/terms",
          sellerName: "Synthetic test seller",
          purchaseSnapshot: purchase,
          expiresAt: new Date(Date.now() + 15 * 60000),
        },
      });
      await expect(claimMarketplaceChannel(f.org.id, "MMARKET")).rejects.toThrow();
      await expect(
        prisma.mMarketIntegration.create({
          data: { orgId: f.org.id, apiTokenEncrypted: "synthetic-not-a-real-credential" },
        }),
      ).rejects.toThrow();
      expect(await prisma.mMarketIntegration.count()).toBe(0);
    });
  },
);
