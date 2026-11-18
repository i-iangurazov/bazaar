import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { getSubscriptionQuote } from "@/server/billing/subscriptionQuotes";
import {
  activateSubscriptionEarlyAccess,
  findActiveSubscriptionEarlyAccess,
} from "@/server/billing/subscriptionEarlyAccess";
import { getBillingSummary } from "@/server/services/billing";
import {
  assertWithinLimits,
  getOrganizationPlan,
} from "@/server/services/planLimits";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

const future = () => new Date(Date.now() + 7 * 86_400_000);

describeDb("reviewed subscription early access", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("does not create early access without a reviewed authorization audit", async () => {
    const f = await seedBase({ plan: "BUSINESS" });
    await prisma.subscriptionContract.create({
      data: { organizationId: f.org.id, catalogVersion: "2026-11" },
    });
    await prisma.organization.update({
      where: { id: f.org.id },
      data: { subscriptionBillingMode: "SELF_SERVE", subscriptionStatus: "ACTIVE", trialEndsAt: null },
    });
    await expect(
      activateSubscriptionEarlyAccess({
        organizationId: f.org.id,
        invoiceId: randomUUID(),
        periodId: randomUUID(),
        actorId: f.adminUser.id,
        authorizationAuditId: randomUUID(),
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ message: "earlyAccessAuthorizationMissing" });
    const summary = await getBillingSummary({ organizationId: f.org.id });
    expect(summary?.subscriptionExtras.stores).toBe(0);
    expect(summary?.limits.maxStores).toBe(1);
    expect(await prisma.subscriptionEarlyAccess.count({ where: { organizationId: f.org.id } })).toBe(0);
  });

  it("uses the paid purchase snapshot for a fully evidenced future period only", async () => {
    const f = await seedBase({ plan: "BUSINESS" });
    // The real customer state has two stores before the grant. The capacity
    // trigger cannot evaluate a contract before it exists, so this fixture is
    // deliberately built in that order.
    await prisma.store.create({
      data: { organizationId: f.org.id, name: "Second store", code: "SECOND" },
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
    const quote = await getSubscriptionQuote(f.org.id, {
      plan: "BUSINESS",
      months: 1,
      action: "RENEW",
      extras: { stores: 1, productPacks: 0, userPacks: 0 },
    });
    const start = future();
    const end = new Date(start.getTime() + 30 * 86_400_000);
    const snapshot = {
      ...quote,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      cycleStartsAt: start.toISOString(),
      cycleEndsAt: end.toISOString(),
      anchorDay: start.getUTCDate(),
    };
    const invoice = await prisma.subscriptionInvoice.create({
      data: {
        organizationId: f.org.id,
        createdById: f.adminUser.id,
        idempotencyKey: randomUUID(),
        plan: "BUSINESS",
        amountMinor: snapshot.amountMinor,
        purchaseSnapshot: snapshot,
        status: "PAID",
        paidAt: new Date(),
        providerPaymentId: `synthetic-${randomUUID()}`,
        merchantId: "synthetic",
        isTest: false,
        termsVersion: "synthetic-early-access",
        termsUrl: "https://example.invalid/terms",
        sellerName: "Synthetic seller",
        expiresAt: new Date(snapshot.expiresAt),
      },
    });
    await prisma.subscriptionPaymentEvent.create({
      data: {
        invoiceId: invoice.id,
        deduplicationKey: `synthetic-paid-${invoice.id}`,
        source: "CALLBACK",
        state: "PAID",
        payloadDigest: "synthetic-digest",
      },
    });
    const period = await prisma.subscriptionPeriod.create({
      data: {
        organizationId: f.org.id,
        invoiceId: invoice.id,
        plan: "BUSINESS",
        startsAt: start,
        endsAt: end,
        purchaseSnapshot: snapshot,
      },
    });
    await prisma.organization.update({
      where: { id: f.org.id },
      data: { currentPeriodEndsAt: end },
    });
    const authorization = await prisma.auditLog.create({
      data: {
        organizationId: f.org.id,
        actorId: f.adminUser.id,
        action: "PLATFORM_BILLING_EARLY_ACTIVATION",
        entity: "Organization",
        entityId: f.org.id,
        before: { trialEndsAt: null },
        after: { paidPeriodId: period.id },
        requestId: `synthetic-early-access-${randomUUID()}`,
      },
    });

    const beforeGrant = await getOrganizationPlan(f.org.id);
    expect(beforeGrant.subscriptionExtras.stores).toBe(0);
    expect(beforeGrant.entitlements.limits.maxStores).toBe(1);

    const grant = await activateSubscriptionEarlyAccess({
      organizationId: f.org.id,
      invoiceId: invoice.id,
      periodId: period.id,
      actorId: f.adminUser.id,
      authorizationAuditId: authorization.id,
      requestId: `synthetic-grant-${randomUUID()}`,
    });
    expect(grant.endsAt).toEqual(start);
    expect(await findActiveSubscriptionEarlyAccess(f.org.id, prisma, new Date(start.getTime() - 1))).not.toBeNull();
    expect(await findActiveSubscriptionEarlyAccess(f.org.id, prisma, start)).toBeNull();

    const org = await getOrganizationPlan(f.org.id);
    expect(org.plan).toBe("BUSINESS");
    expect(org.trialOffer).toBeNull();
    expect(org.subscriptionExtras.stores).toBe(1);
    expect(org.entitlements.limits).toEqual({ maxStores: 2, maxProducts: 5000, maxActiveUsers: 5 });
    expect(org.activeSubscriptionPeriod).toBeNull();

    const summary = await getBillingSummary({ organizationId: f.org.id });
    expect(summary).toMatchObject({
      plan: "BUSINESS",
      trialActive: false,
      hasAccess: true,
      limitState: "OK",
      subscriptionExtras: { stores: 1, productPacks: 0, userPacks: 0 },
      limits: { maxStores: 2, maxProducts: 5000, maxUsers: 5 },
      limitExceeded: { stores: false, users: false, products: false },
      currentPeriodEndsAt: end,
    });
    await expect(assertWithinLimits({ organizationId: f.org.id, kind: "stores" })).rejects.toThrow();
    await expect(
      prisma.store.create({
        data: { organizationId: f.org.id, name: "Third store", code: "THIRD" },
      }),
    ).rejects.toThrow("subscriptionCapacityExceeded");
    await expect(
      prisma.subscriptionEarlyAccess.create({
        data: {
          organizationId: f.org.id,
          invoiceId: invoice.id,
          periodId: period.id,
          startsAt: new Date(),
          endsAt: start,
          purchaseSnapshot: { ...snapshot, plan: "STARTER" },
        },
      }),
    ).rejects.toThrow("earlyAccessPeriodMismatch");

    const replay = await activateSubscriptionEarlyAccess({
      organizationId: f.org.id,
      invoiceId: invoice.id,
      periodId: period.id,
      actorId: f.adminUser.id,
      authorizationAuditId: authorization.id,
      requestId: `synthetic-replay-${randomUUID()}`,
    });
    expect(replay.id).toBe(grant.id);
    expect(await prisma.subscriptionEarlyAccess.count({ where: { organizationId: f.org.id } })).toBe(1);
    expect((await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).amountMinor).toBe(snapshot.amountMinor);
    expect((await prisma.subscriptionPeriod.findUniqueOrThrow({ where: { id: period.id } })).startsAt).toEqual(start);
  });
});
