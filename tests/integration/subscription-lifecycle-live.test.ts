import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_SUBSCRIPTION_EXTRAS,
  type SubscriptionExtras,
} from "@/lib/billing/subscriptionPricing";
import type { PlanCode } from "@/lib/billing/plans";
import { prisma } from "@/server/db/prisma";
import { handleGoPayNotification } from "@/server/billing/goPayWebhook";
import { getOrganizationPlan } from "@/server/services/planLimits";
import {
  getSubscriptionUsage,
  reserveSubscriptionUsage,
  settleSubscriptionUsage,
  startSubscriptionUsage,
} from "@/server/billing/subscriptionUsage";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import {
  GOPAY_FIXTURE_API_KEY,
  GOPAY_FIXTURE_API_SECRET,
  GOPAY_FIXTURE_WEBHOOK_SECRET,
  goPayProtocolFixture,
} from "../helpers/gopayProtocolFixture";

(shouldRunDbTests ? describe : describe.skip)(
  "GoPay subscription lifecycle with prepaid future terms",
  () => {
    let f: Awaited<ReturnType<typeof seedBase>>;
    let caller: ReturnType<typeof createTestCaller>;
    let provider: ReturnType<typeof goPayProtocolFixture>;
    let reference: Date;

    beforeEach(async () => {
      await resetDatabase();
      reference = new Date();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(reference);
      for (const [key, value] of Object.entries({
        BILLING_PAYMENT_PROVIDER: "gopay",
        BILLING_PAYMENTS_MODE: "sandbox",
        GOPAY_API_KEY: GOPAY_FIXTURE_API_KEY,
        GOPAY_API_SECRET: GOPAY_FIXTURE_API_SECRET,
        GOPAY_WEBHOOK_SECRET: GOPAY_FIXTURE_WEBHOOK_SECRET,
        BILLING_PUBLIC_URL: "http://localhost:3120",
        BILLING_TERMS_URL: "http://localhost:3120/terms",
        BILLING_TERMS_VERSION: "synthetic-lifecycle-v1",
        BILLING_SELLER_NAME: "Synthetic lifecycle seller",
        NEXTAUTH_SECRET: "synthetic-lifecycle-quote-key",
        HARDENING_EXTERNAL_PROVIDER_MODE: "sandbox",
        VERCEL_ENV: "development",
      }))
        vi.stubEnv(key, value);
      f = await seedBase({ plan: "STARTER" });
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
          trialEndsAt: null,
          currentPeriodEndsAt: null,
        },
      });
      caller = createTestCaller({ ...f.adminUser, organizationId: f.org.id });
      provider = goPayProtocolFixture();
      vi.stubGlobal("fetch", provider.transport);
    });
    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    });

    async function buy(
      plan: PlanCode,
      months: 1 | 6 | 12 = 12,
      extras: SubscriptionExtras = EMPTY_SUBSCRIPTION_EXTRAS,
      action: "RENEW" | "CHANGE" = "RENEW",
    ) {
      const quote = await caller.billing.payments.quote({ plan, months, extras, action });
      const invoice = await caller.billing.payments.checkout({
        plan,
        months: quote.months,
        extras,
        action,
        quoteToken: quote.quoteToken,
        expectedAmountMinor: quote.amountMinor,
        expectedProvider: "GOPAY",
        termsVersion: "synthetic-lifecycle-v1",
        acceptedTerms: true,
        locale: "ru",
        idempotencyKey: randomUUID(),
      });
      const saved = await prisma.subscriptionInvoice.findUniqueOrThrow({
        where: { id: invoice.id },
      });
      const payment = provider.payments.get(saved.providerOrderId!)!;
      const committed = provider.commit(payment);
      expect((await handleGoPayNotification(provider.notification(committed))).status).toBe(200);
      return { quote, invoice, committed };
    }

    async function startExistingYear() {
      // Keep the source period genuinely in the past relative to PostgreSQL's
      // clock as well as the app clock; scheduled SQL guards are real here.
      const started = new Date(reference);
      started.setUTCMonth(started.getUTCMonth() - 6);
      vi.setSystemTime(started);
      const first = await buy("STARTER");
      vi.setSystemTime(reference);
      return first;
    }

    it("upgrades the current term and its store capacity without shortening or rewriting the compatible prepaid tail", async () => {
      const original = await startExistingYear();
      const future = await buy("BUSINESS", 12, { stores: 1, productPacks: 0, userPacks: 0 });
      const futureInvoiceBefore = await prisma.subscriptionInvoice.findUniqueOrThrow({
        where: { id: future.invoice.id },
      });
      const futurePeriodBefore = await prisma.subscriptionPeriod.findUniqueOrThrow({
        where: { invoiceId: future.invoice.id },
      });
      const tail = new Date(future.quote.endsAt);
      const usage = await reserveSubscriptionUsage({
        organizationId: f.org.id,
        resource: "ai",
        operationKey: "before-upgrade",
        units: 100,
      });
      await startSubscriptionUsage(usage);
      await settleSubscriptionUsage(usage, true);
      const beforeUsage = (await getSubscriptionUsage(f.org.id)).find(
        (row) => row.resource === "ai",
      )!;
      expect(beforeUsage).toMatchObject({ used: 100, remaining: 0 });

      const upgrade = await buy("BUSINESS", 12, EMPTY_SUBSCRIPTION_EXTRAS, "CHANGE");
      expect(upgrade.quote.endsAt).toBe(original.quote.endsAt);
      expect(upgrade.quote.amountMinor).toBeGreaterThan(0);
      expect(
        (await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } }))
          .currentPeriodEndsAt,
      ).toEqual(tail);
      expect(
        (await getSubscriptionUsage(f.org.id)).find((row) => row.resource === "ai"),
      ).toMatchObject({ used: 100, remaining: 200, resetsAt: beforeUsage.resetsAt });

      const extra = await buy(
        "BUSINESS",
        12,
        { stores: 1, productPacks: 0, userPacks: 0 },
        "CHANGE",
      );
      expect(extra.quote.endsAt).toBe(original.quote.endsAt);
      await handleGoPayNotification(provider.notification(extra.committed));
      expect(
        await prisma.subscriptionPeriod.count({ where: { invoiceId: extra.invoice.id } }),
      ).toBe(1);
      const effective = await getOrganizationPlan(f.org.id);
      expect(effective.entitlements.limits.maxStores).toBe(2);
      expect(effective.currentPeriodEndsAt).toEqual(tail);
      expect((await caller.billing.payments.get()).scheduledSubscription).toMatchObject({
        plan: "BUSINESS",
        startsAt: futurePeriodBefore.startsAt,
        endsAt: futurePeriodBefore.endsAt,
        extras: { stores: 1, productPacks: 0, userPacks: 0 },
      });
      expect(
        await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: future.invoice.id } }),
      ).toEqual(futureInvoiceBefore);
      expect(
        await prisma.subscriptionPeriod.findUniqueOrThrow({
          where: { invoiceId: future.invoice.id },
        }),
      ).toEqual(futurePeriodBefore);
      await prisma.store.create({
        data: { organizationId: f.org.id, name: "Purchased second store", code: "SECOND" },
      });
      await expect(
        prisma.store.create({
          data: { organizationId: f.org.id, name: "Unpaid third", code: "THIRD" },
        }),
      ).rejects.toThrow("subscriptionCapacityExceeded");
      expect(
        (await getSubscriptionUsage(f.org.id)).find((row) => row.resource === "ai")?.used,
      ).toBe(100);
    });

    it("rejects a capacity promise that the prepaid next period cannot keep before creating a payment", async () => {
      await startExistingYear();
      const future = await buy("BUSINESS");
      const networkCalls = provider.transport.mock.calls.length;
      await expect(
        caller.billing.payments.quote({
          plan: "BUSINESS",
          months: 12,
          action: "CHANGE",
          extras: { stores: 1, productPacks: 0, userPacks: 0 },
        }),
      ).rejects.toThrow("billingScheduledChangeExists");
      expect(provider.transport).toHaveBeenCalledTimes(networkCalls);
      expect(await prisma.subscriptionInvoice.count()).toBe(2);
      expect(
        (await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } }))
          .currentPeriodEndsAt,
      ).toEqual(new Date(future.quote.endsAt));
      expect((await getOrganizationPlan(f.org.id)).plan).toBe("STARTER");
    });

    it("resets the AI allowance monthly inside an annual purchase and preserves the last bucket during paid grace", async () => {
      const first = await buy("BUSINESS");
      const consume = async (key: string) => {
        const lease = await reserveSubscriptionUsage({
          organizationId: f.org.id,
          resource: "ai",
          operationKey: key,
          units: 300,
        });
        await startSubscriptionUsage(lease);
        await settleSubscriptionUsage(lease, true);
      };
      await consume("month-one");
      const firstUsage = (await getSubscriptionUsage(f.org.id)).find(
        (row) => row.resource === "ai",
      )!;
      expect(firstUsage.remaining).toBe(0);
      expect(firstUsage.resetsAt!.getTime()).toBeLessThan(new Date(first.quote.endsAt).getTime());
      vi.setSystemTime(firstUsage.resetsAt!);
      expect(
        (await getSubscriptionUsage(f.org.id)).find((row) => row.resource === "ai"),
      ).toMatchObject({ used: 0, remaining: 300 });
      await consume("month-two");
      expect(
        await prisma.subscriptionUsageBucket.count({
          where: { organizationId: f.org.id, resource: "ai" },
        }),
      ).toBe(2);

      const periodEnd = new Date(first.quote.endsAt);
      vi.setSystemTime(new Date(periodEnd.getTime() - 1));
      await consume("last-paid-month");
      vi.setSystemTime(new Date(periodEnd.getTime() + 1));
      expect(await caller.billing.get()).toMatchObject({ hasAccess: true, inGrace: true });
      expect(
        (await getSubscriptionUsage(f.org.id)).find((row) => row.resource === "ai"),
      ).toMatchObject({ used: 300, remaining: 0, resetsAt: periodEnd });
      await expect(
        reserveSubscriptionUsage({
          organizationId: f.org.id,
          resource: "ai",
          operationKey: "grace-extra",
        }),
      ).rejects.toThrow("billingUsageLimitReached");
      vi.setSystemTime(new Date(periodEnd.getTime() + 7 * 86_400_000));
      expect(await caller.billing.get()).toMatchObject({ hasAccess: false, inGrace: false });
    });
  },
);
