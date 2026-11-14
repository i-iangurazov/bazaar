import { createHash } from "node:crypto";
import type { Prisma, ApplePurchaseIntent } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { getOrganizationPlan } from "@/server/services/planLimits";
import { subscriptionSelectionSchema } from "@/lib/billing/subscriptionPricing";
import { appleBillingConfig, appleEnvironmentForOrganization } from "./appleConfig";
import { calculateTemporaryUpgradeBaseQuote } from "./subscriptionQuotes";
import { readPurchaseSnapshot, signPurchaseQuote, type PurchaseSnapshot } from "./purchaseSnapshot";
import { subscriptionUsageContext } from "./subscriptionUsage";
import { assertScheduledSubscriptionCompatibility, assertSubscriptionSelectionReady } from "./subscriptionPreparation";
import { selectTemporaryUpgradeBand, temporaryBandOfferKey, temporaryUpgradePolicy } from "./appleTemporaryUpgradePolicy";

export const temporaryUpgradePreviewInputSchema = z.object({ expectedOrganizationId: z.string().min(1).max(80),
  selection: subscriptionSelectionSchema, storefrontId: z.string().regex(/^[0-9]{1,40}$/), currency: z.string().regex(/^[A-Z]{3}$/) }).strict();
type Actor = { id: string; organizationId: string };
const canonical = (value: unknown): unknown => value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.map(canonical) :
  value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, canonical(v)])) : value;
