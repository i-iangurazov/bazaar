import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LEGAL_TERMS_VERSION } from "@/lib/legalPublication";
import { businessDateKey } from "@/lib/timezone";
import type { SubscriptionSelection } from "@/lib/billing/subscriptionPricing";
import { prisma } from "@/server/db/prisma";
import { appleSubscriptionOffer } from "@/server/billing/appleOfferCatalog";
import { createContractTerms } from "@/server/billing/contractTerms";
import {
  applyAppleTransaction,
  authorizeApplePurchase,
  cancelApplePurchaseIntent,
  createApplePurchaseIntent,
  getAppleBillingState,
  getApplePurchasePreview,
  restoreApplePurchases,
} from "@/server/billing/applePayments";
import { assertNoApplePurchaseConflict, lockAppleOrganization } from "@/server/billing/appleConcurrency";
import {
  getAppleTemporaryUpgradeCatalog,
  previewAppleTemporaryUpgrade,
} from "@/server/billing/appleTemporaryUpgrades";
import { recordManualSubscriptionRefund } from "@/server/billing/manualSubscriptionRefunds";
import { paymentOrderId } from "@/server/billing/paymentConfig";
import { extendSubscriptionMonths, kgsToMinor } from "@/server/billing/paymentMath";
import { readPurchaseSnapshot, verifyPurchaseQuote, type PurchaseSnapshot } from "@/server/billing/purchaseSnapshot";
import { calculateSubscriptionQuote } from "@/server/billing/subscriptionQuotes";
import { getSubscriptionPaymentState } from "@/server/billing/subscriptionPayments";
import {
  getSubscriptionUsage,
  reserveSubscriptionUsage,
  withSubscriptionUsage,
} from "@/server/billing/subscriptionUsage";
import * as verification from "@/server/billing/appleVerification";
import { deleteOwnAccount } from "@/server/services/accountDeletion";
import { writeAuditLog } from "@/server/services/audit";
import { setUserActive, updateUser } from "@/server/services/users";
import {
  assertFeatureCanBeConfigured,
  getCapacityLimits,
  getOrganizationPlan,
  resolveOrganizationAccessState,
} from "@/server/services/planLimits";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { assertSafeTestDatabaseReset } from "../helpers/testDatabaseSafety";
import { syntheticAppleTransaction, syntheticAppleVerifier } from "../helpers/appleSignedFixture";
import { parsePreflightTarget, runIosBillingPreflight } from "../../scripts/deployment/ios-billing-preflight";

const describeDb = shouldRunDbTests ? describe : describe.skip;
const DAY = 86_400_000;
const reserve = { stores: 0, productPacks: 1, userPacks: 0 as const };
const starter: SubscriptionSelection = { plan: "STARTER", months: 1, extras: reserve };
const business: SubscriptionSelection = { plan: "BUSINESS", months: 1, extras: { ...reserve, stores: 1 } };
const enterprise: SubscriptionSelection = { plan: "ENTERPRISE", months: 1, extras: { ...reserve, stores: 1 } };
const json = <T,>(value: T) => JSON.parse(JSON.stringify(value));
const transactionId = () => String(BigInt(`0x${randomUUID().replaceAll("-", "")}`) % 10n ** 30n + 1n);
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settled = <T,>(promise: Promise<T>) => promise.then(
  (value) => ({ status: "fulfilled" as const, value }),
  (reason: unknown) => ({ status: "rejected" as const, reason }),
);
const band = { key: "synthetic-band", productId: "synthetic.temporary.upgrade", prices: [{
  storefrontId: "143441", currency: "USD", priceMillis: 2990,
  serviceMinorPerUnitNumerator: 9000, serviceMinorPerUnitDenominator: 1,
}] };

// Tiny, explicitly frozen test contracts exercise every SQL capacity resource
// without inserting thousands of products. Prices remain service valuations;
// the band below is synthetic and makes no owner pricing/approval claim.
const terms = json(createContractTerms("2026-11"));
terms.plans.STARTER.limits = { maxStores: 1, maxProducts: 3, maxActiveUsers: 2 };
terms.plans.BUSINESS.limits = { maxStores: 1, maxProducts: 5, maxActiveUsers: 3 };
terms.plans.ENTERPRISE.limits = { maxStores: 1, maxProducts: 7, maxActiveUsers: 4 };
terms.plans.STARTER.usageLimits.ai = 10;
terms.plans.BUSINESS.usageLimits.ai = 20;
terms.plans.ENTERPRISE.usageLimits.ai = 30;

const configure = (organizationId: string) => {
  const mappings = [starter, business, enterprise].map((selection) => ({
    offerKey: appleSubscriptionOffer(terms, selection).offerKey,
    productId: `synthetic.temporary.base.${selection.plan.toLowerCase()}`,
    productType: "NON_RENEWING", approved: true,
  }));
  const policy = { version: "synthetic-v1", termsVersion: LEGAL_TERMS_VERSION, approved: true,
    validUntil: new Date(Date.now() + 7 * DAY).toISOString(), rounding: "DOWN_WITH_OWNER_DISCOUNT",
    zeroPolicy: "BLOCK", minimumPolicy: "BLOCK", maxDiscountMinor: 2_147_483_647, maxDiscountBps: 10_000,
    bands: [band] };
  for (const [key, value] of Object.entries({
    APPLE_BILLING_MODE: "sandbox", APPLE_APP_ID: "1234567890", APPLE_IAP_KEY_ID: "SYNTHETIC",
    APPLE_IAP_ISSUER_ID: "SYNTHETIC", APPLE_IAP_PRIVATE_KEY: "SYNTHETIC PRIVATE KEY",
    APPLE_BILLING_TERMS_VERSION: LEGAL_TERMS_VERSION, APPLE_BILLING_TERMS_APPROVED: "true",
    APPLE_BILLING_SALES_APPROVED: "true", APPLE_BILLING_SANDBOX_ORGANIZATION_IDS: organizationId,
    APPLE_BILLING_CATALOG_JSON: JSON.stringify(mappings), APPLE_BILLING_TEMPORARY_UPGRADES_APPROVED: "true",
    APPLE_BILLING_TEMPORARY_UPGRADES_JSON: JSON.stringify(policy),
  })) vi.stubEnv(key, value);
  return { mappings, policy };
};

const seed = async ({ activateCurrentContract = true }: { activateCurrentContract?: boolean } = {}) => {
  const f = await seedBase({ plan: "STARTER" });
  await prisma.user.updateMany({ where: { organizationId: f.org.id, id: { not: f.adminUser.id } }, data: { isActive: false } });
  await prisma.organization.update({ where: { id: f.org.id }, data: {
    subscriptionBillingMode: activateCurrentContract ? "SELF_SERVE" : "MANUAL", subscriptionStatus: "ACTIVE", trialEndsAt: null, currentPeriodEndsAt: null,
  } });
  if (activateCurrentContract)
    await prisma.subscriptionContract.create({ data: { organizationId: f.org.id, catalogVersion: "2026-11", termsSnapshot: terms } });
  const config = configure(f.org.id);
  return { ...f, ...config, actor: { id: f.adminUser.id, organizationId: f.org.id } };
};
type Fixture = Awaited<ReturnType<typeof seed>>;
type Intent = Awaited<ReturnType<typeof createApplePurchaseIntent>>;
const apply = async (f: Fixture, signed: string, intentId?: string, source: "CLIENT" | "RESTORE" | "NOTIFICATION" = "CLIENT") =>
  applyAppleTransaction(await syntheticAppleVerifier().transaction(signed), { organizationId: f.org.id, intentId, source });
const signed = (intent: Intent, overrides: Partial<Parameters<typeof syntheticAppleTransaction>[0]> = {}) => {
  const id = transactionId();
  return syntheticAppleTransaction({ appAccountToken: intent.appAccountToken, productId: intent.productId,
    transactionId: id, originalTransactionId: id, price: 2990, currency: "USD", storefrontId: "143441", ...overrides });
};

