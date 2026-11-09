import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/prisma";
import { createAuthToken } from "@/server/services/authTokens";
import { registerBusinessFromToken } from "@/server/services/signup";
import { assertTrialActive, getOrganizationPlan } from "@/server/services/planLimits";
import { assertReadableFeature, assertProductExportAccess } from "@/server/billing/coreAccess";
import { getSubscriptionUsage } from "@/server/billing/subscriptionUsage";
import { handleGoPayNotification } from "@/server/billing/goPayWebhook";
import { createContractTerms } from "@/server/billing/contractTerms";
import { createTrialOffer } from "@/server/billing/trialPolicy";
import { LIFETIME_ORGANIZATION_IDS } from "@/server/billing/lifetimeOrganizations";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, shouldRunDbTests } from "../helpers/db";
import { GOPAY_FIXTURE_API_KEY, GOPAY_FIXTURE_API_SECRET, GOPAY_FIXTURE_WEBHOOK_SECRET,
  goPayProtocolFixture } from "../helpers/gopayProtocolFixture";

const now = new Date("2027-01-28T10:00:00Z");
const end = new Date("2027-02-04T10:00:00Z");
const describeDb = shouldRunDbTests ? describe : describe.skip;
async function identity() {
  return prisma.user.create({ data: { name: "Synthetic trial owner", email: `${randomUUID()}@example.invalid`,
    role: "ADMIN", passwordHash: "synthetic-unused", emailVerifiedAt: now } });
}
async function register(user: Awaited<ReturnType<typeof identity>>) {
  const token = await createAuthToken({ userId: user.id, email: user.email, purpose: "REGISTRATION", expiresInMinutes: 60 });
  return registerBusinessFromToken({ token: token.raw, orgName: "Synthetic seven day trial", storeName: "Trial store",
    storeCode: "TRIAL", requestId: randomUUID() });
}
describeDb("seven-day trial lifecycle on isolated PostgreSQL", () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
    vi.stubEnv("BILLING_SELF_SERVE_SIGNUP", "1"); vi.stubEnv("BILLING_PAYMENTS_MODE", "disabled");
    vi.stubEnv("TRIAL_DAYS", "14"); // Obsolete deployment settings cannot override the public offer.
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("starts exactly seven days at business registration without an active merchant", async () => {
    const user = await identity();
    expect(await prisma.organization.count()).toBe(0);
    const f = await register(user);
    const org = await getOrganizationPlan(f.organizationId);
    expect(org).toMatchObject({ plan: "STARTER", subscriptionBillingMode: "SELF_SERVE", trialEndsAt: end,
      currentPeriodEndsAt: end, trialOffer: { days: 7, previewPlan: "ENTERPRISE" } });
    expect(org.entitlements.limits).toEqual({ maxStores: 1, maxProducts: 1000, maxActiveUsers: 2 });
    expect(org.entitlements.features).toMatchObject({ analytics: true, imports: true, imageStudio: true,
      emailMarketing: false, marketplaces: false });
    expect(org.entitlements.usageLimits).toMatchObject({ ai: 100, images: 3, marketingEmails: 0 });
    const caller = createTestCaller({ ...user, organizationId: f.organizationId, isOrgOwner: true });
    expect(await caller.billing.payments.get()).toMatchObject({ available: false, canPurchase: false, billingMode: "SELF_SERVE" });
    await expect(assertTrialActive(f.organizationId)).resolves.toBeTruthy();
  });

  it("serializes concurrent onboarding tokens and never resets the same owner's trial", async () => {
    const user = await identity();
    const result = await Promise.allSettled([register(user), register(user)]);
    expect(result.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.organization.count()).toBe(1);
    expect(await prisma.store.count()).toBe(1);
    vi.setSystemTime(new Date(now.getTime() + 86_400_000));
    await expect(register(user)).rejects.toThrow("registrationAlreadyCompleted");
    expect((await prisma.organization.findFirstOrThrow()).trialEndsAt).toEqual(end);
  });

  it("enforces preview capacity and feature configuration in the database as well as the application", async () => {
    const f = await register(await identity());
    await expect(prisma.store.create({ data: { organizationId: f.organizationId, name: "Overflow", code: "OVER" } }))
      .rejects.toThrow("subscriptionCapacityExceeded");
    await prisma.user.create({ data: { organizationId: f.organizationId, email: "trial-staff@example.invalid", role: "STAFF",
      name: "Trial staff", passwordHash: "unused" } });
    await expect(prisma.user.create({ data: { organizationId: f.organizationId, email: "overflow@example.invalid", role: "STAFF",
      name: "Overflow", passwordHash: "unused" } })).rejects.toThrow("subscriptionCapacityExceeded");
    // Internal Monopolist features genuinely work, not just an enabled button.
    await prisma.$executeRaw`SELECT "assertSubscriptionFeatureConfiguration"(${f.organizationId}, 'loyalty')`;
    await prisma.$executeRaw`SELECT "assertSubscriptionFeatureConfiguration"(${f.organizationId}, 'bundles')`;
    await expect(prisma.$executeRaw`SELECT "assertSubscriptionFeatureConfiguration"(${f.organizationId}, 'ownSender')`)
      .rejects.toThrow("featureLockedPlan");
  });

  it("freezes the offer and ends vendor allowances at the actual trial boundary", async () => {
    const f = await register(await identity());
    const usage = await getSubscriptionUsage(f.organizationId);
    expect(usage.find(row => row.resource === "ai")).toMatchObject({ limit: 100, resetsAt: end });
    expect(usage.find(row => row.resource === "images")).toMatchObject({ limit: 3, resetsAt: end });
    await expect(prisma.subscriptionContract.update({ where: { organizationId: f.organizationId }, data: { trialOffer: {} } }))
      .rejects.toThrow("Trial offer is immutable");
  });

  it("expires without paid grace, blocks mutations for every role and retains history, billing and owner export", async () => {
    const user = await identity(); const f = await register(user);
    const before = await prisma.organization.findUniqueOrThrow({ where: { id: f.organizationId } });
    const unit = await prisma.unit.findFirstOrThrow({ where: { organizationId: f.organizationId } });
    vi.setSystemTime(new Date(end.getTime() + 1));
    await expect(assertTrialActive(f.organizationId)).rejects.toThrow("trialExpired");
    for (const role of ["ADMIN", "MANAGER", "STAFF", "CASHIER"] as const) {
      const caller = createTestCaller({ ...user, role, organizationId: f.organizationId, isOrgOwner: role === "ADMIN" });
      await expect(caller.products.create({ idempotencyKey: randomUUID(), sku: "EXPIRED", name: "Expired", baseUnitId: unit.id }))
        .rejects.toHaveProperty("code", "FORBIDDEN");
    }
    await expect(assertReadableFeature(f.organizationId, "analytics")).resolves.toBeTruthy();
    await expect(assertProductExportAccess({ organizationId: f.organizationId, actorId: user.id })).resolves.toBeUndefined();
    const caller = createTestCaller({ ...user, organizationId: f.organizationId, isOrgOwner: true });
    expect(await caller.billing.get()).toMatchObject({ trialExpired: true, hasAccess: false, inGrace: false });
    expect(await caller.billing.payments.get()).toMatchObject({ billingMode: "SELF_SERVE", available: false });
    expect(await prisma.organization.findUniqueOrThrow({ where: { id: f.organizationId } })).toEqual(before);
  });

  it.each(["STARTER", "BUSINESS"] as const)("converts an early GoPay purchase of %s without losing trial days or double-granting", async plan => {
    const user = await identity(); const f = await register(user);
    for (const [key, value] of Object.entries({ BILLING_PAYMENT_PROVIDER: "gopay", BILLING_PAYMENTS_MODE: "sandbox",
      GOPAY_API_KEY: GOPAY_FIXTURE_API_KEY, GOPAY_API_SECRET: GOPAY_FIXTURE_API_SECRET,
      GOPAY_WEBHOOK_SECRET: GOPAY_FIXTURE_WEBHOOK_SECRET, BILLING_PUBLIC_URL: "http://localhost:3120",
      BILLING_TERMS_URL: "http://localhost:3120/terms", BILLING_TERMS_VERSION: "trial-qa",
      BILLING_SELLER_NAME: "Synthetic trial seller", HARDENING_EXTERNAL_PROVIDER_MODE: "sandbox", VERCEL_ENV: "development" }))
      vi.stubEnv(key, value);
    const fixture = goPayProtocolFixture(); vi.stubGlobal("fetch", fixture.transport);
    const caller = createTestCaller({ ...user, organizationId: f.organizationId, isOrgOwner: true });
    const quote = await caller.billing.payments.quote({ plan, months: 1, action: "RENEW", extras: { stores: 0, productPacks: 0, userPacks: 0 } });
    expect(quote.startsAt).toBe(end.toISOString());
    const invoice = await caller.billing.payments.checkout({ plan, months: 1, acceptedTerms: true, locale: "ru",
      idempotencyKey: randomUUID(), expectedAmountMinor: quote.amountMinor, quoteToken: quote.quoteToken,
      termsVersion: "trial-qa" });
    const payment = [...fixture.payments.values()][0]!;
    const notification = () => handleGoPayNotification(fixture.notification(fixture.commit(payment)));
    await notification(); await notification();
    expect(await prisma.subscriptionPeriod.count({ where: { invoiceId: invoice.id } })).toBe(1);
    const period = await prisma.subscriptionPeriod.findUniqueOrThrow({ where: { invoiceId: invoice.id } });
    expect(period.startsAt).toEqual(end);
    expect(period.endsAt.toISOString()).toBe("2027-03-04T10:00:00.000Z");
    expect((await getOrganizationPlan(f.organizationId)).trialOffer).toMatchObject({ previewPlan: "ENTERPRISE" });
    expect((await getOrganizationPlan(f.organizationId)).entitlements.limits.maxActiveUsers).toBe(2);
    expect((await getOrganizationPlan(f.organizationId)).entitlements.features.bundles).toBe(true);
    vi.setSystemTime(new Date(end.getTime() + 1));
    expect((await getOrganizationPlan(f.organizationId)).trialOffer).toBeNull();
    expect((await getOrganizationPlan(f.organizationId)).entitlements.features.analytics).toBe(plan === "BUSINESS");
    await expect(assertTrialActive(f.organizationId)).resolves.toBeTruthy();
  });

  it("preserves previously issued fourteen-day and manually approved access", async () => {
    const future = new Date(now.getTime() + 14 * 86_400_000);
    const org = await prisma.organization.create({ data: { name: "Synthetic old access", plan: "BUSINESS",
      subscriptionBillingMode: "MANUAL", trialEndsAt: future, currentPeriodEndsAt: future } });
    await prisma.subscriptionContract.create({ data: { organizationId: org.id, catalogVersion: "2026-10" } });
    vi.setSystemTime(new Date(now.getTime() + 8 * 86_400_000));
    await expect(assertTrialActive(org.id)).resolves.toBeTruthy();
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).trialEndsAt).toEqual(future);
    expect((await getOrganizationPlan(org.id)).trialOffer).toBeNull();
  });

  it("lets explicit manual approval supersede preview limits consistently in SQL and the application", async () => {
    const f = await register(await identity());
    await prisma.organization.update({ where: { id: f.organizationId }, data: {
      plan: "ENTERPRISE", subscriptionBillingMode: "MANUAL", currentPeriodEndsAt: new Date(now.getTime() + 30 * 86_400_000),
    } });
    expect((await getOrganizationPlan(f.organizationId)).trialOffer).toBeNull();
    expect((await getOrganizationPlan(f.organizationId)).entitlements.limits.maxActiveUsers).toBe(15);
    for (let i = 0; i < 3; i++) await prisma.user.create({ data: { organizationId: f.organizationId,
      name: "Approved user", email: `approved-${i}@example.invalid`, role: "STAFF", passwordHash: "unused" } });
    await prisma.$executeRaw`SELECT "assertSubscriptionFeatureConfiguration"(${f.organizationId}, 'bundles')`;
  });

  it.each([...LIFETIME_ORGANIZATION_IDS])("never applies trial restrictions to protected friend %s", async id => {
    const org = await prisma.organization.create({ data: { id, name: "Synthetic lifetime friend", plan: "ENTERPRISE",
      subscriptionBillingMode: "MANUAL", trialEndsAt: new Date(0), currentPeriodEndsAt: new Date(0) } });
    await prisma.subscriptionContract.create({ data: { organizationId: id, catalogVersion: "2026-11", lifetimeAccess: true,
      termsSnapshot: createContractTerms("2026-11") } });
    await expect(assertTrialActive(id)).resolves.toMatchObject({ lifetimeAccess: true, trialOffer: null });
    expect(await prisma.organization.findUniqueOrThrow({ where: { id } })).toEqual(org);
    expect(createTrialOffer(createContractTerms("2026-11")).days).toBe(7);
  });
});
