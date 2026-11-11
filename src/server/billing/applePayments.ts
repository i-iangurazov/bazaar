import { applePreservedAccess, captureApplePreservedAccess } from "./appleAccess";
import { randomUUID } from "node:crypto";
import { Prisma, type ApplePurchaseIntent, type AppleSubscriptionChain, type AppleTransaction } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { getOrganizationPlan } from "@/server/services/planLimits";
import { calculateSubscriptionQuote } from "./subscriptionQuotes";
import { extendSubscriptionMonths } from "./paymentMath";
import { readPurchaseSnapshot, signPurchaseQuote, verifyPurchaseQuote, type PurchaseSnapshot } from "./purchaseSnapshot";
import { appleSubscriptionOffer, listAppleSubscriptionOffers, listAppleWhatsAppOffers } from "./appleOfferCatalog";
import { APPLE_MANAGEMENT_URL, APPLE_WHATSAPP_OFFER_VERSION, appleBillingConfig, appleEnvironmentForOrganization, type AppleProductMapping } from "./appleConfig";
import { assertNoApplePurchaseConflict, lockAppleOrganization, type ApplePurchaseScope } from "./appleConcurrency";
import { assertVerifiedAppleTransaction, verifyAppleTransaction, type VerifiedAppleTransaction } from "./appleVerification";
import { assertSubscriptionSelectionReady } from "./subscriptionPreparation";
import { whatsappConnection } from "@/server/whatsapp/access";
import { whatsappConfig } from "@/server/whatsapp/config";
import { assertTemporaryUpgradeQuote, isTemporaryUpgradeIntent, temporaryUpgradeDigest, temporaryUpgradePriceConstraint, temporaryUpgradeReadiness } from "./appleTemporaryUpgrades";
import { temporaryBandOfferKey } from "./appleTemporaryUpgradePolicy";
import { readAppleDeferredSource, type AppleDeferredSource } from "./appleDeferredEvidence";
import { parseAppleCompletionPublicKey } from "./appleCompletionCrypto";
import { appleNativeOriginAllowed } from "./appleNativeOrigin";
import { auditAppleSupportEvidence, type AppleSupportOperator } from "./appleSupportAuth";

export type AppleBillingActor = { id: string; organizationId: string };
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const offerSnapshotSchema = z.object({ kind: z.enum(["SUBSCRIPTION", "WHATSAPP_PACK"]), offerKey: z.string() }).passthrough();
export const appleIntentInputSchema = z.object({ expectedOrganizationId: z.string().min(1).max(80), offerKey: z.string().min(1).max(400), idempotencyKey: z.string().uuid(),
  action: z.enum(["RENEW", "CHANGE"]).default("RENEW"), quoteToken: z.string().max(12000).optional(),
  termsVersion: z.string().min(1).max(100), acceptedTerms: z.literal(true), storeId: z.string().min(1).max(80).optional() });