export const temporaryUpgradeDigest = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
async function assertActor(actor: Actor, db: Prisma.TransactionClient) {
  if (db !== prisma) await db.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.id} AND "organizationId" = ${actor.organizationId} FOR UPDATE`;
  if (!await db.user.findFirst({ where: { id: actor.id, organizationId: actor.organizationId, role: "ADMIN", isActive: true, deletedAt: null }, select: { id: true } }))
    throw new AppError("forbidden", "FORBIDDEN", 403);
}
export function temporaryUpgradeReadiness(organizationId: string) {
  const config = appleBillingConfig(), commercial = temporaryUpgradePolicy();
  const environment = appleEnvironmentForOrganization(organizationId, config);
  const environmentAllowed = environment !== "Sandbox" || config.sandboxOrganizations.has(organizationId);
  const overlap = commercial.policy?.bands.some((band) => config.catalog.some((entry) => entry.productId === band.productId));
  return { config, policy: commercial.policy, environment,
    ready: config.foundationReady && commercial.ready && environmentAllowed && !overlap,
    reason: !environmentAllowed ? "appleSandboxNotAllowed" : overlap ? "appleCatalogMismatch" : !commercial.ready ? "appleTemporaryUpgradePolicyUnavailable" : "appleUnavailable" };
}
export async function temporaryUpgradeSource(db: Prisma.TransactionClient, organizationId: string) {
  const org = await getOrganizationPlan(organizationId, db), source = org.activeSubscriptionPeriod;
  if (!source || source.endsAt <= new Date()) throw new AppError("billingNoActivePeriod", "CONFLICT", 409);
  let period = source, depth = 0;
  const path = [];
  for (;;) {
    if (++depth > 64 || period.revokedAt || period.dependencyRevokedAt) throw new AppError("appleTemporaryUpgradeSourceInvalid", "CONFLICT", 409);
    path.push(period);
    if (!period.parentPeriodId) break;
    const parent = await db.subscriptionPeriod.findFirst({ where: { id: period.parentPeriodId, organizationId } });
    if (!parent) throw new AppError("appleTemporaryUpgradeSourceInvalid", "CONFLICT", 409);
    period = parent;
  }
  const transaction = period.appleTransactionId ? await db.appleTransaction.findUnique({ where: { id: period.appleTransactionId } }) : null;
  const invoice = period.invoiceId ? await db.subscriptionInvoice.findUnique({ where: { id: period.invoiceId } }) : null;
  if (transaction ? transaction.productType !== "NON_RENEWING" || transaction.status !== "GRANTED" : !invoice || invoice.provider !== "GOPAY" || invoice.status !== "PAID")
    throw new AppError("appleTemporaryUpgradeSourceInvalid", "CONFLICT", 409);
  const chain = await db.appleSubscriptionChain.findFirst({ where: { organizationId, OR: [{ autoRenewEnabled: true }, { expiresAt: { gt: new Date() } }, { graceExpiresAt: { gt: new Date() } }] }, select: { id: true } });
  if (chain) throw new AppError("appleSubscriptionManagedByApple", "CONFLICT", 409);
  const future = await db.subscriptionPeriod.findMany({ where: { organizationId, startsAt: { gt: new Date() } }, orderBy: [{ startsAt: "asc" }, { id: "asc" }] });
  const fingerprint = temporaryUpgradeDigest({ path, future });
  return { org, source, fingerprint, provider: transaction || source.parentPeriodId ? "APPLE" as const : "GOPAY" as const };
}
export async function getAppleTemporaryUpgradeCatalog(actor: Actor) {
  await assertActor(actor, prisma);
  const state = temporaryUpgradeReadiness(actor.organizationId), org = await getOrganizationPlan(actor.organizationId);
  let sourceReason: string | null = org.lifetimeAccess ? "billingLifetimeProtected" : org.subscriptionBillingMode !== "SELF_SERVE" || org.subscriptionStatus === "CANCELED" ? "billingManualAccessProtected" : null;
  if (state.ready && !sourceReason) {
    try { await temporaryUpgradeSource(prisma, actor.organizationId); }
    catch (error) { if (!(error instanceof AppError)) throw error; sourceReason = error.message; }
  }
  return { ready: state.ready && !sourceReason, unavailableReason: sourceReason ?? (state.ready ? null : state.reason), policyVersion: state.policy?.version ?? null,
    organization: { id: org.id, name: org.name }, currentSelection: { plan: org.plan, months: org.activePurchase?.months ?? 1, extras: org.subscriptionExtras },
    currentTermOnly: true as const, futureCoverageUnchanged: true as const, roundingMode: state.policy?.rounding ?? null,
    products: state.policy?.bands.map((band) => ({ productId: band.productId, productType: "NON_RENEWING" as const } )) ?? [],
    markets: state.policy ? [...new Map(state.policy.bands.flatMap((band) => band.prices).map((price) => [`${price.storefrontId}:${price.currency}`, { storefrontId: price.storefrontId, currency: price.currency }] as const)).values()] : [],
  };
}
export async function previewAppleTemporaryUpgrade(actor: Actor, raw: z.infer<typeof temporaryUpgradePreviewInputSchema>) {
  const input = temporaryUpgradePreviewInputSchema.parse(raw);
  if (input.expectedOrganizationId !== actor.organizationId) throw new AppError("applePurchaseOrganizationMismatch", "CONFLICT", 409);
  return prisma.$transaction(async (db) => {
    await db.$queryRaw`SELECT id FROM "Organization" WHERE id = ${actor.organizationId} FOR NO KEY UPDATE`;
    await assertActor(actor, db);
    const state = temporaryUpgradeReadiness(actor.organizationId);
    if (!state.ready || !state.policy) throw new AppError(state.reason, "CONFLICT", 409);
    const { org, source, fingerprint, provider } = await temporaryUpgradeSource(db, actor.organizationId);
    const quote = await calculateTemporaryUpgradeBaseQuote(actor.organizationId, { ...input.selection, action: "CHANGE" }, db);
    quote.expiresAt = new Date(Math.min(new Date(quote.expiresAt).getTime(), new Date(state.policy.validUntil).getTime())).toISOString();
    const selected = selectTemporaryUpgradeBand(state.policy, quote.amountMinor, input.storefrontId, input.currency);
    const usage = subscriptionUsageContext(org);
    quote.appleTemporaryUpgrade = { version: 1, policyVersion: state.policy.version, policyDigest: temporaryUpgradeDigest(state.policy),
      sourceFingerprint: fingerprint, bandKey: selected.band.key, productId: selected.band.productId, price: selected.price,
      chargedServiceMinor: selected.chargedServiceMinor, ownerDiscountMinor: selected.ownerDiscountMinor,
      ...(selected.minimumCharge ? { minimumCharge: selected.minimumCharge } : {}),
      ...(selected.roundingMode ? { roundingMode: selected.roundingMode, upwardRounding: selected.upwardRounding } : {}),
      usageContext: { version: 1, origin: usage.origin.toISOString(), anchorDay: usage.anchorDay, paidEnd: usage.paidEnd?.toISOString() ?? null,
        trialOrigin: usage.trialOrigin.toISOString() } };
    const sourcePurchase = readPurchaseSnapshot(source.purchaseSnapshot);
    return { offerKey: temporaryBandOfferKey(state.policy, selected.band.key), action: "CHANGE" as const,
      organization: { id: org.id, name: org.name }, quoteToken: signPurchaseQuote(quote),
      productId: selected.band.productId, productType: "NON_RENEWING" as const,
      selection: { plan: quote.plan, months: quote.months, extras: quote.extras },
      target: { selection: { plan: quote.plan, months: quote.months, extras: quote.extras }, entitlements: quote.entitlements! },
      source: { id: source.id, plan: org.plan, extras: org.subscriptionExtras, months: sourcePurchase?.months ?? 1, provider,
        startsAt: source.startsAt.toISOString(), endsAt: source.endsAt.toISOString() },
      timing: { startsAt: quote.startsAt, endsAt: quote.endsAt, validUntil: quote.expiresAt },
      priceConstraint: temporaryUpgradePriceConstraint(quote),
      roundingMode: state.policy.rounding,
      minimumChargeApplied: Boolean(selected.minimumCharge || selected.upwardRounding?.minimumPriceApplied),
      serviceValue: { currency: "KGS" as const, incrementalMinor: quote.amountMinor, chargedServiceMinor: selected.chargedServiceMinor,
        ownerDiscountMinor: selected.ownerDiscountMinor, minimumChargeAdjustmentMinor: selected.minimumCharge?.serviceAdjustmentMinor ??
          (selected.upwardRounding?.minimumPriceApplied ? selected.upwardRounding.serviceAdjustmentMinor : 0),
        upwardRoundingAdjustmentMinor: selected.upwardRounding?.serviceAdjustmentMinor ?? 0 },
      currentTermOnly: true as const, futureCoverageUnchanged: true as const, parentDependent: true as const };
  });
}
export function temporaryUpgradePriceConstraint(purchase: PurchaseSnapshot | null) {
  const price = purchase?.appleTemporaryUpgrade?.price;
  return price ? { storefrontId: price.storefrontId, currency: price.currency, priceMillis: String(price.priceMillis) } : null;
}
export async function assertTemporaryUpgradeQuote(db: Prisma.TransactionClient, organizationId: string, purchase: PurchaseSnapshot, checkPolicy: boolean) {
  const context = purchase.appleTemporaryUpgrade;
  if (!context || purchase.kind !== "UPGRADE" || !purchase.entitlements || !purchase.sourcePeriodId) throw new AppError("appleCatalogMismatch", "CONFLICT", 409);
  if (checkPolicy) {
    const ready = temporaryUpgradeReadiness(organizationId);
    if (!ready.ready || !ready.policy || temporaryUpgradeDigest(ready.policy) !== context.policyDigest) throw new AppError("appleTemporaryUpgradePolicyUnavailable", "CONFLICT", 409);
    const selected = selectTemporaryUpgradeBand(ready.policy, purchase.amountMinor, context.price.storefrontId, context.price.currency);
    if (temporaryUpgradeDigest({ bandKey: selected.band.key, productId: selected.band.productId, price: selected.price,
      chargedServiceMinor: selected.chargedServiceMinor, ownerDiscountMinor: selected.ownerDiscountMinor, minimumCharge: selected.minimumCharge,
      roundingMode: selected.roundingMode, upwardRounding: selected.upwardRounding }) !==
      temporaryUpgradeDigest({ bandKey: context.bandKey, productId: context.productId, price: context.price,
        chargedServiceMinor: context.chargedServiceMinor, ownerDiscountMinor: context.ownerDiscountMinor, minimumCharge: context.minimumCharge,
        roundingMode: context.roundingMode, upwardRounding: context.upwardRounding }))
      throw new AppError("appleTemporaryUpgradePriceChanged", "CONFLICT", 409);
  }
  const { org, source, fingerprint } = await temporaryUpgradeSource(db, organizationId);
  if (source.id !== purchase.sourcePeriodId || fingerprint !== context.sourceFingerprint || source.endsAt.toISOString() !== purchase.endsAt ||
    purchase.expectedPlan !== org.storedPlan || purchase.expectedPeriodEnd !== (org.currentPeriodEndsAt?.toISOString() ?? null))
    throw new AppError("appleTemporaryUpgradeSourceChanged", "CONFLICT", 409);
  await assertSubscriptionSelectionReady(org, purchase.entitlements, db);
  await assertScheduledSubscriptionCompatibility(org, purchase.entitlements, db);
  return { org, source };
}
export function isTemporaryUpgradeIntent(intent: Pick<ApplePurchaseIntent, "purchaseSnapshot">) {
  return Boolean(readPurchaseSnapshot(intent.purchaseSnapshot)?.appleTemporaryUpgrade);
}