const paidWebSnapshot = async (f: Fixture, purchase: PurchaseSnapshot) => {
  const id = randomUUID();
  const invoice = await prisma.subscriptionInvoice.create({ data: {
    id, organizationId: f.org.id, createdById: f.adminUser.id, idempotencyKey: id,
    plan: purchase.plan, amountMinor: purchase.amountMinor, currency: "KGS", merchantId: "synthetic-historical",
    provider: "GOPAY", isTest: false, status: "PAID", paidAt: new Date(Math.min(Date.now() - 1000, new Date(purchase.startsAt).getTime())),
    providerOrderId: paymentOrderId("subscription", id), providerPaymentId: randomUUID(), termsVersion: LEGAL_TERMS_VERSION,
    termsUrl: "https://example.invalid/legal/offer", sellerName: "SYNTHETIC SELLER",
    expiresAt: new Date(purchase.expiresAt), purchaseSnapshot: json(purchase),
    events: { create: { deduplicationKey: `synthetic:${id}`, source: "RECONCILIATION", state: "PAID", payloadDigest: "synthetic-confirmed-payment" } },
    period: { create: { organization: { connect: { id: f.org.id } }, plan: purchase.plan,
      startsAt: new Date(purchase.startsAt), endsAt: new Date(purchase.endsAt), purchaseSnapshot: json(purchase) } },
  }, include: { period: true } });
  await prisma.organization.update({ where: { id: f.org.id }, data: {
    currentPeriodEndsAt: new Date(purchase.endsAt), billingAnchorDay: purchase.anchorDay,
  } });
  return { invoice, period: invoice.period! };
};
const paidWeb = async (f: Fixture, selection = starter, now = new Date(Date.now() - DAY)) =>
  paidWebSnapshot(f, await calculateSubscriptionQuote(f.org.id, { ...selection, action: "RENEW" }, prisma, now));
const paidApple = async (f: Fixture) => {
  const mapping = f.mappings[0]!;
  const preview = await getApplePurchasePreview(f.actor, { expectedOrganizationId: f.org.id, offerKey: mapping.offerKey, action: "RENEW" });
  const intent = await createApplePurchaseIntent(f.actor, { expectedOrganizationId: f.org.id, offerKey: mapping.offerKey,
    action: "RENEW", quoteToken: preview.quoteToken!, idempotencyKey: randomUUID(), acceptedTerms: true, termsVersion: LEGAL_TERMS_VERSION });
  await authorizeApplePurchase(f.actor, intent.intentId, { attemptId: randomUUID() });
  const payload = signed(intent);
  expect((await apply(f, payload, intent.intentId)).status).toBe("GRANTED");
  const row = await prisma.appleTransaction.findFirstOrThrow({ where: { intentId: intent.intentId } });
  const period = await prisma.subscriptionPeriod.findUniqueOrThrow({ where: { appleTransactionId: row.id } });
  return { period, intent, payload, row };
};
const previewChange = (f: Fixture, selection = business) => previewAppleTemporaryUpgrade(f.actor, {
  expectedOrganizationId: f.org.id, selection, storefrontId: "143441", currency: "USD",
});
const changeIntent = async (f: Fixture, preview: Awaited<ReturnType<typeof previewChange>>, key = randomUUID()) =>
  createApplePurchaseIntent(f.actor, { expectedOrganizationId: f.org.id, action: "CHANGE", offerKey: preview.offerKey,
    quoteToken: preview.quoteToken, idempotencyKey: key, acceptedTerms: true, termsVersion: LEGAL_TERMS_VERSION });
const grantChange = async (f: Fixture, selection = business) => {
  const preview = await previewChange(f, selection), intent = await changeIntent(f, preview), attemptId = randomUUID();
  await authorizeApplePurchase(f.actor, intent.intentId, { attemptId });
  const payload = signed(intent);
  expect((await apply(f, payload, intent.intentId)).status).toBe("GRANTED");
  const row = await prisma.appleTransaction.findFirstOrThrow({ where: { intentId: intent.intentId } });
  const period = await prisma.subscriptionPeriod.findUniqueOrThrow({ where: { appleTransactionId: row.id } });
  return { preview, intent, attemptId, payload, row, period };
};
const newer = (payload: string, overrides: Partial<Parameters<typeof syntheticAppleTransaction>[0]>) => {
  // The fixture verifier checks a genuine synthetic ES256 certificate chain;
  // no live Apple API or unverified decoded object enters the grant path.
  const data = JSON.parse(Buffer.from(payload.split(".")[1]!, "base64url").toString()) as Parameters<typeof syntheticAppleTransaction>[0];
  return syntheticAppleTransaction({ ...data, signedDate: data.signedDate! + 1000, ...overrides });
};
const bucketRows = (f: Fixture) => prisma.subscriptionUsageBucket.findMany({ where: { organizationId: f.org.id }, orderBy: { id: "asc" } });
const sqlFeature = (f: Fixture, feature = "bundles") => prisma.$executeRaw`SELECT "assertSubscriptionFeatureConfiguration"(${f.org.id}, ${feature})`;