export async function assertAppleBillingActor(actor: AppleBillingActor, db: Prisma.TransactionClient = prisma) {
  if (db !== prisma) await db.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.id} AND "organizationId" = ${actor.organizationId} FOR UPDATE`;
  const user = await db.user.findFirst({ where: { id: actor.id, organizationId: actor.organizationId, isActive: true, deletedAt: null },
    select: { id: true, role: true } });
  if (user?.role !== "ADMIN") throw new AppError("forbidden", "FORBIDDEN", 403);
}
async function offersFor(organizationId: string, db: Prisma.TransactionClient = prisma) {
  const org = await getOrganizationPlan(organizationId, db);
  return { org, offers: [...listAppleSubscriptionOffers(org.contractTerms), ...listAppleWhatsAppOffers()] };
}
function assertMappingKind(offer: { kind: string }, mapping: AppleProductMapping) {
  if (offer.kind === "SUBSCRIPTION" ? mapping.productType === "CONSUMABLE" :
    mapping.productType !== "CONSUMABLE" || mapping.appleOfferVersion !== APPLE_WHATSAPP_OFFER_VERSION)
    throw new AppError("appleCatalogMismatch", "CONFLICT", 409);
}
const presentIntent = (intent: ApplePurchaseIntent) => {
  const product = z.object({ appleProduct: z.object({ subscriptionGroupId: z.string().optional() }).optional() }).safeParse(intent.offerSnapshot);
  const source = readAppleDeferredSource(intent.offerSnapshot);
  return { intentId: intent.id, productId: intent.productId, productType: intent.productType,
    action: intent.action as "RENEW" | "CHANGE", subscriptionGroupId: product.success ? product.data.appleProduct?.subscriptionGroupId ?? null : null,
    deferredSource: source ? { transactionId: source.transactionId, originalTransactionId: source.originalTransactionId,
      productId: source.productId, expiresAt: source.expiresAt } : null,
    appAccountToken: intent.purchaseAppAccountToken ?? intent.appAccountToken, environment: intent.environment, expiresAt: intent.expiresAt.toISOString(),
    priceConstraint: temporaryUpgradePriceConstraint(readPurchaseSnapshot(intent.purchaseSnapshot)) };
};

export async function getAppleBillingState(actor: AppleBillingActor) {
  await assertAppleBillingActor(actor);
  const config = appleBillingConfig();
  const { org, offers } = await offersFor(actor.organizationId);
  const environment = appleEnvironmentForOrganization(org.id, config);
  const environmentAllowed = environment !== "Sandbox" || config.sandboxOrganizations.has(org.id);
  const ready = config.ready && environmentAllowed;
  const unavailableReason = !environmentAllowed ? "appleSandboxNotAllowed" : config.unavailableReason;
  const now = new Date();
  const [pending, chains, webPending, transactions, temporaryPeriods, activeProduct] = await Promise.all([
    prisma.applePurchaseIntent.findFirst({ where: { organizationId: org.id, status: { in: ["PENDING", "REVIEW"] },
      OR: [{ status: "REVIEW" }, { expiresAt: { gt: now } }, { authorizedAt: { not: null } }] }, orderBy: { createdAt: "desc" } }),
    prisma.appleSubscriptionChain.findMany({ where: { organizationId: org.id } }),
    prisma.subscriptionInvoice.findFirst({ where: { organizationId: org.id, OR: [{ pendingSlot: org.id }, { status: "REVIEW" }] } }),
    prisma.appleTransaction.findMany({ where: { organizationId: org.id }, orderBy: { purchaseDate: "desc" }, take: 30 }),
    prisma.subscriptionPeriod.findMany({ where: { organizationId: org.id, parentPeriodId: { not: null } }, include: { appleTransaction: { select: { status: true, lastIssue: true } } }, orderBy: { startsAt: "desc" }, take: 30 }),
    org.activeSubscriptionPeriod?.appleTransactionId ? prisma.appleTransaction.findUnique({ where: { id: org.activeSubscriptionPeriod.appleTransactionId },
      select: { productId: true, productType: true } }) : Promise.resolve(null),
  ]);
  const activeChain = chains.find((v) => v.autoRenewEnabled === true || (v.expiresAt && v.expiresAt > now) || (v.graceExpiresAt && v.graceExpiresAt > now));
  const protectedReason = org.lifetimeAccess ? "billingLifetimeProtected" : org.subscriptionBillingMode !== "SELF_SERVE" || org.subscriptionStatus === "CANCELED" ? "billingManualAccessProtected" : null;
  return {
    organization: { id: org.id, name: org.name },
    ready, environment, unavailableReason,
    termsVersion: config.termsVersion, termsUrl: config.termsUrl, managementUrl: APPLE_MANAGEMENT_URL,
    offers: offers.map((offer) => {
      const mapping = config.catalog.find((m) => m.offerKey === offer.offerKey);
      let reason: string | null = !ready ? unavailableReason ?? "appleUnavailable" : !mapping ? "appleProductNotConfigured" : null;
      if (!reason && mapping) { try { assertMappingKind(offer, mapping); } catch { reason = "appleCatalogMismatch"; } }
      if (offer.kind === "SUBSCRIPTION") {
        reason ??= protectedReason ?? (pending?.scope === "SUBSCRIPTION" ? "applePurchasePending" : null) ??
          (webPending ? "billingPaymentPending" : null) ?? (activeChain ? "appleSubscriptionManagedByApple" : null);
        if (!reason && mapping?.productType === "AUTO_RENEWABLE" &&
          Math.max(org.currentPeriodEndsAt?.getTime() ?? 0, org.trialEndsAt?.getTime() ?? 0) > now.getTime()) reason = "appleExistingAccessActive";
      }
      let changeReason: string | null = offer.kind !== "SUBSCRIPTION" || mapping?.productType !== "AUTO_RENEWABLE" || !activeChain
        ? "appleChangeRequiresAppleSubscription" : !ready || !mapping ? unavailableReason ?? "appleUnavailable" : protectedReason;
      const initialMapping = activeChain && config.catalog.find((m) => m.productId === activeChain.productId);
      if (!changeReason && mapping?.subscriptionGroupId !== initialMapping?.subscriptionGroupId) changeReason = "appleCatalogMismatch";
      if (!changeReason && activeProduct?.productType === "AUTO_RENEWABLE" && mapping?.productId === activeProduct.productId) changeReason = "billingNoPaidChange";
      if (!changeReason && pending?.scope === "SUBSCRIPTION") changeReason = "applePurchasePending";
      if (!changeReason && webPending) changeReason = "billingPaymentPending";
      const availableActions: ("RENEW" | "CHANGE")[] = [...(!reason ? ["RENEW" as const] : []), ...(!changeReason ? ["CHANGE" as const] : [])];
      const start = new Date(Math.max(now.getTime(), org.currentPeriodEndsAt?.getTime() ?? 0, org.trialEndsAt?.getTime() ?? 0));
      const anchor = org.currentPeriodEndsAt?.getTime() === start.getTime() && org.billingAnchorDay ? org.billingAnchorDay : start.getUTCDate();
      const timing = offer.kind === "SUBSCRIPTION" && mapping?.productType === "NON_RENEWING" ? {
        kind: "SERVER_NON_RENEWING" as const, startsAt: start.toISOString(), endsAt: extendSubscriptionMonths(start, anchor, offer.selection.months).toISOString(),
        calculatedAt: now.toISOString(), validUntil: new Date(now.getTime() + 15 * 60_000).toISOString(),
      } : null;
      return { ...offer, timing, productId: mapping?.productId ?? null, productType: mapping?.productType ?? null,
        available: availableActions.length > 0, availableActions, renewUnavailableReason: reason, changeUnavailableReason: changeReason,
        unavailableReason: availableActions.length ? null : reason };
    }),
    recentTransactions: transactions.map((t) => ({ transactionId: t.transactionId, originalTransactionId: t.originalTransactionId,
      productId: t.productId, status: t.status, reason: t.lastIssue, purchaseDate: t.purchaseDate.toISOString(), expiresDate: t.expiresDate?.toISOString() ?? null,
      priceMillis: t.priceMillis?.toString() ?? null, currency: t.currency, environment: t.environment, refundable: t.status !== "REVOKED" })),
    temporaryUpgrades: temporaryPeriods.map((period) => ({ id: period.id, sourcePeriodId: period.parentPeriodId!,
      startsAt: period.startsAt.toISOString(), endsAt: period.endsAt.toISOString(), plan: period.plan,
      extras: readPurchaseSnapshot(period.purchaseSnapshot)?.extras,
      status: period.revokedAt ? "REVOKED" as const : period.endsAt <= now && period.appleTransaction?.lastIssue !== "appleTemporaryUpgradeDependencyRevoked" ? "EXPIRED" as const :
        period.dependencyRevokedAt || period.appleTransaction?.lastIssue === "appleTemporaryUpgradeDependencyRevoked" ? "SUSPENDED" as const : period.startsAt > now ? "SCHEDULED" as const : "ACTIVE" as const,
      requiresReview: period.appleTransaction?.status === "REVIEW", reason: period.appleTransaction?.lastIssue ?? null,
      parentDependent: true as const, currentTermOnly: true as const })),
    access: { plan: org.plan, extras: org.subscriptionExtras, source: org.lifetimeAccess ? "LIFETIME" : org.activeSubscriptionPeriod?.appleTransactionId ? "APPLE" : org.activeSubscriptionPeriod?.invoiceId ? "GATEWAY" : org.trialOffer ? "TRIAL" : "MANUAL",
      currentPeriodStartsAt: org.activeSubscriptionPeriod?.startsAt.toISOString() ?? null, currentPeriodEndsAt: org.activeSubscriptionPeriod?.endsAt.toISOString() ?? null,
      lifetimeAccess: org.lifetimeAccess, billingMode: org.subscriptionBillingMode, paidUntil: org.currentPeriodEndsAt?.toISOString() ?? null,
      trialUntil: org.trialEndsAt?.toISOString() ?? null, appleAutoRenew: activeChain?.autoRenewEnabled ?? false,
      appleCoverageUntil: activeChain?.expiresAt?.toISOString() ?? null,
      appleIssue: activeChain?.lastIssue ?? null,
      appleScheduledChange: activeChain?.pendingProductId ? { productId: activeChain.pendingProductId,
        startsAt: activeChain.expiresAt?.toISOString() ?? null, offer: activeChain.pendingChangeOffer } : null },
    pendingIntent: pending ? { ...presentIntent(pending), status: pending.status, scope: pending.scope } : null,
  };
}

async function assertWhatsAppSale(actor: AppleBillingActor, storeId: string | undefined, db: Prisma.TransactionClient) {
  if (!storeId) throw new AppError("appleStoreRequired", "BAD_REQUEST", 400);
  const access = await whatsappConnection(actor, storeId, { admin: true, active: true }, db);
  const wa = whatsappConfig();
  const worker = await db.whatsAppWorkerState.findUnique({ where: { id: "worker" } });
  if (!wa.salesReady || !wa.paymentsApproved || access.connection?.state !== "CONNECTED" || !worker ||
    !["READY", "MANUAL"].includes(worker.state) || worker.heartbeatAt < new Date(Date.now() - 90_000))
    throw new AppError("billingPaymentsUnavailable", "CONFLICT", 409);
}
async function assertIntentConditions(db: Prisma.TransactionClient, actor: AppleBillingActor, intent?: ApplePurchaseIntent,
  scope?: ApplePurchaseScope, now = new Date(), action: "RENEW" | "CHANGE" = "RENEW") {
  const target = intent?.scope as ApplePurchaseScope ?? scope!;
  await assertNoApplePurchaseConflict(db, actor.organizationId, target, now, intent?.id, (intent?.action ?? action) === "CHANGE");
  if (target === "SUBSCRIPTION") {
    if (await db.subscriptionInvoice.findFirst({ where: { organizationId: actor.organizationId,
      OR: [{ pendingSlot: actor.organizationId }, { status: "REVIEW" }] } })) throw new AppError("billingPaymentPending", "CONFLICT", 409);
  } else {
    if (await db.whatsAppInvoice.findFirst({ where: { organizationId: actor.organizationId,
      OR: [{ pendingSlot: actor.organizationId }, { status: "REVIEW" }] } })) throw new AppError("billingPaymentPending", "CONFLICT", 409);
    await assertWhatsAppSale(actor, intent?.storeId ?? undefined, db);
  }
}
export async function createApplePurchaseIntent(actor: AppleBillingActor, raw: z.infer<typeof appleIntentInputSchema>) {
  const input = appleIntentInputSchema.parse(raw);
  if (input.expectedOrganizationId !== actor.organizationId) throw new AppError("applePurchaseOrganizationMismatch", "CONFLICT", 409);
  const config = appleBillingConfig();
  const environment = appleEnvironmentForOrganization(actor.organizationId, config);
  const temporary = input.action === "CHANGE" && input.offerKey.startsWith("temporary-upgrade:");
  if (!(temporary ? config.foundationReady : config.ready)) throw new AppError("appleUnavailable", "CONFLICT", 409);
  if (input.termsVersion !== config.termsVersion) throw new AppError("billingTermsChanged", "CONFLICT", 409);
  return prisma.$transaction(async (db) => {
    await lockAppleOrganization(db, actor.organizationId);
    await assertAppleBillingActor(actor, db);
    const prior = await db.applePurchaseIntent.findUnique({ where: { organizationId_idempotencyKey: {
      organizationId: actor.organizationId, idempotencyKey: input.idempotencyKey } } });
    if (prior) {
      if (prior.createdById !== actor.id || prior.offerKey !== input.offerKey || prior.storeId !== (input.storeId ?? null) || prior.termsVersion !== input.termsVersion || prior.action !== input.action)
        throw new AppError("idempotencyConflict", "CONFLICT", 409);
      if (temporary && (!input.quoteToken || temporaryUpgradeDigest(verifyPurchaseQuote(input.quoteToken, actor.organizationId)) !== temporaryUpgradeDigest(readPurchaseSnapshot(prior.purchaseSnapshot))))
        throw new AppError("idempotencyConflict", "CONFLICT", 409);
      if (prior.status !== "PENDING" || prior.expiresAt <= new Date()) throw new AppError("appleIntentExpired", "CONFLICT", 409);
      if (prior.environment !== environment) throw new AppError("appleCatalogMismatch", "CONFLICT", 409);
      if (environment === "Sandbox" && !config.sandboxOrganizations.has(actor.organizationId)) throw new AppError("appleSandboxNotAllowed", "FORBIDDEN", 403);
      return presentIntent(prior);
    }
    if (temporary) {
      const ready = temporaryUpgradeReadiness(actor.organizationId);
      if (!ready.ready || !ready.policy) throw new AppError(ready.reason, "CONFLICT", 409);
      if (!input.quoteToken) throw new AppError("appleQuoteRequired", "CONFLICT", 409);
      const purchase = verifyPurchaseQuote(input.quoteToken, actor.organizationId), context = purchase.appleTemporaryUpgrade;
      if (!context || temporaryBandOfferKey(ready.policy, context.bandKey) !== input.offerKey || input.storeId)
        throw new AppError("appleCatalogMismatch", "CONFLICT", 409);
      await assertTemporaryUpgradeQuote(db, actor.organizationId, purchase, true);
      await assertIntentConditions(db, actor, undefined, "SUBSCRIPTION", new Date(), "CHANGE");
      const account = await db.appleBillingAccount.upsert({ where: { organizationId: actor.organizationId }, update: {},
        create: { organizationId: actor.organizationId, appAccountToken: randomUUID() } });
      const intent = await db.applePurchaseIntent.create({ data: { organizationId: actor.organizationId, createdById: actor.id,
        idempotencyKey: input.idempotencyKey, pendingSlot: `SUBSCRIPTION:${actor.organizationId}`, scope: "SUBSCRIPTION", action: "CHANGE",
        offerKey: input.offerKey, productId: context.productId, productType: "NON_RENEWING", environment, appAccountToken: account.appAccountToken,
        purchaseAppAccountToken: randomUUID(), offerSnapshot: { kind: "SUBSCRIPTION", offerKey: input.offerKey, temporaryUpgrade: true },
        purchaseSnapshot: json(purchase), termsVersion: input.termsVersion, termsUrl: config.termsUrl, expiresAt: new Date(purchase.expiresAt) } });
      return presentIntent(intent);
    }
    const { org, offers } = await offersFor(actor.organizationId, db);
    const offer = offers.find((o) => o.offerKey === input.offerKey);
    const mapping = config.catalog.find((m) => m.offerKey === input.offerKey);
    if (!offer || !mapping) throw new AppError("appleProductNotConfigured", "CONFLICT", 409);
    assertMappingKind(offer, mapping);
    if (mapping.productType === "NON_RENEWING" && !input.quoteToken) throw new AppError("appleQuoteRequired", "CONFLICT", 409);
    if (environment === "Sandbox" && !config.sandboxOrganizations.has(org.id)) throw new AppError("appleSandboxNotAllowed", "FORBIDDEN", 403);
    const now = new Date();
    const scope = offer.kind;
    let purchase: PurchaseSnapshot | undefined;
    let appleChangeSource: AppleDeferredSource | undefined;
    if (scope === "SUBSCRIPTION") {
      if (org.lifetimeAccess) throw new AppError("billingLifetimeProtected", "FORBIDDEN", 403);
      if (org.subscriptionBillingMode !== "SELF_SERVE" || org.subscriptionStatus === "CANCELED") throw new AppError("billingManualAccessProtected", "CONFLICT", 409);
      if (input.action === "CHANGE") {
        const oldTransaction = org.activeSubscriptionPeriod?.appleTransactionId ? await db.appleTransaction.findUnique({
          where: { id: org.activeSubscriptionPeriod.appleTransactionId } }) : null;
        const chain = oldTransaction ? await db.appleSubscriptionChain.findUnique({ where: { environment_originalTransactionId: {
          environment: oldTransaction.environment, originalTransactionId: oldTransaction.originalTransactionId } } }) : null;
        const sourceMapping = chain && config.catalog.find((m) => m.productId === chain.productId);
        if (mapping.productType !== "AUTO_RENEWABLE" || !chain || chain.organizationId !== org.id || !chain.expiresAt || chain.expiresAt <= now ||
          !oldTransaction || oldTransaction.environment !== environment || oldTransaction.productType !== "AUTO_RENEWABLE" || oldTransaction.status !== "GRANTED" ||
          !oldTransaction.expiresDate || oldTransaction.revocationDate || oldTransaction.supersededAt)
          throw new AppError("appleChangeRequiresAppleSubscription", "CONFLICT", 409);
        if (!mapping.subscriptionGroupId || mapping.subscriptionGroupId !== sourceMapping?.subscriptionGroupId) throw new AppError("appleCatalogMismatch", "CONFLICT", 409);
        // Selecting the active SKU is not a new paid purchase. Changing a
        // different pending renewal preference belongs in App Store management.
        if (mapping.productId === oldTransaction.productId) throw new AppError("billingNoPaidChange", "CONFLICT", 409);
        appleChangeSource = { version: 1, chainId: chain.id, transactionRowId: oldTransaction.id, transactionId: oldTransaction.transactionId,
          originalTransactionId: chain.originalTransactionId, productId: oldTransaction.productId, environment: environment,
          subscriptionGroupId: mapping.subscriptionGroupId, expiresAt: oldTransaction.expiresDate.toISOString() };
      }
      if (input.action === "RENEW" && mapping.productType === "AUTO_RENEWABLE" && Math.max(org.currentPeriodEndsAt?.getTime() ?? 0, org.trialEndsAt?.getTime() ?? 0) > now.getTime())
        throw new AppError("appleExistingAccessActive", "CONFLICT", 409);
      purchase = input.quoteToken ? verifyPurchaseQuote(input.quoteToken, org.id, now)
        : await calculateSubscriptionQuote(org.id, { ...offer.selection, action: "RENEW" }, db, now);
      if (purchase.kind !== "RENEWAL" || purchase.plan !== offer.selection.plan || purchase.months !== offer.selection.months ||
        JSON.stringify(purchase.extras) !== JSON.stringify(offer.selection.extras) || purchase.expectedPlan !== org.storedPlan ||
        purchase.expectedPeriodEnd !== (org.currentPeriodEndsAt?.toISOString() ?? null)) throw new AppError("appleAccessChanged", "CONFLICT", 409);
    }
    // Pass a candidate only for store validation; it is not an issued/charged intent.
    await assertIntentConditions(db, actor, scope === "WHATSAPP_PACK" ? { scope, storeId: input.storeId ?? null } as ApplePurchaseIntent : undefined, scope, now, input.action);
    const account = await db.appleBillingAccount.upsert({ where: { organizationId: org.id }, update: {},
      create: { organizationId: org.id, appAccountToken: randomUUID() } });
    const preservedAccess = scope === "SUBSCRIPTION" ? await captureApplePreservedAccess(db, org) : null;
    const intent = await db.applePurchaseIntent.create({ data: { organizationId: org.id, createdById: actor.id,
      idempotencyKey: input.idempotencyKey, action: input.action, pendingSlot: `${scope}:${org.id}`, scope, offerKey: offer.offerKey,
      productId: mapping.productId, productType: mapping.productType, environment,
      appAccountToken: account.appAccountToken, offerSnapshot: json({ ...offer, ...(preservedAccess ? { preservedAccess } : {}),
        ...(appleChangeSource ? { appleChangeSource } : {}), appleProduct: { subscriptionGroupId: mapping.subscriptionGroupId, appleOfferVersion: mapping.appleOfferVersion } }), ...(purchase ? { purchaseSnapshot: json(purchase) } : {}),
      storeId: input.storeId, termsVersion: config.termsVersion, termsUrl: config.termsUrl, expiresAt: new Date(now.getTime() + 15 * 60_000) } });
    return presentIntent(intent);
  });
}

export async function authorizeApplePurchase(actor: AppleBillingActor, intentId: string, options: { prepareOnly?: boolean; attemptId?: string;
  completionPublicKey?: string; completionOrigin?: string } = {}) {
  const attempt = options.attemptId ? z.string().uuid().safeParse(options.attemptId) : null;
  const attemptId = attempt?.success ? attempt.data.toLowerCase() : undefined;
  if (!options.prepareOnly && !attemptId) throw new AppError("applePurchaseAttemptRequired", "BAD_REQUEST", 400);
  const completionKey = options.completionPublicKey ? parseAppleCompletionPublicKey(options.completionPublicKey) : null;
  if (completionKey && (options.prepareOnly || !appleNativeOriginAllowed(options.completionOrigin ?? null)))
    throw new AppError("appleCompletionKeyInvalid", "BAD_REQUEST", 400);
  const config = appleBillingConfig();
  const environment = appleEnvironmentForOrganization(actor.organizationId, config);
  if (!config.foundationReady) throw new AppError("appleUnavailable", "CONFLICT", 409);
  return prisma.$transaction(async (db) => {
    await lockAppleOrganization(db, actor.organizationId);
    await assertAppleBillingActor(actor, db);
    const intent = await db.applePurchaseIntent.findFirst({ where: { id: intentId, organizationId: actor.organizationId, createdById: actor.id } });
    if (environment === "Sandbox" && !config.sandboxOrganizations.has(actor.organizationId)) throw new AppError("appleSandboxNotAllowed", "FORBIDDEN", 403);
    if (intent?.authorizedAt && ["PENDING", "REVIEW"].includes(intent.status))
      throw new AppError("applePurchasePendingVerification", "CONFLICT", 409);
    if (!intent || intent.status !== "PENDING" || intent.expiresAt <= new Date()) throw new AppError("appleIntentExpired", "CONFLICT", 409);
    const temporary = isTemporaryUpgradeIntent(intent);
    if ((!temporary && (!config.ready || !config.catalog.some((v) => v.offerKey === intent.offerKey && v.productId === intent.productId && v.productType === intent.productType))) ||
      intent.environment !== environment || intent.termsVersion !== config.termsVersion) throw new AppError("appleCatalogMismatch", "CONFLICT", 409);
    if (temporary) await assertTemporaryUpgradeQuote(db, actor.organizationId, readPurchaseSnapshot(intent.purchaseSnapshot)!, true);
    await assertIntentConditions(db, actor, intent);
    const org = await getOrganizationPlan(actor.organizationId, db);
    const changeSource = readAppleDeferredSource(intent.offerSnapshot);
    if (changeSource) {
      const previous = await db.appleTransaction.findUnique({ where: { id: changeSource.transactionRowId } });
      if (org.activeSubscriptionPeriod?.appleTransactionId !== changeSource.transactionRowId || previous?.status !== "GRANTED" || previous.revocationDate || previous.supersededAt)
        throw new AppError("appleAccessChanged", "CONFLICT", 409);
    }
    if (intent.scope === "SUBSCRIPTION") {
      const purchase = readPurchaseSnapshot(intent.purchaseSnapshot);
      if (!purchase || org.lifetimeAccess || org.subscriptionBillingMode !== "SELF_SERVE" || org.subscriptionStatus === "CANCELED")
        throw new AppError("billingManualAccessProtected", "CONFLICT", 409);
      if (purchase.expectedPlan !== org.storedPlan || purchase.expectedPeriodEnd !== (org.currentPeriodEndsAt?.toISOString() ?? null))
        throw new AppError("appleAccessChanged", "CONFLICT", 409);
      if (intent.action === "RENEW" && intent.productType === "AUTO_RENEWABLE" && Math.max(org.currentPeriodEndsAt?.getTime() ?? 0, org.trialEndsAt?.getTime() ?? 0) > Date.now())
        throw new AppError("appleExistingAccessActive", "CONFLICT", 409);
      if (purchase.entitlements) await assertSubscriptionSelectionReady(org, purchase.entitlements, db);
    }
    // Product metadata and same-group eligibility are prepared before a sheet
    // can open. Only the second native call reserves a potentially paid result.
    // An authorization is consumed once: retries recover signed receipts and never reopen a sheet.
    if (options.prepareOnly) return { ...presentIntent(intent), attemptId: null };
    const authorized = await db.applePurchaseIntent.update({ where: { id: intent.id },
      data: { authorizedAt: new Date(), nativeAttemptId: attemptId!, ...(completionKey ? { completionPublicKey: completionKey.publicKey,
        completionKeyFingerprint: completionKey.fingerprint, completionOrigin: new URL(options.completionOrigin!).origin } : {}) } });
    return { ...presentIntent(authorized), attemptId: authorized.nativeAttemptId, authorizedAt: authorized.authorizedAt!.toISOString(),
      completionKeyFingerprint: authorized.completionKeyFingerprint };
  });
}

export type AppleConfirmation = { acknowledged: true; transactionId: string; status: "GRANTED" | "REVIEW" | "REVOKED"; reason: string | null; organizationId: string };
const confirmation = (v: AppleTransaction): AppleConfirmation => ({ acknowledged: true, transactionId: v.transactionId,
  status: v.status as AppleConfirmation["status"], reason: v.lastIssue, organizationId: v.organizationId });

/** Only receipts carrying the private verification marker can enter the grant path. */
export async function applyAppleTransaction(receipt: VerifiedAppleTransaction, input: {
  organizationId?: string; intentId?: string; source: "CLIENT" | "RESTORE" | "NOTIFICATION" | "RECONCILIATION";
  operator?: AppleSupportOperator;
}): Promise<AppleConfirmation> {
  assertVerifiedAppleTransaction(receipt);
  const d = receipt.data;
  const tokenIntent = await prisma.applePurchaseIntent.findUnique({ where: { purchaseAppAccountToken: d.appAccountToken } });
  const account = tokenIntent ? await prisma.appleBillingAccount.findUnique({ where: { organizationId: tokenIntent.organizationId } }) :
    await prisma.appleBillingAccount.findUnique({ where: { appAccountToken: d.appAccountToken } });
  if (!account || (input.organizationId && account.organizationId !== input.organizationId))
    throw new AppError("applePurchaseOrganizationMismatch", "FORBIDDEN", 403);
  return prisma.$transaction(async (db) => {
    await lockAppleOrganization(db, account.organizationId);
    if (input.operator) await auditAppleSupportEvidence(db, input.operator, account.organizationId, receipt.digest, "TRANSACTION");
    const prior = await db.appleTransaction.findUnique({ where: { environment_transactionId: {
      environment: d.environment, transactionId: d.transactionId } } });
    if (prior && (prior.organizationId !== account.organizationId || prior.originalTransactionId !== d.originalTransactionId ||
      prior.productId !== d.productId || prior.appAccountToken !== d.appAccountToken || prior.productType !== receipt.productType ||
      prior.purchaseDate.getTime() !== d.purchaseDate || prior.quantity !== (d.quantity ?? 1) ||
      (d.price !== undefined && prior.priceMillis !== null && prior.priceMillis !== BigInt(d.price)) ||
      (d.currency && prior.currency && prior.currency !== d.currency) ||
      (d.storefrontId && prior.storefrontId && prior.storefrontId !== d.storefrontId))) throw new AppError("applePurchaseBindingMismatch", "CONFLICT", 409);
    const chain = await db.appleSubscriptionChain.findUnique({ where: { environment_originalTransactionId: {
      environment: d.environment, originalTransactionId: d.originalTransactionId } }, include: { initialIntent: true } });
    if (chain && (chain.organizationId !== account.organizationId || chain.appAccountToken !== d.appAccountToken))
      throw new AppError("applePurchaseOrganizationMismatch", "FORBIDDEN", 403);
    let intent = prior?.intentId ? await db.applePurchaseIntent.findUnique({ where: { id: prior.intentId } }) : null;
    if (!intent && tokenIntent && tokenIntent.productId === d.productId && tokenIntent.productType === receipt.productType)
      intent = await db.applePurchaseIntent.findUnique({ where: { id: tokenIntent.id } });
    if (!intent && !tokenIntent && input.intentId) {
      const supplied = await db.applePurchaseIntent.findFirst({ where: { id: input.intentId, organizationId: account.organizationId } });
      if (!supplied) throw new AppError("applePurchaseOrganizationMismatch", "FORBIDDEN", 403);
      if (supplied.productId === d.productId) intent = supplied;
      // StoreKit may return the existing transaction for a deferred downgrade.
      else if (!prior) throw new AppError("appleProductMismatch", "CONFLICT", 409);
    }
    if (!intent && !tokenIntent) intent = await db.applePurchaseIntent.findFirst({ where: { organizationId: account.organizationId, purchaseAppAccountToken: null,
      productId: d.productId, environment: d.environment, appAccountToken: d.appAccountToken,
      authorizedAt: { not: null }, createdAt: { lte: new Date(d.purchaseDate + 300_000) } }, orderBy: { createdAt: "desc" } });
    if (!intent && chain?.initialIntent.productId === d.productId) intent = chain.initialIntent;
    if (!intent && chain && receipt.productType === "AUTO_RENEWABLE") {
      try { intent = await managedAppleChangeIntent(db, chain, receipt); }
      catch (error) { if (!(error instanceof AppError)) throw error; /* Durable review below when mapping/terms are not approved. */ }
    }
    if (intent && ((intent.purchaseAppAccountToken ?? intent.appAccountToken) !== d.appAccountToken || intent.environment !== d.environment ||
      intent.productId !== d.productId || intent.productType !== receipt.productType)) throw new AppError("applePurchaseBindingMismatch", "CONFLICT", 409);
    const now = new Date();
    let row = prior ?? await db.appleTransaction.create({ data: {
      organizationId: account.organizationId, intentId: intent?.id, transactionId: d.transactionId,
      originalTransactionId: d.originalTransactionId, environment: d.environment, appAccountToken: d.appAccountToken,
      productId: d.productId, productType: receipt.productType, quantity: d.quantity ?? 1, purchaseDate: new Date(d.purchaseDate),
      expiresDate: d.expiresDate ? new Date(d.expiresDate) : null, priceMillis: d.price === undefined ? null : BigInt(d.price),
      currency: d.currency, storefront: d.storefront, storefrontId: d.storefrontId, ownershipType: d.inAppOwnershipType,
      offerSnapshot: intent?.offerSnapshot ?? { kind: "UNKNOWN", productId: d.productId },
      signedTransactionInfo: receipt.signedTransactionInfo, lastSignedAt: new Date(d.signedDate),
      nextCheckAt: new Date(now.getTime() + 15 * 60_000), status: "REVIEW", lastIssue: intent ? null : "appleIntentMissing",
    } });
    if (!row.intentId && intent) row = await db.appleTransaction.update({ where: { id: row.id },
      data: { intentId: intent.id, offerSnapshot: intent.offerSnapshot as Prisma.InputJsonValue } });
    await db.appleTransactionObservation.upsert({ where: { digest: receipt.digest }, update: {},
      create: { digest: receipt.digest, transactionId: row.id, source: input.source, signedPayload: receipt.signedTransactionInfo } });
    if (prior && d.signedDate < prior.lastSignedAt.getTime()) return confirmation(prior);
    // A later refund/upgrade must never be undone by replaying an old purchase.
    if (d.revocationDate || d.isUpgraded) {
      const revokedAt = new Date(d.revocationDate ?? d.signedDate);
      await db.subscriptionPeriod.updateMany({ where: { appleTransactionId: row.id, revokedAt: null }, data: { revokedAt } });
      await db.whatsAppCreditLot.updateMany({ where: { appleTransactionId: row.id }, data: { revoked: true } });
      row = await db.appleTransaction.update({ where: { id: row.id }, data: { status: "REVOKED", revocationDate: revokedAt,
        lastSignedAt: new Date(d.signedDate), ...(d.isUpgraded && !row.supersededAt ? { supersededAt: revokedAt } : {}),
        lastIssue: d.isUpgraded || row.supersededAt ? "appleSuperseded" : "appleRefunded", nextCheckAt: new Date(now.getTime() + 86_400_000) } });
      await recomputeAppleCoverage(db, account.organizationId);
      if (intent) await syncAppleIntentReceiptState(db, intent.id);
      return confirmation(row);
    }
    if (row.status === "REVOKED") {
      if (row.supersededAt || row.lastIssue !== "appleRefunded" || d.signedDate <= row.lastSignedAt.getTime()) return confirmation(row);
      // A newer signed refund reversal restores only this source. Usage remains
      // consumed; an old receipt cannot reverse a refund or superseded period.
      const [periods, lots] = await Promise.all([
        db.subscriptionPeriod.updateMany({ where: { appleTransactionId: row.id }, data: { revokedAt: null } }),
        db.whatsAppCreditLot.updateMany({ where: { appleTransactionId: row.id }, data: { revoked: false } }),
      ]);
      const restoredPeriod = periods.count ? await db.subscriptionPeriod.findUnique({ where: { appleTransactionId: row.id } }) : null;
      // The period trigger runs while this receipt is still REVOKED. Restoring
      // its own payment cannot resolve a separate, still-unfunded parent term.
      // Match the trigger's current-term boundary; served expired history stays history.
      const dependencyIssue = restoredPeriod?.parentPeriodId && restoredPeriod.dependencyRevokedAt && restoredPeriod.endsAt > now
        ? "appleTemporaryUpgradeDependencyRevoked" : null;
      row = await db.appleTransaction.update({ where: { id: row.id }, data: { status: (periods.count || lots.count) && !dependencyIssue ? "GRANTED" : "REVIEW",
        revocationDate: null, lastIssue: dependencyIssue, lastSignedAt: new Date(d.signedDate) } });
      await recomputeAppleCoverage(db, account.organizationId);
      if (dependencyIssue) {
        if (intent) await syncAppleIntentReceiptState(db, intent.id);
        return confirmation(row);
      }
    }
    if (row.status === "GRANTED") {
      if (d.signedDate > row.lastSignedAt.getTime()) row = await db.appleTransaction.update({ where: { id: row.id }, data: { lastSignedAt: new Date(d.signedDate) } });
      if (intent) await syncAppleIntentReceiptState(db, intent.id);
      return confirmation(row);
    }
    let reason: string | null = null;
    let superseded = false;
    const config = appleBillingConfig();
    if (!intent) reason = "appleIntentMissing";
    else if (!intent.authorizedAt) reason = "appleIntentNotAuthorized";
    else if (receipt.productType !== "AUTO_RENEWABLE" && await db.appleTransaction.count({ where: { intentId: intent.id, id: { not: row.id } } }))
      reason = "appleIntentAlreadyFulfilled";
    else if (d.environment === "Sandbox" && !config.sandboxOrganizations.has(account.organizationId)) reason = "appleSandboxNotAllowed";
    else if (d.inAppOwnershipType !== "PURCHASED") reason = "appleFamilySharingNotSupported";
    else if ((d.quantity ?? 1) !== 1) reason = "appleQuantityMismatch";
    else if (!chain && d.purchaseDate < intent.createdAt.getTime() - 300_000) reason = "appleIntentExpired";
    if (!reason && intent) {
      try {
        const offer = offerSnapshotSchema.parse(intent.offerSnapshot);
        const frozenProduct = z.object({ subscriptionGroupId: z.string().optional() }).parse(offer.appleProduct ?? {});
        if (intent.productType === "AUTO_RENEWABLE" && frozenProduct.subscriptionGroupId !== d.subscriptionGroupIdentifier)
          throw new AppError("appleCatalogMismatch", "CONFLICT", 409);
        if (offer.kind === "SUBSCRIPTION") superseded = (await grantAppleSubscription(db, row, receipt, intent, Boolean(chain))) === "SUPERSEDED";
        else await grantAppleWhatsApp(db, row, intent);
      } catch (error) {
        if (!(error instanceof AppError) && !(error instanceof z.ZodError)) throw error;
        reason = error instanceof AppError ? error.message : "appleCatalogMismatch";
      }
    }
    row = await db.appleTransaction.update({ where: { id: row.id }, data: { status: superseded ? "REVOKED" : reason ? "REVIEW" : "GRANTED",
      lastIssue: superseded ? "appleSuperseded" : reason, lastSignedAt: new Date(d.signedDate), nextCheckAt: new Date(now.getTime() + (reason ? 15 * 60_000 : 86_400_000)) } });
    if (intent) await syncAppleIntentReceiptState(db, intent.id);
    return confirmation(row);
  });
}


/** One refund/replay must not hide another unresolved charge on the same intent. */
async function syncAppleIntentReceiptState(db: Prisma.TransactionClient, intentId: string) {
  const review = await db.appleTransaction.findFirst({ where: { intentId, status: "REVIEW" }, orderBy: { createdAt: "asc" } });
  await db.applePurchaseIntent.update({ where: { id: intentId }, data: { status: review ? "REVIEW" : "COMPLETED",
    pendingSlot: null, lastIssue: review?.lastIssue ?? (review ? "applePaymentNeedsReview" : null) } });
}

async function grantAppleSubscription(db: Prisma.TransactionClient, row: AppleTransaction, receipt: VerifiedAppleTransaction,
  intent: ApplePurchaseIntent, existingChain: boolean): Promise<"GRANTED" | "SUPERSEDED"> {
  if (isTemporaryUpgradeIntent(intent)) return grantAppleTemporaryUpgrade(db, row, receipt, intent);
  const org = await getOrganizationPlan(row.organizationId, db);
  if (org.lifetimeAccess || org.subscriptionBillingMode !== "SELF_SERVE" || org.subscriptionStatus === "CANCELED")
    throw new AppError("billingManualAccessProtected", "CONFLICT", 409);
  const base = readPurchaseSnapshot(intent.purchaseSnapshot);
  if (!base?.entitlements) throw new AppError("appleCatalogMismatch", "CONFLICT", 409);
  const offer = appleSubscriptionOffer(org.contractTerms, { plan: base.plan, months: base.months, extras: base.extras });
  if (offer.offerKey !== intent.offerKey) throw new AppError("appleCatalogMismatch", "CONFLICT", 409);
  await assertSubscriptionSelectionReady(org, base.entitlements, db);
  const d = receipt.data;
  const now = new Date();
  let startsAt: Date, endsAt: Date;
  let anchorDay: number;
  if (intent.productType === "AUTO_RENEWABLE") {
    startsAt = new Date(d.purchaseDate); endsAt = new Date(d.expiresDate!); anchorDay = startsAt.getUTCDate();
    if (!existingChain && ((org.currentPeriodEndsAt && org.currentPeriodEndsAt > startsAt) || (org.trialEndsAt && org.trialEndsAt > startsAt)))
      throw new AppError("appleAccessChanged", "CONFLICT", 409);
    const overlappingGateway = await db.subscriptionPeriod.findFirst({ where: { organizationId: org.id, invoiceId: { not: null },
      revokedAt: null, dependencyRevokedAt: null, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } } });
    if (overlappingGateway) throw new AppError("appleAccessChanged", "CONFLICT", 409);
  } else {
    if (base.expectedPlan !== org.storedPlan || base.expectedPeriodEnd !== (org.currentPeriodEndsAt?.toISOString() ?? null))
      throw new AppError("appleAccessChanged", "CONFLICT", 409);
    startsAt = new Date(Math.max(d.purchaseDate, org.currentPeriodEndsAt?.getTime() ?? 0, org.trialEndsAt?.getTime() ?? 0));
    anchorDay = org.currentPeriodEndsAt?.getTime() === startsAt.getTime() && org.billingAnchorDay ? org.billingAnchorDay : startsAt.getUTCDate();
    endsAt = extendSubscriptionMonths(startsAt, anchorDay, base.months);
  }
  if (intent.productType === "AUTO_RENEWABLE") {
    const created = await db.appleSubscriptionChain.upsert({ where: { environment_originalTransactionId: {
      environment: row.environment, originalTransactionId: row.originalTransactionId } },
      create: { organizationId: org.id, environment: row.environment, originalTransactionId: row.originalTransactionId,
        appAccountToken: row.appAccountToken, initialIntentId: intent.id, productId: row.productId,
        expiresAt: endsAt, lastSignedAt: new Date(0), nextCheckAt: now }, update: {} });
    if (created.organizationId !== org.id || created.appAccountToken !== row.appAccountToken) throw new AppError("applePurchaseOrganizationMismatch", "FORBIDDEN", 403);
    // A verified replacement can shorten an annual coverage boundary. Determine
    // recency by signed purchase time, never MAX(expiresAt) or webhook order.
    const replacements = await db.appleTransaction.findMany({ where: { organizationId: org.id, environment: row.environment,
      originalTransactionId: row.originalTransactionId, id: { not: row.id }, productType: "AUTO_RENEWABLE",
      status: { in: ["GRANTED", "REVOKED"] }, purchaseDate: { gt: startsAt, lt: endsAt } }, orderBy: { purchaseDate: "asc" }, take: 1 });
    if (replacements[0]) {
      await db.appleTransaction.update({ where: { id: row.id }, data: { supersededAt: replacements[0].purchaseDate, status: "REVOKED", lastIssue: "appleSuperseded" } });
      return "SUPERSEDED";
    }
    const latest = await db.appleTransaction.findFirst({ where: { organizationId: org.id, environment: row.environment,
      originalTransactionId: row.originalTransactionId, id: { not: row.id }, status: { in: ["GRANTED", "REVOKED"] } }, orderBy: { purchaseDate: "desc" } });
    if (!latest || latest.purchaseDate <= startsAt) await db.appleSubscriptionChain.update({ where: { id: created.id },
      data: { productId: row.productId, expiresAt: endsAt, revokedAt: null, nextCheckAt: now,
        ...(created.pendingProductId === row.productId ? { pendingProductId: null, pendingChangeOffer: Prisma.DbNull } : {}) } });
  }
  // Changing products mid-cycle preserves the original monthly usage anchor.
  // Billing proration and currency come only from Apple, never this valuation.
  const predecessor = intent.productType === "AUTO_RENEWABLE" ? await db.subscriptionPeriod.findFirst({ where: {
    organizationId: org.id, startsAt: { lte: startsAt }, endsAt: { gt: startsAt },
    appleTransaction: { originalTransactionId: row.originalTransactionId, environment: row.environment },
  }, orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }] }) : null;
  const priorCycle = readPurchaseSnapshot(predecessor?.purchaseSnapshot);
  if (priorCycle) anchorDay = priorCycle.anchorDay;
  const purchase: PurchaseSnapshot = { ...base, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(),
    cycleStartsAt: priorCycle?.cycleStartsAt ?? startsAt.toISOString(), cycleEndsAt: endsAt.toISOString(), anchorDay };
  if (intent.productType === "AUTO_RENEWABLE") {
    const replaced = await db.subscriptionPeriod.findMany({ where: { organizationId: org.id, revokedAt: null, dependencyRevokedAt: null,
      startsAt: { lte: startsAt }, endsAt: { gt: startsAt }, appleTransactionId: { not: null },
      appleTransaction: { originalTransactionId: row.originalTransactionId, environment: row.environment },
    }, select: { id: true, appleTransactionId: true } });
    for (const old of replaced) {
      await db.appleTransaction.update({ where: { id: old.appleTransactionId! }, data: { supersededAt: startsAt, status: "REVOKED", lastIssue: "appleSuperseded" } });
      await db.subscriptionPeriod.update({ where: { id: old.id }, data: { revokedAt: startsAt } });
    }
  }
  await db.subscriptionPeriod.create({ data: { organizationId: org.id, appleTransactionId: row.id, plan: purchase.plan,
    startsAt, endsAt, purchaseSnapshot: json(purchase) } });
  // Renewals never reset monthly usage rows or rewrite any independent grant.
  await recomputeAppleCoverage(db, org.id);
  return "GRANTED";
}
async function grantAppleTemporaryUpgrade(db: Prisma.TransactionClient, row: AppleTransaction, receipt: VerifiedAppleTransaction,
  intent: ApplePurchaseIntent): Promise<"GRANTED"> {
  const purchase = readPurchaseSnapshot(intent.purchaseSnapshot), context = purchase?.appleTemporaryUpgrade;
  if (!purchase || !context || !intent.purchaseAppAccountToken || intent.productType !== "NON_RENEWING" || intent.action !== "CHANGE")
    throw new AppError("appleCatalogMismatch", "CONFLICT", 409);
  const existing = await db.subscriptionPeriod.findUnique({ where: { appleTransactionId: row.id } });
  if (existing) {
    if (existing.dependencyRevokedAt) throw new AppError("appleTemporaryUpgradeDependencyRevoked", "CONFLICT", 409);
    if (existing.revokedAt || existing.endsAt <= new Date()) throw new AppError("appleTemporaryUpgradeSourceChanged", "CONFLICT", 409);
    return "GRANTED";
  }
  const d = receipt.data;
  if (d.currency !== context.price.currency || d.storefrontId !== context.price.storefrontId || d.price !== context.price.priceMillis)
    throw new AppError("appleTemporaryUpgradePriceChanged", "CONFLICT", 409);
  if (d.purchaseDate > new Date(purchase.expiresAt).getTime() || new Date(purchase.endsAt) <= new Date())
    throw new AppError("appleTemporaryUpgradeSourceChanged", "CONFLICT", 409);
  await assertTemporaryUpgradeQuote(db, row.organizationId, purchase, false);
  await db.subscriptionPeriod.create({ data: { organizationId: row.organizationId, appleTransactionId: row.id, parentPeriodId: purchase.sourcePeriodId,
    plan: purchase.plan, startsAt: new Date(purchase.startsAt), endsAt: new Date(purchase.endsAt), purchaseSnapshot: json(purchase) } });
  await recomputeAppleCoverage(db, row.organizationId);
  return "GRANTED";
}
async function grantAppleWhatsApp(db: Prisma.TransactionClient, row: AppleTransaction, intent: ApplePurchaseIntent) {
  const offer = z.object({ kind: z.literal("WHATSAPP_PACK"), messages: z.number().int().positive(), quantity: z.number().int().min(1).max(10) }).parse(intent.offerSnapshot);
  if (intent.productType !== "CONSUMABLE") throw new AppError("appleCatalogMismatch", "CONFLICT", 409);
  // This is a paid durable balance. Connection/worker outages after checkout do
  // not erase it. It can only be used through the existing live WhatsApp gates.
  await db.whatsAppCreditLot.create({ data: { organizationId: row.organizationId, appleTransactionId: row.id,
    total: offer.messages, expiresAt: null } });
}
export async function recomputeAppleCoverage(db: Prisma.TransactionClient, organizationId: string) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: organizationId }, include: { subscriptionContract: true } });
  const chains = await db.appleSubscriptionChain.findMany({ where: { organizationId } });
  for (const chain of chains) {
    const eligible = await db.subscriptionPeriod.findFirst({ where: { organizationId, revokedAt: null, dependencyRevokedAt: null,
      appleTransaction: { environment: chain.environment, originalTransactionId: chain.originalTransactionId } },
      orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }] });
    await db.appleSubscriptionChain.update({ where: { id: chain.id }, data: {
      expiresAt: eligible?.endsAt ?? null, revokedAt: eligible ? null : chain.revokedAt ?? new Date(),
      ...(!eligible ? { graceExpiresAt: null } : {}),
    } });
  }
  if (org.subscriptionBillingMode !== "SELF_SERVE" || org.subscriptionContract?.lifetimeAccess) return;
  const [tail, active, preserved, knownTail] = await Promise.all([
    db.subscriptionPeriod.findFirst({ where: { organizationId, revokedAt: null, dependencyRevokedAt: null, parentPeriodId: null }, orderBy: [{ endsAt: "desc" }, { id: "desc" }] }),
    db.subscriptionPeriod.findFirst({ where: { organizationId, revokedAt: null, dependencyRevokedAt: null, startsAt: { lte: new Date() }, endsAt: { gt: new Date() } }, orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }, { id: "desc" }] }),
    applePreservedAccess(db, organizationId),
    db.subscriptionPeriod.findFirst({ where: { organizationId }, orderBy: { endsAt: "desc" }, select: { endsAt: true } }),
  ]);
  const unbackedApproval = org.currentPeriodEndsAt && knownTail && org.currentPeriodEndsAt > knownTail.endsAt ? org.currentPeriodEndsAt : null;
  const coverageEnd = Math.max(tail?.endsAt.getTime() ?? 0, preserved ? new Date(preserved.endsAt).getTime() : 0, unbackedApproval?.getTime() ?? 0);
  const preserveStatus = org.subscriptionStatus === "CANCELED";
  await db.organization.update({ where: { id: organizationId }, data: {
    currentPeriodEndsAt: coverageEnd ? new Date(coverageEnd) : null,
    ...(active && !active.parentPeriodId ? { plan: active.plan } : !active && preserved ? { plan: preserved.plan } : {}),
    ...(!preserveStatus && tail && tail.endsAt > new Date() ? { subscriptionStatus: "ACTIVE" } : {}),
    ...(tail ? { billingAnchorDay: readPurchaseSnapshot(tail.purchaseSnapshot)?.anchorDay ?? tail.startsAt.getUTCDate() } : {}),
  } });
}

export async function confirmApplePurchase(actor: AppleBillingActor, input: { signedTransactionInfo: string; intentId?: string }, source: "CLIENT" | "RESTORE" = "CLIENT") {
  await assertAppleBillingActor(actor);
  const receipt = await verifyAppleTransaction(input.signedTransactionInfo);
  return applyAppleTransaction(receipt, { organizationId: actor.organizationId, intentId: input.intentId, source });
}
export async function restoreApplePurchases(actor: AppleBillingActor, signedTransactions: string[]) {
  await assertAppleBillingActor(actor);
  if (signedTransactions.length > 50) throw new AppError("appleRestoreTooLarge", "BAD_REQUEST", 400);
  const results: ({ index: number; success: true; confirmation: AppleConfirmation } |
    { index: number; success: false; reason: string; retryable: boolean })[] = [];
  for (const [index, signedTransactionInfo] of signedTransactions.entries()) {
    try { results.push({ index, success: true, confirmation: await confirmApplePurchase(actor, { signedTransactionInfo }, "RESTORE") }); }
    catch (error) { results.push({ index, success: false, reason: error instanceof AppError ? error.message : "appleReconciliationUnavailable",
      retryable: !(error instanceof AppError) || !["BAD_REQUEST", "FORBIDDEN"].includes(error.code) }); }
  }
  return { results };

}
export async function acknowledgeApplePurchase(actor: AppleBillingActor, input: { transactionId: string; signedTransactionInfo: string }) {
  await assertAppleBillingActor(actor);
  const receipt = await verifyAppleTransaction(input.signedTransactionInfo);
  if (receipt.data.transactionId !== input.transactionId) throw new AppError("applePurchaseBindingMismatch", "CONFLICT", 409);
  const row = await prisma.appleTransaction.findUnique({ where: { environment_transactionId: {
    environment: receipt.data.environment, transactionId: input.transactionId } } });
  if (!row || row.organizationId !== actor.organizationId || row.productId !== receipt.data.productId || row.appAccountToken !== receipt.data.appAccountToken ||
    !["GRANTED", "REVIEW", "REVOKED"].includes(row.status)) throw new AppError("applePurchaseNotRecorded", "CONFLICT", 409);
  return { finishAllowed: true as const };
}


export async function cancelApplePurchaseIntent(actor: AppleBillingActor, intentId: string, attemptId?: string) {
  return prisma.$transaction(async (db) => {
    await lockAppleOrganization(db, actor.organizationId);
    await assertAppleBillingActor(actor, db);
    const intent = await db.applePurchaseIntent.findFirst({ where: { id: intentId, organizationId: actor.organizationId, createdById: actor.id } });
    if (!intent) throw new AppError("recordNotFound", "NOT_FOUND", 404);
    const recorded = await db.appleTransaction.count({ where: { intentId: intent.id } });
    // A retained money obligation takes precedence over terminal cancellation.
    // Its recovery belongs to signed receipts, including for a losing device.
    if (recorded) return { canceled: false, recorded: true };
    if (intent.completionPublicKey) throw new AppError("appleCompletionRequired", "CONFLICT", 409);
    if (intent.authorizedAt && (!intent.nativeAttemptId || !attemptId || intent.nativeAttemptId !== attemptId.toLowerCase()))
      throw new AppError("applePurchaseAttemptMismatch", "CONFLICT", 409);
    const cancellable = !recorded && (intent.status === "PENDING" || (intent.status === "EXPIRED" && !intent.authorizedAt) || (intent.status === "REVIEW" && intent.lastIssue === "applePurchasePendingVerification"));
    if (cancellable) await db.applePurchaseIntent.update({ where: { id: intent.id }, data: { status: "CANCELED", pendingSlot: null, lastIssue: null } });
    return { canceled: !recorded && (cancellable || intent.status === "CANCELED"), recorded: recorded > 0 };
  });
}


export async function getApplePurchasePreview(actor: AppleBillingActor, input: { expectedOrganizationId: string; offerKey: string; action: "RENEW" | "CHANGE" }) {
  await assertAppleBillingActor(actor);
  if (input.expectedOrganizationId !== actor.organizationId) throw new AppError("applePurchaseOrganizationMismatch", "CONFLICT", 409);
  const { offers } = await offersFor(actor.organizationId);
  const offer = offers.find((o) => o.offerKey === input.offerKey);
  const mapping = appleBillingConfig().catalog.find((m) => m.offerKey === input.offerKey);
  if (!offer || !mapping) throw new AppError("appleProductNotConfigured", "CONFLICT", 409);
  if (offer.kind !== "SUBSCRIPTION" || mapping.productType !== "NON_RENEWING") return { timing: null, quoteToken: null };
  if (input.action !== "RENEW") throw new AppError("appleChangeRequiresAppleSubscription", "CONFLICT", 409);
  const quote = await calculateSubscriptionQuote(actor.organizationId, { ...offer.selection, action: "RENEW" });
  return { timing: { kind: "SERVER_NON_RENEWING" as const, startsAt: quote.startsAt, endsAt: quote.endsAt, validUntil: quote.expiresAt },
    quoteToken: signPurchaseQuote(quote) };
}


/** Resolve only an explicitly approved SKU in the same immutable subscription group. */
export async function appleManagedOffer(db: Prisma.TransactionClient, chain: AppleSubscriptionChain, productId: string) {
  const mapping = appleBillingConfig().catalog.find((m) => m.productId === productId && m.productType === "AUTO_RENEWABLE");
  const initial = await db.applePurchaseIntent.findUniqueOrThrow({ where: { id: chain.initialIntentId } });
  const source = z.object({ appleProduct: z.object({ subscriptionGroupId: z.string() }) }).safeParse(initial.offerSnapshot);
  if (!mapping || !source.success || source.data.appleProduct.subscriptionGroupId !== mapping.subscriptionGroupId)
    throw new AppError("appleCatalogMismatch", "CONFLICT", 409);
  const { org, offers } = await offersFor(chain.organizationId, db);
  const offer = offers.find((o) => o.offerKey === mapping.offerKey);
  if (!offer || offer.kind !== "SUBSCRIPTION") throw new AppError("appleCatalogMismatch", "CONFLICT", 409);
  return { org, offer, mapping, initial };
}
async function managedAppleChangeIntent(db: Prisma.TransactionClient, chain: AppleSubscriptionChain, receipt: VerifiedAppleTransaction) {
  const { org, offer, mapping, initial } = await appleManagedOffer(db, chain, receipt.data.productId);
  const base = readPurchaseSnapshot(initial.purchaseSnapshot);
  if (!base) throw new AppError("appleCatalogMismatch", "CONFLICT", 409);
  const start = new Date(receipt.data.purchaseDate), end = new Date(receipt.data.expiresDate!);
  const purchase: PurchaseSnapshot = { ...base, plan: offer.selection.plan, months: offer.selection.months, extras: offer.selection.extras,
    entitlements: offer.entitlements, monthlyMinor: offer.serviceValue.monthlyMinor, discountBps: offer.serviceValue.discountBps,
    amountMinor: offer.serviceValue.amountMinor, fullAmountMinor: offer.serviceValue.fullAmountMinor, serviceValueMinor: offer.serviceValue.amountMinor,
    creditMinor: 0, expectedPlan: org.storedPlan, expectedPeriodEnd: org.currentPeriodEndsAt?.toISOString() ?? null,
    startsAt: start.toISOString(), endsAt: end.toISOString(), cycleStartsAt: start.toISOString(), cycleEndsAt: end.toISOString(), anchorDay: start.getUTCDate() };
  // A signed App Store management change is an authorization in its own right.
  // This explicitly labelled recovery intent is never presented as a web click.
  return db.applePurchaseIntent.create({ data: { organizationId: chain.organizationId, createdById: "APPLE_SUBSCRIPTION_MANAGEMENT",
    idempotencyKey: `apple-managed:${receipt.data.environment}:${receipt.data.transactionId}`, scope: "SUBSCRIPTION", action: "CHANGE",
    offerKey: offer.offerKey, productId: mapping.productId, productType: "AUTO_RENEWABLE", environment: chain.environment,
    appAccountToken: chain.appAccountToken, offerSnapshot: json({ ...offer, appleProduct: { subscriptionGroupId: mapping.subscriptionGroupId } }),
    purchaseSnapshot: json(purchase), termsVersion: initial.termsVersion, termsUrl: initial.termsUrl, status: "COMPLETED",
    authorizedAt: start, createdAt: start, expiresAt: new Date(start.getTime() + 15 * 60_000) } });
}