describeDb("direct temporary Apple upgrades on isolated PostgreSQL", () => {
  let network: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    await resetDatabase();
    vi.stubEnv("NEXTAUTH_SECRET", "synthetic-temporary-upgrade-quotes");
    vi.stubEnv("BILLING_PAYMENTS_MODE", "disabled");
    network = vi.fn(() => { throw new Error("Temporary-upgrade PG tests must not call any provider"); });
    vi.stubGlobal("fetch", network);
  });
  afterEach(() => {
    expect(network).not.toHaveBeenCalled();
    vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks();
  });

  it.each(["GOPAY", "APPLE"] as const)("changes only the current %s term, preserves prepay/reserve/usage, and restores once", async (source) => {
    const f = await seed();
    const base = source === "GOPAY" ? await paidWeb(f) : await paidApple(f);
    const originalBase = await prisma.subscriptionPeriod.findUniqueOrThrow({ where: { id: base.period.id } });
    const future = await paidWeb(f, { ...enterprise, months: 6 }, new Date());
    const originalFuture = await prisma.subscriptionPeriod.findUniqueOrThrow({ where: { id: future.period.id } });
    const originalInvoice = await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: future.invoice.id } });
    const originalOrg = await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } });
    await withSubscriptionUsage({ organizationId: f.org.id, resource: "ai", operationKey: "used-before-C", units: 3 }, async () => true);
    await reserveSubscriptionUsage({ organizationId: f.org.id, resource: "ai", operationKey: "reserved-before-C", units: 2 });
    const beforeBuckets = await bucketRows(f);
    const change = await grantChange(f);
    const current = await getOrganizationPlan(f.org.id);
    expect(current.plan).toBe("BUSINESS");
    expect(current.subscriptionExtras).toEqual(business.extras);
    expect(change.period).toMatchObject({ parentPeriodId: base.period.id, revokedAt: null, dependencyRevokedAt: null });
    expect(change.period.endsAt).toEqual(base.period.endsAt);
    const prior = readPurchaseSnapshot(base.period.purchaseSnapshot)!;
    const purchased = readPurchaseSnapshot(change.period.purchaseSnapshot)!;
    expect(purchased).toMatchObject({ sourcePeriodId: base.period.id, cycleStartsAt: prior.cycleStartsAt,
      cycleEndsAt: prior.cycleEndsAt, anchorDay: prior.anchorDay, extras: business.extras });
    expect(await prisma.subscriptionPeriod.findUniqueOrThrow({ where: { id: base.period.id } })).toEqual(originalBase);
    expect(await prisma.subscriptionPeriod.findUniqueOrThrow({ where: { id: future.period.id } })).toEqual(originalFuture);
    expect(await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: future.invoice.id } })).toEqual(originalInvoice);
    const stored = await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } });
    expect(stored.plan).toBe(originalOrg.plan);
    expect(stored.currentPeriodEndsAt).toEqual(originalOrg.currentPeriodEndsAt);
    expect(stored.billingAnchorDay).toBe(originalOrg.billingAnchorDay);
    expect(await bucketRows(f)).toEqual(beforeBuckets);
    expect((await getSubscriptionUsage(f.org.id)).find((row) => row.resource === "ai")).toMatchObject({ limit: 20, used: 3, reserved: 2 });
    vi.spyOn(verification, "verifyAppleTransaction").mockImplementation((payload) => syntheticAppleVerifier().transaction(payload));
    await restoreApplePurchases(f.actor, [change.payload, change.payload]);
    expect(await prisma.subscriptionPeriod.count({ where: { parentPeriodId: { not: null } } })).toBe(1);
    expect(await bucketRows(f)).toEqual(beforeBuckets);
  });

  it.each(["GOPAY", "APPLE"] as const)("funds a positive below-floor %s upgrade without extending base/future coverage or resetting usage", async (provider) => {
    const f = await seed(), base = provider === "GOPAY" ? await paidWeb(f) : await paidApple(f);
    const future = await paidWeb(f, { ...enterprise, months: 6 }, new Date());
    const originalBase = await prisma.subscriptionPeriod.findUniqueOrThrow({ where: { id: base.period.id } });
    const originalFuture = await prisma.subscriptionPeriod.findUniqueOrThrow({ where: { id: future.period.id } });
    const originalInvoice = await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: future.invoice.id } });
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(base.period.endsAt.getTime() - 60_000));
    vi.stubEnv("APPLE_BILLING_TEMPORARY_UPGRADES_JSON", JSON.stringify({ ...f.policy, minimumPolicy: "CHARGE_MINIMUM_FOR_POSITIVE",
      validUntil: new Date(Date.now() + DAY).toISOString() }));
    await withSubscriptionUsage({ organizationId: f.org.id, resource: "ai", operationKey: "used-before-minimum", units: 3 }, async () => true);
    await reserveSubscriptionUsage({ organizationId: f.org.id, resource: "ai", operationKey: "reserved-before-minimum", units: 2 });
    const beforeBuckets = await bucketRows(f);
    const change = await grantChange(f);
    expect(change.preview.minimumChargeApplied).toBe(true);
    expect(change.preview.serviceValue.incrementalMinor).toBeGreaterThan(0);
    expect(change.preview.serviceValue.incrementalMinor).toBeLessThan(change.preview.serviceValue.chargedServiceMinor);
    expect(change.preview.serviceValue.ownerDiscountMinor).toBe(0);
    const snapshot = readPurchaseSnapshot(change.period.purchaseSnapshot)!;
    expect(snapshot.appleTemporaryUpgrade?.minimumCharge?.serviceAdjustmentMinor)
      .toBe(change.preview.serviceValue.chargedServiceMinor - snapshot.amountMinor);
    expect(change.period.endsAt).toEqual(base.period.endsAt);
    expect(await prisma.subscriptionPeriod.findUniqueOrThrow({ where: { id: base.period.id } })).toEqual(originalBase);
    expect(await prisma.subscriptionPeriod.findUniqueOrThrow({ where: { id: future.period.id } })).toEqual(originalFuture);
    expect(await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: future.invoice.id } })).toEqual(originalInvoice);
    expect(await bucketRows(f)).toEqual(beforeBuckets);
    expect((await getSubscriptionUsage(f.org.id)).find((row) => row.resource === "ai")).toMatchObject({ used: 3, reserved: 2 });
    vi.spyOn(verification, "verifyAppleTransaction").mockImplementation((payload) => syntheticAppleVerifier().transaction(payload));
    await restoreApplePurchases(f.actor, [change.payload, change.payload]);
    expect(await prisma.subscriptionPeriod.count({ where: { parentPeriodId: { not: null } } })).toBe(1);
    await apply(f, newer(change.payload, { revocationDate: Date.now() }), undefined, "NOTIFICATION");
    expect((await getOrganizationPlan(f.org.id)).plan).toBe("STARTER");
    expect(await bucketRows(f)).toEqual(beforeBuckets);
    expect((await prisma.subscriptionPeriod.findUniqueOrThrow({ where: { id: base.period.id } })).revokedAt).toBeNull();
  });

  it("does not turn a rounded zero upgrade into a minimum payment or intent", async () => {
    const f = await seed(), base = await paidWeb(f);
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(base.period.endsAt.getTime() - 1));
    vi.stubEnv("APPLE_BILLING_TEMPORARY_UPGRADES_JSON", JSON.stringify({ ...f.policy, minimumPolicy: "CHARGE_MINIMUM_FOR_POSITIVE",
      validUntil: new Date(Date.now() + DAY).toISOString() }));
    await expect(previewChange(f)).rejects.toThrow("billingNoPaidChange");
    expect(await prisma.applePurchaseIntent.count({ where: { organizationId: f.org.id } })).toBe(0);
    expect(await prisma.subscriptionPeriod.count({ where: { parentPeriodId: { not: null } } })).toBe(0);
  });

  it("rejects invalid minimum accounting at the raw PostgreSQL intent boundary", async () => {
    const f = await seed(), base = await paidWeb(f);
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(base.period.endsAt.getTime() - 60_000));
    vi.stubEnv("APPLE_BILLING_TEMPORARY_UPGRADES_JSON", JSON.stringify({ ...f.policy, minimumPolicy: "CHARGE_MINIMUM_FOR_POSITIVE",
      validUntil: new Date(Date.now() + DAY).toISOString() }));
    const preview = await previewChange(f), intent = await changeIntent(f, preview);
    const original = await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: intent.intentId } });
    const purchase = readPurchaseSnapshot(original.purchaseSnapshot)!;
    const altered = [
      { ...purchase, amountMinor: 0 },
      { ...purchase, appleTemporaryUpgrade: { ...purchase.appleTemporaryUpgrade!, minimumCharge: { serviceAdjustmentMinor: 0 } } },
      { ...purchase, appleTemporaryUpgrade: { ...purchase.appleTemporaryUpgrade!, minimumCharge: { serviceAdjustmentMinor: 1 } } },
      { ...purchase, appleTemporaryUpgrade: { ...purchase.appleTemporaryUpgrade!, ownerDiscountMinor: 1 } },
    ];
    for (const snapshot of altered) await expect(prisma.applePurchaseIntent.create({ data: {
      organizationId: f.org.id, createdById: f.actor.id, idempotencyKey: randomUUID(), scope: "SUBSCRIPTION", action: "CHANGE",
      offerKey: original.offerKey, productId: original.productId, productType: "NON_RENEWING", environment: original.environment,
      appAccountToken: original.appAccountToken, purchaseAppAccountToken: randomUUID(), offerSnapshot: json(original.offerSnapshot),
      purchaseSnapshot: json(snapshot), termsVersion: original.termsVersion, termsUrl: original.termsUrl, expiresAt: original.expiresAt,
    } })).rejects.toThrow("Temporary minimum charge requires its exact positive quote");
    expect(await prisma.applePurchaseIntent.count({ where: { organizationId: f.org.id } })).toBe(1);
    expect(await prisma.subscriptionPeriod.count({ where: { parentPeriodId: { not: null } } })).toBe(0);
  });

  it("refunds/reverses only an increment and never resets consumption or independent base grants", async () => {
    const f = await seed(), base = await paidWeb(f), change = await grantChange(f);
    await withSubscriptionUsage({ organizationId: f.org.id, resource: "ai", operationKey: "used-in-C", units: 6 }, async () => true);
    const buckets = await bucketRows(f);
    const refunded = newer(change.payload, { revocationDate: Date.now() });
    expect((await apply(f, refunded, undefined, "NOTIFICATION")).status).toBe("REVOKED");
    expect((await getOrganizationPlan(f.org.id)).plan).toBe("STARTER");
    expect((await prisma.subscriptionPeriod.findUniqueOrThrow({ where: { id: base.period.id } })).revokedAt).toBeNull();
    expect((await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: base.invoice.id } })).status).toBe("PAID");
    await apply(f, change.payload, undefined, "RESTORE");
    expect((await getOrganizationPlan(f.org.id)).plan).toBe("STARTER");
    await apply(f, newer(refunded, { revocationDate: undefined }), undefined, "NOTIFICATION");
    expect((await getOrganizationPlan(f.org.id)).plan).toBe("BUSINESS");
    expect(await bucketRows(f)).toEqual(buckets);
    expect((await getSubscriptionUsage(f.org.id)).find((row) => row.resource === "ai")?.used).toBe(6);
  });

  it("preserves consumed legacy GoPay quota dates when its paid period has no purchase snapshot", async () => {
    const f = await seed({ activateCurrentContract: false });
    // Establish the old organization's creation date before creating any paid
    // history. Never rewrite its paid invoice/period or existing usage buckets.
    const createdAt = new Date(Date.now() - 12 * DAY), startsAt = new Date(Date.now() - 2 * DAY);
    const endsAt = extendSubscriptionMonths(startsAt, startsAt.getUTCDate(), 1), id = randomUUID();
    await prisma.organization.update({ where: { id: f.org.id }, data: { createdAt } });
    const legacy = await prisma.subscriptionInvoice.create({ data: {
      id, organizationId: f.org.id, createdById: f.adminUser.id, idempotencyKey: randomUUID(), plan: "STARTER",
      amountMinor: kgsToMinor(terms.plans.STARTER.monthlyPriceKgs), currency: "KGS", status: "PAID",
      provider: "GOPAY", merchantId: "synthetic-historical", isTest: false, paidAt: startsAt,
      providerOrderId: paymentOrderId("subscription", id), providerPaymentId: randomUUID(),
      termsVersion: "synthetic-retained-legacy-terms", termsUrl: "https://example.invalid/legal/offer", sellerName: "SYNTHETIC SELLER",
      expiresAt: new Date(startsAt.getTime() + 15 * 60_000),
      events: { create: { deduplicationKey: `synthetic-legacy:${id}`, source: "RECONCILIATION", state: "PAID", payloadDigest: "synthetic-confirmed-legacy-payment" } },
      period: { create: { organization: { connect: { id: f.org.id } }, plan: "STARTER", startsAt, endsAt } },
    }, include: { period: true } });
    // The retained pre-snapshot payment predates current-contract activation.
    // Enabling the current contract must preserve both old NULL snapshots.
    await prisma.subscriptionContract.create({ data: { organizationId: f.org.id, catalogVersion: "2026-11", termsSnapshot: terms } });
    await prisma.organization.update({ where: { id: f.org.id }, data: {
      subscriptionBillingMode: "SELF_SERVE", currentPeriodEndsAt: endsAt, billingAnchorDay: startsAt.getUTCDate(),
    } });
    expect((await getOrganizationPlan(f.org.id)).activePurchase).toBeNull();
    const frozenInvoice = await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: legacy.id } });
    const frozenPeriod = await prisma.subscriptionPeriod.findUniqueOrThrow({ where: { id: legacy.period!.id } });
    expect(frozenInvoice.purchaseSnapshot).toBeNull(); expect(frozenPeriod.purchaseSnapshot).toBeNull();
    await withSubscriptionUsage({ organizationId: f.org.id, resource: "ai", operationKey: "legacy-used", units: 3 }, async () => true);
    await reserveSubscriptionUsage({ organizationId: f.org.id, resource: "ai", operationKey: "legacy-reserved", units: 2 });
    const originalBuckets = await bucketRows(f);
    const before = (await getSubscriptionUsage(f.org.id)).find((row) => row.resource === "ai")!;
    expect(originalBuckets[0]?.startsAt).toEqual(createdAt);
    expect(before).toMatchObject({ used: 3, reserved: 2 });
    expect(before.resetsAt).not.toEqual(endsAt);
    const first = await grantChange(f), second = await grantChange(f, enterprise);
    for (const expectedPlan of ["ENTERPRISE", "BUSINESS", "STARTER"] as const) {
      expect((await getOrganizationPlan(f.org.id)).plan).toBe(expectedPlan);
      const usage = (await getSubscriptionUsage(f.org.id)).find((row) => row.resource === "ai")!;
      expect(usage).toMatchObject({ used: before.used, reserved: before.reserved, resetsAt: before.resetsAt });
      expect(await bucketRows(f)).toEqual(originalBuckets);
      if (expectedPlan === "ENTERPRISE") await apply(f, newer(second.payload, { revocationDate: Date.now() }), undefined, "NOTIFICATION");
      if (expectedPlan === "BUSINESS") await apply(f, newer(first.payload, { revocationDate: Date.now() }), undefined, "NOTIFICATION");
    }
    await apply(f, newer(first.payload, { signedDate: first.row.lastSignedAt.getTime() + 2000 }), undefined, "NOTIFICATION");
    vi.spyOn(verification, "verifyAppleTransaction").mockImplementation((payload) => syntheticAppleVerifier().transaction(payload));
    await restoreApplePurchases(f.actor, [first.payload, second.payload]);
    expect((await getOrganizationPlan(f.org.id)).plan).toBe("BUSINESS");
    expect((await getSubscriptionUsage(f.org.id)).find((row) => row.resource === "ai"))
      .toMatchObject({ used: before.used, reserved: before.reserved, resetsAt: before.resetsAt });
    expect(await bucketRows(f)).toEqual(originalBuckets);
    expect(await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: legacy.id } })).toEqual(frozenInvoice);
    expect(await prisma.subscriptionPeriod.findUniqueOrThrow({ where: { id: legacy.period!.id } })).toEqual(frozenPeriod);
  });

  it("uses dependent rights for actual SQL capacity/configuration and removes only new rights on refund", async () => {
    const f = await seed();
    const bareStarter = { ...starter, extras: { stores: 0, productPacks: 0, userPacks: 0 as const } };
    const bareEnterprise = { ...enterprise, extras: { stores: 1, productPacks: 0, userPacks: 0 as const } };
    await paidWeb(f, bareStarter);
    await prisma.product.createMany({ data: [2, 3].map((n) => ({ organizationId: f.org.id, sku: `BASE-${n}`, name: `Base ${n}`,
      unit: f.baseUnit.code, baseUnitId: f.baseUnit.id })) });
    await prisma.user.update({ where: { id: f.managerUser.id }, data: { isActive: true } });
    const newProduct = (n: number) => prisma.product.create({ data: { organizationId: f.org.id, sku: `C-${n}`, name: `C ${n}`,
      unit: f.baseUnit.code, baseUnitId: f.baseUnit.id } });
    await expect(newProduct(4)).rejects.toThrow("subscriptionCapacityExceeded");
    await expect(prisma.user.update({ where: { id: f.staffUser.id }, data: { isActive: true } })).rejects.toThrow("subscriptionCapacityExceeded");
    await expect(sqlFeature(f)).rejects.toThrow("featureLockedPlan");
    const change = await grantChange(f, bareEnterprise);
    expect(await getCapacityLimits(await getOrganizationPlan(f.org.id))).toEqual({ maxStores: 2, maxUsers: 4, maxProducts: 7 });
    await assertFeatureCanBeConfigured(f.org.id, "bundles");
    await sqlFeature(f);
    const fourth = await newProduct(4), fifth = await newProduct(5);
    await prisma.user.update({ where: { id: f.staffUser.id }, data: { isActive: true } });
    const secondStore = await prisma.store.create({ data: { organizationId: f.org.id, name: "Temporarily funded store", code: "C-SECOND" } });
    await prisma.store.update({ where: { id: f.store.id }, data: { trackExpiryLots: true } });
    await apply(f, newer(change.payload, { revocationDate: Date.now() }), undefined, "NOTIFICATION");
    expect(await getCapacityLimits(await getOrganizationPlan(f.org.id))).toEqual({ maxStores: 1, maxUsers: 2, maxProducts: 3 });
    expect(await prisma.store.findUnique({ where: { id: secondStore.id } })).not.toBeNull();
    expect((await prisma.store.findUniqueOrThrow({ where: { id: f.store.id } })).trackExpiryLots).toBe(true);
    expect(await prisma.product.count({ where: { organizationId: f.org.id } })).toBe(5);
    await expect(sqlFeature(f)).rejects.toThrow("featureLockedPlan");
    await expect(assertFeatureCanBeConfigured(f.org.id, "bundles")).rejects.toThrow();
    // Archiving/deactivating remains available above the lower limit. Once at
    // that limit, SQL must refuse reactivation that the old C target allowed.
    await prisma.product.updateMany({ where: { id: { in: [fourth.id, fifth.id] } }, data: { isDeleted: true } });
    await prisma.user.update({ where: { id: f.staffUser.id }, data: { isActive: false } });
    await expect(prisma.product.update({ where: { id: fourth.id }, data: { isDeleted: false } })).rejects.toThrow("subscriptionCapacityExceeded");
    await expect(prisma.user.update({ where: { id: f.staffUser.id }, data: { isActive: true } })).rejects.toThrow("subscriptionCapacityExceeded");
    await expect(prisma.store.create({ data: { organizationId: f.org.id, name: "Unfunded extra", code: "C-THIRD" } })).rejects.toThrow("subscriptionCapacityExceeded");
  });

  it("propagates base refund/reversal through two increments without erasing an independent GoPay grant", async () => {
    const f = await seed();
    const independentSnapshot = await calculateSubscriptionQuote(f.org.id, { ...starter, action: "RENEW" }, prisma, new Date(Date.now() - DAY));
    const base = await paidApple(f), first = await grantChange(f), second = await grantChange(f, enterprise);
    expect(second.period.parentPeriodId).toBe(first.period.id);
    await paidWebSnapshot(f, independentSnapshot);
    const refunded = newer(base.payload, { revocationDate: Date.now() });
    await apply(f, refunded, undefined, "NOTIFICATION");
    for (const id of [first.period.id, second.period.id]) {
      const period = await prisma.subscriptionPeriod.findUniqueOrThrow({ where: { id } });
      expect(period.revokedAt).toBeNull(); expect(period.dependencyRevokedAt).not.toBeNull();
    }
    const active = await getOrganizationPlan(f.org.id);
    expect(active.plan).toBe("STARTER");
    expect(active.activeSubscriptionPeriod?.invoiceId).not.toBeNull();
    expect(resolveOrganizationAccessState(active).subscriptionActive).toBe(true);
    await expect(sqlFeature(f)).rejects.toThrow("featureLockedPlan");
    await apply(f, newer(refunded, { revocationDate: undefined }), undefined, "NOTIFICATION");
    expect((await getOrganizationPlan(f.org.id)).plan).toBe("ENTERPRISE");
    expect((await prisma.subscriptionPeriod.findUniqueOrThrow({ where: { id: second.period.id } })).dependencyRevokedAt).toBeNull();
    expect(await prisma.subscriptionInvoice.count({ where: { organizationId: f.org.id, status: "PAID" } })).toBe(1);
  });

  it("enforces ancestor dependency even for raw period revocation and preserves a child's separate own refund", async () => {
    const f = await seed(), base = await paidApple(f);
    const future = await paidWeb(f, { ...enterprise, months: 6 }, new Date());
    const first = await grantChange(f), second = await grantChange(f, enterprise);
    await withSubscriptionUsage({ organizationId: f.org.id, resource: "ai", operationKey: "used-before-raw-base-revocation", units: 4 }, async () => true);
    const buckets = await bucketRows(f);
    await prisma.subscriptionPeriod.update({ where: { id: base.period.id }, data: { revokedAt: new Date() } });
    for (const child of [first, second]) {
      expect(await prisma.subscriptionPeriod.findUniqueOrThrow({ where: { id: child.period.id } })).toMatchObject({ revokedAt: null, dependencyRevokedAt: expect.any(Date) });
      expect(await prisma.appleTransaction.findUniqueOrThrow({ where: { id: child.row.id } })).toMatchObject({ status: "REVIEW", lastIssue: "appleTemporaryUpgradeDependencyRevoked" });
    }
    expect(resolveOrganizationAccessState(await getOrganizationPlan(f.org.id)).hasAccess).toBe(false);
    expect((await prisma.subscriptionPeriod.findUniqueOrThrow({ where: { id: future.period.id } })).revokedAt).toBeNull();
    await expect(sqlFeature(f)).rejects.toThrow("featureLockedPlan");
    await expect(prisma.subscriptionPeriod.update({ where: { id: second.period.id }, data: { dependencyRevokedAt: null } })).rejects.toThrow("Temporary funding state follows its immutable parent");
    await expect(prisma.subscriptionPeriod.update({ where: { id: second.period.id }, data: { parentPeriodId: base.period.id } })).rejects.toThrow("Subscription period source and financial grant are immutable");
    const ownRefund = newer(first.payload, { revocationDate: Date.now() });
    await apply(f, ownRefund, undefined, "NOTIFICATION");
    await prisma.subscriptionPeriod.update({ where: { id: base.period.id }, data: { revokedAt: null } });
    expect((await getOrganizationPlan(f.org.id)).plan).toBe("STARTER");
    expect(await prisma.subscriptionPeriod.findUniqueOrThrow({ where: { id: first.period.id } })).toMatchObject({ revokedAt: expect.any(Date), dependencyRevokedAt: null });
    expect((await prisma.subscriptionPeriod.findUniqueOrThrow({ where: { id: second.period.id } })).dependencyRevokedAt).not.toBeNull();
    await apply(f, newer(ownRefund, { revocationDate: undefined }), undefined, "NOTIFICATION");
    expect((await getOrganizationPlan(f.org.id)).plan).toBe("ENTERPRISE");
    expect((await prisma.subscriptionPeriod.findUniqueOrThrow({ where: { id: second.period.id } })).dependencyRevokedAt).toBeNull();
    expect(await bucketRows(f)).toEqual(buckets);
  });

  it("keeps a reversed child refund in review while its base remains refunded and resolves only that dependency", async () => {
    const f = await seed(), base = await paidApple(f), change = await grantChange(f);
    await withSubscriptionUsage({ organizationId: f.org.id, resource: "ai", operationKey: "used-before-child-reversal", units: 3 }, async () => true);
    const buckets = await bucketRows(f);
    const ownRefund = newer(change.payload, { revocationDate: Date.now() });
    expect((await apply(f, ownRefund, undefined, "NOTIFICATION")).status).toBe("REVOKED");
    const baseRefund = newer(base.payload, { revocationDate: Date.now() });
    expect((await apply(f, baseRefund, undefined, "NOTIFICATION")).status).toBe("REVOKED");

    const ownReversal = newer(ownRefund, { revocationDate: undefined });
    expect(await apply(f, ownReversal, undefined, "NOTIFICATION")).toMatchObject({
      status: "REVIEW", reason: "appleTemporaryUpgradeDependencyRevoked",
    });
    expect(await prisma.subscriptionPeriod.findUniqueOrThrow({ where: { id: change.period.id } }))
      .toMatchObject({ revokedAt: null, dependencyRevokedAt: expect.any(Date) });
    expect(await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: change.intent.intentId } }))
      .toMatchObject({ status: "REVIEW", lastIssue: "appleTemporaryUpgradeDependencyRevoked" });
    expect((await getAppleBillingState(f.actor)).temporaryUpgrades.find((period) => period.id === change.period.id))
      .toMatchObject({ status: "SUSPENDED", requiresReview: true, reason: "appleTemporaryUpgradeDependencyRevoked" });
    expect((await getSubscriptionPaymentState(f.org.id)).purchaseBlockedReason).toBe("applePaymentNeedsReview");
    const checkoutGuard = () => prisma.$transaction(async (db) => {
      await lockAppleOrganization(db, f.org.id);
      await assertNoApplePurchaseConflict(db, f.org.id, "SUBSCRIPTION");
    });
    await expect(checkoutGuard()).rejects.toThrow("applePaymentNeedsReview");
    expect(resolveOrganizationAccessState(await getOrganizationPlan(f.org.id)).hasAccess).toBe(false);

    // A separate paid receipt still needs its own resolution. Recovering the
    // parent may clear only the first receipt's dependency issue.
    const duplicateCharge = signed(change.intent);
    expect(await apply(f, duplicateCharge, change.intent.intentId)).toMatchObject({
      status: "REVIEW", reason: "appleIntentAlreadyFulfilled",
    });
    await apply(f, newer(baseRefund, { revocationDate: undefined }), undefined, "NOTIFICATION");
    expect(await prisma.appleTransaction.findUniqueOrThrow({ where: { id: change.row.id } }))
      .toMatchObject({ status: "GRANTED", lastIssue: null, revocationDate: null });
    expect((await getOrganizationPlan(f.org.id)).plan).toBe("BUSINESS");
    expect((await getAppleBillingState(f.actor)).temporaryUpgrades.find((period) => period.id === change.period.id))
      .toMatchObject({ status: "ACTIVE", requiresReview: false, reason: null });
    expect(await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: change.intent.intentId } }))
      .toMatchObject({ status: "REVIEW", lastIssue: "appleIntentAlreadyFulfilled" });
    await expect(checkoutGuard()).rejects.toThrow("applePaymentNeedsReview");
    await apply(f, newer(duplicateCharge, { revocationDate: Date.now() }), undefined, "NOTIFICATION");
    expect((await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: change.intent.intentId } })).status).toBe("COMPLETED");
    expect((await getSubscriptionPaymentState(f.org.id)).purchaseBlockedReason).toBeNull();
    await checkoutGuard();
    expect(await bucketRows(f)).toEqual(buckets);
  });

  it("never treats a manual GoPay bank-refund attestation as base or increment revocation", async () => {
    const f = await seed(), base = await paidWeb(f), change = await grantChange(f);
    const operatorOrg = await prisma.organization.create({ data: { name: "Synthetic operator" } });
    const operator = await prisma.user.create({ data: { organizationId: operatorOrg.id, email: "temporary-refund-operator@example.invalid",
      name: "Synthetic operator", passwordHash: "not-a-login", role: "ADMIN" } });
    vi.stubEnv("PLATFORM_OWNER_EMAILS", operator.email);
    await recordManualSubscriptionRefund({ invoiceId: base.invoice.id, amountMinor: base.invoice.amountMinor,
      bankOperationId: `SYNTHETIC-${randomUUID()}`, bankTransferredOn: businessDateKey(new Date()),
      reason: "Synthetic completed bank transfer attested by operator", idempotencyKey: randomUUID(), actorId: operator.id, requestId: randomUUID() });
    expect((await getOrganizationPlan(f.org.id)).plan).toBe("BUSINESS");
    expect((await prisma.subscriptionPeriod.findUniqueOrThrow({ where: { id: base.period.id } })).revokedAt).toBeNull();
    expect(await prisma.subscriptionPeriod.findUniqueOrThrow({ where: { id: change.period.id } })).toMatchObject({ revokedAt: null, dependencyRevokedAt: null });
  });

  it("serializes competing intents/native attempts and duplicate receipts with one dependent grant", async () => {
    const f = await seed(); await paidWeb(f);
    const preview = await previewChange(f), key = randomUUID();
    const intents = await Promise.all([changeIntent(f, preview, key), changeIntent(f, preview, key)]);
    expect(intents[0].intentId).toBe(intents[1].intentId);
    await expect(changeIntent(f, preview)).rejects.toThrow(/applePurchasePending|applePaymentNeedsReview/);
    const attempts = await Promise.allSettled([authorizeApplePurchase(f.actor, intents[0].intentId, { attemptId: randomUUID() }),
      authorizeApplePurchase(f.actor, intents[0].intentId, { attemptId: randomUUID() })]);
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const payload = signed(intents[0]);
    const results = await Promise.all([apply(f, payload), apply(f, payload, undefined, "NOTIFICATION")]);
    expect(results.map((row) => row.status)).toEqual(["GRANTED", "GRANTED"]);
    expect(await prisma.subscriptionPeriod.count({ where: { parentPeriodId: { not: null } } })).toBe(1);
    await expect(previewChange(f)).rejects.toThrow("billingNoPaidChange");
  });

  it.each(["PREVIEW", "INTENT", "AUTHORIZED"] as const)("rejects changed funding at the %s boundary and retains an already paid receipt for review", async (stage) => {
    const f = await seed(); await paidWeb(f);
    const preview = await previewChange(f);
    const intent = stage === "PREVIEW" ? null : await changeIntent(f, preview);
    if (stage === "AUTHORIZED") await authorizeApplePurchase(f.actor, intent!.intentId, { attemptId: randomUUID() });
    await paidWeb(f, { ...enterprise, months: 6 }, new Date());
    if (!intent) await expect(changeIntent(f, preview)).rejects.toThrow(/appleTemporaryUpgradeSourceChanged|appleAccessChanged/);
    else if (stage === "INTENT") await expect(authorizeApplePurchase(f.actor, intent.intentId, { attemptId: randomUUID() })).rejects.toThrow(/appleTemporaryUpgradeSourceChanged|appleAccessChanged/);
    else {
      const result = await apply(f, signed(intent), intent.intentId);
      expect(result).toMatchObject({ status: "REVIEW", reason: "appleTemporaryUpgradeSourceChanged" });
      expect(await prisma.appleTransaction.count({ where: { intentId: intent.intentId, status: "REVIEW" } })).toBe(1);
    }
    expect(await prisma.subscriptionPeriod.count({ where: { parentPeriodId: { not: null } } })).toBe(0);
    expect((await getOrganizationPlan(f.org.id)).plan).toBe("STARTER");
  });

  it("keeps a paid lower future period unchanged and refuses an incompatible temporary promise", async () => {
    const f = await seed(), base = await paidWeb(f), future = await paidWeb(f, { ...starter, months: 6 }, new Date());
    const frozen = await prisma.subscriptionPeriod.findUniqueOrThrow({ where: { id: future.period.id } });
    await expect(previewChange(f)).rejects.toThrow("billingScheduledChangeExists");
    expect(await prisma.subscriptionPeriod.findUniqueOrThrow({ where: { id: future.period.id } })).toEqual(frozen);
    expect((await getOrganizationPlan(f.org.id)).activeSubscriptionPeriod?.id).toBe(base.period.id);
    expect(await prisma.applePurchaseIntent.count()).toBe(0);
  });

  it("drops an expired historical increment from TS and real-time SQL while preserving the GoPay grace baseline", async () => {
    const f = await seed();
    const historicalStart = new Date(Date.now() - 32 * DAY);
    const base = await paidWeb(f, starter, historicalStart);
    expect(base.period.endsAt.getTime()).toBeLessThan(Date.now());
    expect(base.period.endsAt.getTime()).toBeGreaterThan(Date.now() - 7 * DAY);
    // Insert coherent served history at birth. The synthetic certificate was
    // issued recently, so verify a current-signed historical purchase on the
    // real clock; do not pretend that certificate existed at purchase time.
    // This retained-history fixture does not claim a late live grant succeeds.
    const historicalPurchase = new Date(historicalStart.getTime() + DAY);
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(historicalPurchase);
    const history = await (async () => { try {
      const preview = await previewChange(f), purchase = verifyPurchaseQuote(preview.quoteToken, f.org.id);
      const account = await prisma.appleBillingAccount.create({ data: { organizationId: f.org.id, appAccountToken: randomUUID(), createdAt: historicalPurchase } });
      const intent = await prisma.applePurchaseIntent.create({ data: {
        organizationId: f.org.id, createdById: f.adminUser.id, idempotencyKey: randomUUID(), scope: "SUBSCRIPTION", action: "CHANGE",
        status: "COMPLETED",
        offerKey: preview.offerKey, productId: preview.productId, productType: "NON_RENEWING", environment: "Sandbox",
        appAccountToken: account.appAccountToken, purchaseAppAccountToken: randomUUID(),
        offerSnapshot: { kind: "SUBSCRIPTION", offerKey: preview.offerKey, temporaryUpgrade: true }, purchaseSnapshot: json(purchase),
        termsVersion: LEGAL_TERMS_VERSION, termsUrl: "https://www.bazaar.kg/legal/offer", expiresAt: new Date(purchase.expiresAt),
        createdAt: historicalPurchase, updatedAt: historicalPurchase, authorizedAt: historicalPurchase, nativeAttemptId: randomUUID(),
      } });
      return { preview, purchase, intent };
    } finally { vi.useRealTimers(); } })();
    const payload = signed({ intentId: history.intent.id, productId: history.intent.productId, productType: history.intent.productType,
      action: "CHANGE", subscriptionGroupId: null, deferredSource: null,
      appAccountToken: history.intent.purchaseAppAccountToken!, environment: history.intent.environment,
      expiresAt: history.intent.expiresAt.toISOString(), priceConstraint: history.preview.priceConstraint },
    { purchaseDate: historicalPurchase.getTime(), signedDate: Date.now() });
    const receipt = await syntheticAppleVerifier().transaction(payload), data = receipt.data;
    expect(data.purchaseDate).toBe(historicalPurchase.getTime());
    const period = await prisma.$transaction(async (tx) => {
      const transaction = await tx.appleTransaction.create({ data: {
        organizationId: f.org.id, intentId: history.intent.id, transactionId: data.transactionId,
        originalTransactionId: data.originalTransactionId, environment: data.environment, appAccountToken: data.appAccountToken,
        productId: data.productId, productType: receipt.productType, quantity: data.quantity ?? 1,
        purchaseDate: new Date(data.purchaseDate), priceMillis: BigInt(data.price!), currency: data.currency,
        storefrontId: data.storefrontId, ownershipType: data.inAppOwnershipType, offerSnapshot: json(history.intent.offerSnapshot),
        signedTransactionInfo: receipt.signedTransactionInfo, lastSignedAt: new Date(data.signedDate), status: "GRANTED", createdAt: historicalPurchase,
      } });
      return tx.subscriptionPeriod.create({ data: { organizationId: f.org.id, appleTransactionId: transaction.id,
        parentPeriodId: base.period.id, plan: history.purchase.plan, startsAt: new Date(history.purchase.startsAt),
        endsAt: new Date(history.purchase.endsAt), purchaseSnapshot: json(history.purchase), createdAt: historicalPurchase } });
    });
    expect(period.revokedAt).toBeNull();
    const current = await getOrganizationPlan(f.org.id);
    expect(current.plan).toBe("STARTER");
    expect(current.activePurchase?.cycleStartsAt).toBe(readPurchaseSnapshot(base.period.purchaseSnapshot)!.cycleStartsAt);
    expect(current.subscriptionPaymentSource).toBe("GATEWAY");
    expect(resolveOrganizationAccessState(current).inGrace).toBe(true);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } })).plan).toBe("STARTER");
    await expect(sqlFeature(f)).rejects.toThrow("featureLockedPlan");
    await expect(prisma.store.create({ data: { organizationId: f.org.id, name: "Expired C cannot fund store", code: "EXPIRED-C" } })).rejects.toThrow("subscriptionCapacityExceeded");
  });

  it("uses the signed per-intent token for old receipts even when a newer same-SKU intent is supplied", async () => {
    const f = await seed(); await paidWeb(f);
    const preview = await previewChange(f), first = await changeIntent(f, preview), firstAttempt = randomUUID();
    await authorizeApplePurchase(f.actor, first.intentId, { attemptId: firstAttempt });
    const oldPaid = signed(first);
    await cancelApplePurchaseIntent(f.actor, first.intentId, firstAttempt);
    const second = await changeIntent(f, await previewChange(f, enterprise));
    expect(second.productId).toBe(first.productId);
    expect(second.appAccountToken).not.toBe(first.appAccountToken);
    await authorizeApplePurchase(f.actor, second.intentId, { attemptId: randomUUID() });
    const result = await apply(f, oldPaid, second.intentId);
    expect(result.status).toBe("GRANTED");
    const recorded = await prisma.appleTransaction.findUniqueOrThrow({ where: { environment_transactionId: { environment: "Sandbox", transactionId: result.transactionId } } });
    expect(recorded.intentId).toBe(first.intentId);
    expect((await getOrganizationPlan(f.org.id)).plan).toBe("BUSINESS");
    expect((await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: second.intentId } })).status).toBe("PENDING");
    expect(await apply(f, signed(second), second.intentId)).toMatchObject({ status: "REVIEW", reason: "appleTemporaryUpgradeSourceChanged" });
    expect(await prisma.subscriptionPeriod.count({ where: { parentPeriodId: { not: null } } })).toBe(1);
  });

  it("rejects idempotency reuse for a different target sharing the same upgrade-band SKU", async () => {
    const f = await seed(); await paidWeb(f);
    const firstPreview = await previewChange(f), secondPreview = await previewChange(f, enterprise), key = randomUUID();
    expect(firstPreview.offerKey).toBe(secondPreview.offerKey);
    const first = await changeIntent(f, firstPreview, key);
    await expect(changeIntent(f, secondPreview, key)).rejects.toThrow("idempotencyConflict");
    expect((await changeIntent(f, firstPreview, key)).intentId).toBe(first.intentId);
    expect(await prisma.applePurchaseIntent.count()).toBe(1);
  });

  it("retains a price-mismatched signed charge in review without granting the target", async () => {
    const f = await seed(); await paidWeb(f);
    const intent = await changeIntent(f, await previewChange(f));
    await authorizeApplePurchase(f.actor, intent.intentId, { attemptId: randomUUID() });
    const result = await apply(f, signed(intent, { appAccountToken: intent.appAccountToken, productId: intent.productId, price: 3990 }), intent.intentId);
    expect(result.status).toBe("REVIEW");
    expect(await prisma.appleTransaction.count({ where: { intentId: intent.intentId, priceMillis: 3990n, status: "REVIEW" } })).toBe(1);
    expect(await prisma.subscriptionPeriod.count({ where: { parentPeriodId: { not: null } } })).toBe(0);
    expect((await getOrganizationPlan(f.org.id)).plan).toBe("STARTER");
  });

  it("keeps the exact purchase token, tenant funding and original monthly snapshot immutable in PostgreSQL", async () => {
    const f = await seed(); await paidWeb(f);
    const change = await grantChange(f);
    const originalIntent = await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: change.intent.intentId } });
    expect(originalIntent.purchaseAppAccountToken).toBe(change.intent.appAccountToken);
    expect(originalIntent.appAccountToken).not.toBe(change.intent.appAccountToken);
    await expect(prisma.applePurchaseIntent.update({ where: { id: originalIntent.id }, data: { purchaseAppAccountToken: randomUUID() } })).rejects.toThrow("Apple purchase intent snapshot is immutable");
    await expect(prisma.appleTransaction.update({ where: { id: change.row.id }, data: { appAccountToken: originalIntent.appAccountToken } })).rejects.toThrow();
    await expect(prisma.subscriptionPeriod.update({ where: { id: change.period.id }, data: {
      purchaseSnapshot: json({ ...readPurchaseSnapshot(change.period.purchaseSnapshot)!, cycleStartsAt: new Date().toISOString(), anchorDay: 1 }),
    } })).rejects.toThrow(/immutable/);
    expect(await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: originalIntent.id } })).toEqual(originalIntent);
    expect(await prisma.subscriptionPeriod.findUniqueOrThrow({ where: { id: change.period.id } })).toEqual(change.period);
  });

  it("checks current role after the organization wait before reserving a native purchase", async () => {
    const f = await seed(); await paidWeb(f);
    const intent = await changeIntent(f, await previewChange(f));
    let started!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const unlocked = new Promise<void>((resolve) => { release = resolve; });
    const blocker = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${f.org.id} FOR UPDATE`;
      started(); await unlocked;
      await tx.user.update({ where: { id: f.adminUser.id }, data: { role: "STAFF" } });
    });
    await entered;
    const authorization = authorizeApplePurchase(f.actor, intent.intentId, { attemptId: randomUUID() });
    release(); await blocker;
    await expect(authorization).rejects.toThrow("forbidden");
    expect((await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: intent.intentId } })).authorizedAt).toBeNull();
  });

  it.each(["role", "active"] as const)("waits for an uncommitted actor %s revocation instead of authorizing from a stale MVCC read", async (change) => {
    const f = await seed(); await paidWeb(f);
    const intent = await changeIntent(f, await previewChange(f));
    const actorLocked = deferred<number>(), releaseActor = deferred<void>();
    const holder = settled(prisma.$transaction(async (tx) => {
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      await tx.user.update({ where: { id: f.adminUser.id }, data: change === "role" ? { role: "STAFF" } : { isActive: false } });
      actorLocked.resolve(pid); await releaseActor.promise;
    }, { maxWait: 5000, timeout: 10_000 }));
    void holder.then((result) => { if (result.status === "rejected") actorLocked.reject(result.reason); });
    let authorization: ReturnType<typeof settled<unknown>> | undefined;
    try {
      const pid = await actorLocked.promise;
      let completed = false;
      authorization = settled(authorizeApplePurchase(f.actor, intent.intentId, { attemptId: randomUUID() }));
      void authorization.then(() => { completed = true; });
      let blocked = false;
      for (let tries = 0; tries < 200 && !completed; tries++) {
        const [state] = await prisma.$queryRaw<{ blocked: boolean }[]>`SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))
        ) AS blocked`;
        if (state.blocked) { blocked = true; break; }
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      releaseActor.resolve(undefined);
      expect(await holder).toMatchObject({ status: "fulfilled" });
      expect(await authorization).toMatchObject({ status: "rejected", reason: { message: "forbidden", code: "FORBIDDEN" } });
      expect((await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: intent.intentId } })).authorizedAt).toBeNull();
    } finally {
      releaseActor.resolve(undefined);
      await Promise.all([holder, ...(authorization ? [authorization] : [])]);
    }
  }, 15_000);

  it.each(["role", "active"] as const)("serializes actual %s administration without a profile/audit FK deadlock", async (change) => {
    const f = await seed(); await paidWeb(f);
    const operator = await prisma.user.create({ data: { organizationId: f.org.id, email: "second-admin@synthetic.invalid",
      name: "Second administrator", passwordHash: "not-a-login", role: "ADMIN" } });
    const intent = await changeIntent(f, await previewChange(f));
    const profileLocked = deferred<number>(), releaseProfile = deferred<void>();
    const profile = settled(prisma.$transaction(async (tx) => {
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      // This is the existing profile write order: User first, followed by a
      // tenant-bound audit insert. The real FK requests KEY SHARE on Org.
      await tx.user.update({ where: { id: f.adminUser.id }, data: { preferredLocale: "kg" } });
      profileLocked.resolve(pid); await releaseProfile.promise;
      await writeAuditLog(tx, { organizationId: f.org.id, actorId: f.adminUser.id,
        action: "USER_UPDATE_LOCALE", entity: "User", entityId: f.adminUser.id,
        after: { preferredLocale: "kg" }, requestId: randomUUID() });
    }, { maxWait: 5000, timeout: 10_000 }));
    void profile.then((result) => { if (result.status === "rejected") profileLocked.reject(result.reason); });
    let authorization: ReturnType<typeof settled<unknown>> | undefined;
    let administration: ReturnType<typeof settled<unknown>> | undefined;
    try {
      const pid = await profileLocked.promise;
      authorization = settled(authorizeApplePurchase(f.actor, intent.intentId, { attemptId: randomUUID() }));
      let blocked = false;
      for (let tries = 0; tries < 200; tries++) {
        const [state] = await prisma.$queryRaw<{ blocked: boolean }[]>`SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))
        ) AS blocked`;
        if (state.blocked) { blocked = true; break; }
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      administration = settled(change === "role" ? updateUser({ userId: f.adminUser.id, organizationId: f.org.id,
        actorId: operator.id, requestId: randomUUID(), email: f.adminUser.email, name: f.adminUser.name,
        role: "STAFF", preferredLocale: "kg", storeIds: [f.store.id] })
        : setUserActive({ userId: f.adminUser.id, organizationId: f.org.id, actorId: operator.id, requestId: randomUUID(), isActive: false }));
      releaseProfile.resolve(undefined);
      expect(await profile).toMatchObject({ status: "fulfilled" });
      expect(await authorization).toMatchObject({ status: "fulfilled" });
      expect(await administration).toMatchObject({ status: "fulfilled" });
      const buyer = await prisma.user.findUniqueOrThrow({ where: { id: f.adminUser.id } });
      expect(change === "role" ? buyer.role : buyer.isActive).toBe(change === "role" ? "STAFF" : false);
      if (change === "role") expect(await prisma.userStoreAccess.count({ where: { userId: buyer.id, storeId: f.store.id } })).toBe(1);
    } finally {
      releaseProfile.resolve(undefined);
      await Promise.all([profile, ...(authorization ? [authorization] : []), ...(administration ? [administration] : [])]);
    }
  }, 15_000);

  it("rejects a deleted buyer's new authorization while retaining its immutable intent and base", async () => {
    const f = await seed(); const base = await paidWeb(f);
    const intent = await changeIntent(f, await previewChange(f));
    const password = "synthetic-delete-confirmation";
    await prisma.user.update({ where: { id: f.adminUser.id }, data: { passwordHash: await bcrypt.hash(password, 4) } });
    await deleteOwnAccount({ userId: f.adminUser.id, organizationId: f.org.id, password, confirmation: "DELETE", requestId: randomUUID() });
    await expect(authorizeApplePurchase(f.actor, intent.intentId, { attemptId: randomUUID() })).rejects.toThrow("forbidden");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: f.adminUser.id } })).deletedAt).not.toBeNull();
    expect((await prisma.subscriptionPeriod.findUniqueOrThrow({ where: { id: base.period.id } })).revokedAt).toBeNull();
    expect(await prisma.applePurchaseIntent.count({ where: { id: intent.intentId, createdById: f.adminUser.id } })).toBe(1);
  });

  it("keeps temporary sales disabled without the separately reviewed policy", async () => {
    const f = await seed(); await paidWeb(f);
    vi.stubEnv("APPLE_BILLING_TEMPORARY_UPGRADES_APPROVED", "false");
    expect(await getAppleTemporaryUpgradeCatalog(f.actor)).toMatchObject({ ready: false, unavailableReason: "appleTemporaryUpgradePolicyUnavailable" });
    await expect(previewChange(f)).rejects.toThrow("appleTemporaryUpgradePolicyUnavailable");
    expect(await prisma.applePurchaseIntent.count()).toBe(0);
  });

  it("accepts a legitimate per-intent C token in the real aggregate read-only migration preflight", async () => {
    const { databaseUrl } = assertSafeTestDatabaseReset();
    const connection = new URL(databaseUrl);
    const args = ["--url-env", "EXPLICIT_OWNED_TEMPORARY_UPGRADE_AUDIT_URL",
      "--expect-host", connection.hostname, "--expect-port", connection.port || "5432",
      "--expect-database", decodeURIComponent(connection.pathname.slice(1)),
      "--expect-user", decodeURIComponent(connection.username), "--expect-stage", "POST_TEMPORARY_MINIMUM"];
    // The owned local runner pins its approved binary; ordinary Linux CI can
    // keep the existing psql-on-PATH convention. No implicit database is used.
    if (process.env.IOS_MIGRATION_PREFLIGHT_PSQL) args.push("--psql", process.env.IOS_MIGRATION_PREFLIGHT_PSQL);
    const options = parsePreflightTarget(args, { EXPLICIT_OWNED_TEMPORARY_UPGRADE_AUDIT_URL: databaseUrl });
    const f = await seed(), base = await paidWeb(f), change = await grantChange(f);
    const snapshot = async () => ({
      account: await prisma.appleBillingAccount.findUniqueOrThrow({ where: { organizationId: f.org.id } }),
      intents: await prisma.applePurchaseIntent.findMany({ where: { organizationId: f.org.id }, orderBy: { id: "asc" } }),
      transactions: await prisma.appleTransaction.findMany({ where: { organizationId: f.org.id }, orderBy: { id: "asc" } }),
      periods: await prisma.subscriptionPeriod.findMany({ where: { organizationId: f.org.id }, orderBy: { id: "asc" } }),
      invoices: await prisma.subscriptionInvoice.findMany({ where: { organizationId: f.org.id }, orderBy: { id: "asc" } }),
    });
    const before = await snapshot();
    expect(before.intents[0]?.purchaseAppAccountToken).toBe(change.intent.appAccountToken);
    expect(before.transactions[0]?.appAccountToken).toBe(change.intent.appAccountToken);
    expect(before.account.appAccountToken).not.toBe(change.intent.appAccountToken);
    expect(before.periods.find((period) => period.id === change.period.id)?.parentPeriodId).toBe(base.period.id);
    // Execute the actual SQL in a separate psql read-only transaction, without
    // a fake executor, fixture mutations, or disabling any financial guard.
    const report = await runIosBillingPreflight(options);
    expect(report).toMatchObject({ ok: true, schemaStage: "POST_TEMPORARY_MINIMUM", transactionReadOnly: true,
      blockerChecks: 0, skippedChecks: 0 });
    for (const name of ["apple_intent_account_binding_invalid", "apple_transaction_account_binding_invalid",
      "apple_transaction_intent_binding_invalid", "temporary_upgrade_token_namespace_collisions",
      "temporary_upgrade_intent_shape_invalid", "temporary_upgrade_period_binding_invalid",
      "temporary_upgrade_standalone_period_invalid", "temporary_upgrade_dependency_state_invalid",
      "temporary_upgrade_ancestry_invalid", "temporary_upgrade_unserved_dependency_unreviewed",
      "temporary_minimum_function_bodies_changed", "temporary_minimum_trigger_invalid", "temporary_minimum_quote_invalid"]) {
      expect(report.checks.find((check) => check.name === name)).toMatchObject({ count: 0, skipped: false });
    }
    expect(await snapshot()).toEqual(before);
    const output = JSON.stringify(report);
    for (const privateValue of [f.org.id, f.adminUser.id, f.adminUser.email, base.invoice.id, base.period.id,
      change.intent.intentId, change.intent.appAccountToken, before.account.appAccountToken,
      change.row.id, change.row.transactionId, change.period.id, change.payload]) {
      expect(output).not.toContain(privateValue);
    }
    expect(output).not.toContain(databaseUrl);
  }, 15_000);
});
