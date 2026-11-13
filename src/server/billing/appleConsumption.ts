import { createHash, randomUUID } from "node:crypto";
import { DeliveryStatus, type ConsumptionRequest } from "@apple/app-store-server-library";
import type { Prisma, AppleConsumptionConsent, AppleConsumptionRequest, AppleServerNotification } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { appleBillingConfig } from "./appleConfig";
import { lockAppleOrganization } from "./appleConcurrency";
import { assertVerifiedAppleTransaction, type VerifiedAppleTransaction } from "./appleVerification";
import type { AppleBillingActor } from "./applePayments";
import { sendAppleConsumptionInformation, AppleConsumptionTransportError } from "./appleConsumptionTransport";

export const APPLE_CONSUMPTION_POLICY_VERSION = "2026-11-13-v1";
export const appleConsumptionDeliverySchema = z.enum(["DELIVERED", "UNDELIVERED_QUALITY_ISSUE", "UNDELIVERED_WRONG_ITEM", "UNDELIVERED_SERVER_OUTAGE", "UNDELIVERED_OTHER"]);
const payloadSchema = z.object({ customerConsented: z.literal(true), deliveryStatus: appleConsumptionDeliverySchema,
  sampleContentProvided: z.boolean(), consumptionPercentage: z.literal(0).optional() }).strict()
  .refine(v => v.deliveryStatus === "DELIVERED" ? v.consumptionPercentage === undefined : v.consumptionPercentage === 0);
export const appleConsumptionConsentInputSchema = z.object({
  expectedOrganizationId: z.string().min(1).max(80), transactionId: z.string().regex(/^[0-9]{1,40}$/),
  environment: z.enum(["Production", "Sandbox"]), consented: z.boolean(), policyVersion: z.string().min(1).max(100),
  deliveryStatus: appleConsumptionDeliverySchema.nullable().optional(), sampleContentProvided: z.boolean().nullable().optional(),
}).strict();
type ConsentInput = z.infer<typeof appleConsumptionConsentInputSchema>;
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const digest = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const terminal = ["SENT", "EXPIRED", "FAILED", "SUPPRESSED"];
const reviewAfter = (now: Date) => new Date(now.getTime() + 60_000);

async function lockedUser(db: Prisma.TransactionClient, actor: AppleBillingActor) {
  await db.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.id} FOR UPDATE`;
  const user = await db.user.findUnique({ where: { id: actor.id }, select: { id: true, organizationId: true, role: true, isActive: true, deletedAt: true } });
  if (!user?.isActive || user.deletedAt || user.organizationId !== actor.organizationId) throw new AppError("forbidden", "FORBIDDEN", 403);
  return user;
}

export function presentAppleConsumptionConsent(actorId: string, originalBuyerId: string | null,
  consent: AppleConsumptionConsent | null, request?: Pick<AppleConsumptionRequest, "status" | "lastIssue"> | null,
  eligible = true) {
  const originalBuyer = originalBuyerId === actorId;
  if (!originalBuyer) { consent = null; request = null; }
  const complete = consent?.deliveryStatus != null && consent.sampleContentProvided != null;
  const valid = Boolean(originalBuyer && eligible && consent?.consented && consent.policyVersion === APPLE_CONSUMPTION_POLICY_VERSION && complete);
  return { viewerUserId: actorId, availableToViewer: originalBuyer, policyVersion: APPLE_CONSUMPTION_POLICY_VERSION, canManage: originalBuyer && eligible, canRevoke: originalBuyer && Boolean(consent?.consented),
    consented: consent?.consented ?? false, valid,
    invalidReason: !originalBuyer ? null : !consent?.consented ? "appleConsumptionConsentRequired" : !eligible ? "appleConsumptionConsentInactive" :
      consent.policyVersion !== APPLE_CONSUMPTION_POLICY_VERSION ? "appleConsumptionPolicyChanged" : !complete ? "appleConsumptionEvidenceRequired" : null,
    grantedAt: consent?.grantedAt?.toISOString() ?? null, revokedAt: consent?.revokedAt?.toISOString() ?? null,
    deliveryStatus: appleConsumptionDeliverySchema.safeParse(consent?.deliveryStatus).success ? consent!.deliveryStatus as z.infer<typeof appleConsumptionDeliverySchema> : null,
    sampleContentProvided: consent?.sampleContentProvided ?? null,
    responseStatus: request?.status ?? null, lastIssue: request?.lastIssue ?? null };
}

/** A voluntary answer is never a prerequisite for requesting a refund or access. */
export async function setAppleConsumptionConsent(actor: AppleBillingActor, input: ConsentInput) {
  if (input.expectedOrganizationId !== actor.organizationId) throw new AppError("forbidden", "FORBIDDEN", 403);
  if (input.consented && input.policyVersion !== APPLE_CONSUMPTION_POLICY_VERSION) throw new AppError("appleConsumptionPolicyChanged", "CONFLICT", 409);
  return prisma.$transaction(async db => {
    await lockAppleOrganization(db, actor.organizationId);
    const user = await lockedUser(db, actor);
    const transaction = await db.appleTransaction.findUnique({ where: { environment_transactionId: { environment: input.environment, transactionId: input.transactionId } },
      include: { intent: { select: { createdById: true } }, consumptionConsent: true } });
    if (!transaction || transaction.organizationId !== actor.organizationId || transaction.intent?.createdById !== actor.id || (input.consented && user.role !== "ADMIN"))
      throw new AppError("forbidden", "FORBIDDEN", 403);
    const prior = transaction.consumptionConsent;
    const deliveryStatus = input.consented ? input.deliveryStatus ?? null : prior?.deliveryStatus ?? null;
    const sampleContentProvided = input.consented ? input.sampleContentProvided ?? null : prior?.sampleContentProvided ?? null;
    if (input.consented && deliveryStatus === "DELIVERED" && !await hasAppleDeliveryEvidence(db, transaction.id))
      throw new AppError("appleConsumptionDeliveryMismatch", "CONFLICT", 409);
    let consent = prior;
    if (!prior || prior.consented !== input.consented || (input.consented && (prior.policyVersion !== input.policyVersion || prior.deliveryStatus !== deliveryStatus || prior.sampleContentProvided !== sampleContentProvided))) {
      const now = new Date(), revision = (prior?.revision ?? 0) + 1;
      const data = { policyVersion: input.consented ? input.policyVersion : prior?.policyVersion ?? APPLE_CONSUMPTION_POLICY_VERSION,
        consented: input.consented, revision, deliveryStatus, sampleContentProvided,
        grantedAt: input.consented ? now : prior?.grantedAt ?? null, revokedAt: input.consented ? null : now };
      consent = prior ? await db.appleConsumptionConsent.update({ where: { id: prior.id }, data }) : await db.appleConsumptionConsent.create({ data: {
        ...data, organizationId: actor.organizationId, appleTransactionId: transaction.id, purchaserId: actor.id } });
      await db.appleConsumptionConsentEvent.create({ data: { consentId: consent.id, organizationId: actor.organizationId, actorId: actor.id, revision,
        policyVersion: data.policyVersion, consented: input.consented, deliveryStatus, sampleContentProvided } });
      await db.appleConsumptionRequest.updateMany({ where: { appleTransactionId: transaction.id, status: { notIn: terminal } }, data: { nextAttemptAt: now } });
    }
    const request = await db.appleConsumptionRequest.findFirst({ where: { appleTransactionId: transaction.id }, orderBy: { receivedAt: "desc" } });
    return { transactionId: transaction.transactionId, environment: transaction.environment as "Sandbox" | "Production", organizationId: actor.organizationId,
      consumptionConsent: presentAppleConsumptionConsent(actor.id, actor.id, consent, request, user.role === "ADMIN") };
  });
}

export async function getPersonalAppleConsumptionConsents(actor: AppleBillingActor) {
  const user = await prisma.user.findFirst({ where: { id: actor.id, organizationId: actor.organizationId, isActive: true, deletedAt: null }, select: { id: true } });
  if (!user) throw new AppError("forbidden", "FORBIDDEN", 403);
  const consents = await prisma.appleConsumptionConsent.findMany({ where: { purchaserId: actor.id, consented: true }, orderBy: { createdAt: "desc" },
    select: { id: true, policyVersion: true, consented: true, grantedAt: true, revokedAt: true } });
  return { viewerUserId: actor.id, policyVersion: APPLE_CONSUMPTION_POLICY_VERSION, consents: consents.map(c => ({ consentId: c.id, policyVersion: c.policyVersion,
    consented: c.consented, grantedAt: c.grantedAt?.toISOString() ?? null, revokedAt: c.revokedAt?.toISOString() ?? null })) };
}

/** Personal withdrawal conveys no financial history and survives role/org changes. */
export async function revokePersonalAppleConsumptionConsent(actor: AppleBillingActor, consentId: string) {
  const seed = await prisma.appleConsumptionConsent.findFirst({ where: { id: consentId, purchaserId: actor.id } });
  if (!seed) throw new AppError("forbidden", "FORBIDDEN", 403);
  await prisma.$transaction(async db => {
    await lockAppleOrganization(db, seed.organizationId); await lockedUser(db, actor);
    const consent = await db.appleConsumptionConsent.findUniqueOrThrow({ where: { id: seed.id } });
    if (consent.purchaserId !== actor.id) throw new AppError("forbidden", "FORBIDDEN", 403);
    if (!consent.consented) return;
    const revision = consent.revision + 1, now = new Date();
    await db.appleConsumptionConsent.update({ where: { id: consent.id }, data: { consented: false, revokedAt: now, revision } });
    await db.appleConsumptionConsentEvent.create({ data: { consentId: consent.id, organizationId: consent.organizationId, actorId: actor.id,
      revision, policyVersion: consent.policyVersion, consented: false, deliveryStatus: consent.deliveryStatus, sampleContentProvided: consent.sampleContentProvided } });
    await db.appleConsumptionRequest.updateMany({ where: { appleTransactionId: consent.appleTransactionId, status: { notIn: terminal } }, data: { nextAttemptAt: now } });
  });
  return getPersonalAppleConsumptionConsents(actor);
}

async function hasAppleDeliveryEvidence(db: Prisma.TransactionClient, transactionId: string, now = new Date()) {
  // An immutable period/credit lot was created only by a verified financial
  // grant. This proves entitlement delivery, not customer satisfaction/quality.
  const [period, lot] = await Promise.all([
    db.subscriptionPeriod.findFirst({ where: { appleTransactionId: transactionId, startsAt: { lte: now } }, select: { id: true } }),
    db.whatsAppCreditLot.findFirst({ where: { appleTransactionId: transactionId }, select: { id: true } }),
  ]);
  return Boolean(period || lot);
}

export function appleConsumptionPayload(evidence: { deliveryStatus: string | null; sampleContentProvided: boolean | null }): ConsumptionRequest | null {
  const delivery = appleConsumptionDeliverySchema.safeParse(evidence.deliveryStatus);
  if (!delivery.success || evidence.sampleContentProvided == null) return null;
  return { customerConsented: true, deliveryStatus: delivery.data, sampleContentProvided: evidence.sampleContentProvided,
    // Apple's V2 contract requires zero for non-delivered classifications.
    // Delivered consumption is unknown: omit it. Neutral refund preference is
    // represented by omission, never an invented NO_PREFERENCE enum/denial.
    ...(delivery.data !== DeliveryStatus.DELIVERED ? { consumptionPercentage: 0 } : {}) };
}

export async function enqueueAppleConsumptionRequest(notification: AppleServerNotification, receipt: VerifiedAppleTransaction) {
  assertVerifiedAppleTransaction(receipt);
  if (notification.notificationType !== "CONSUMPTION_REQUEST" || notification.environment !== receipt.data.environment)
    throw new AppError("applePurchaseBindingMismatch", "CONFLICT", 409);
  const d = receipt.data;
  const prior = await prisma.appleConsumptionRequest.upsert({ where: { id: notification.id }, update: {}, create: {
    id: notification.id, environment: d.environment, transactionId: d.transactionId, originalTransactionId: d.originalTransactionId,
    productId: d.productId, appAccountToken: d.appAccountToken, signedTransactionInfo: receipt.signedTransactionInfo,
    receivedAt: notification.createdAt, deadlineAt: new Date(notification.createdAt.getTime() + 12 * 60 * 60_000),
    nextAttemptAt: new Date(), status: "WAITING_BINDING" } });
  if (prior.environment !== d.environment || prior.transactionId !== d.transactionId || prior.originalTransactionId !== d.originalTransactionId ||
    prior.productId !== d.productId || prior.appAccountToken !== d.appAccountToken || prior.signedTransactionInfo !== receipt.signedTransactionInfo)
    throw new AppError("applePurchaseBindingMismatch", "CONFLICT", 409);
  return prior;
}

const reportingAllowed = (environment: string, organizationId: string) => {
  const config = appleBillingConfig();
  const mode = process.env.APPLE_CONSUMPTION_REPORTING_MODE;
  return config.apiReady && (environment === "Sandbox" ? ["sandbox", "live"].includes(mode ?? "") && config.sandboxOrganizations.has(organizationId)
    : environment === "Production" && mode === "live");
};
type Sender = (environment: "Sandbox" | "Production", transactionId: string, payload: ConsumptionRequest) => Promise<void>;

async function bindRequest(id: string, token: string) {
  const request = await prisma.appleConsumptionRequest.findUniqueOrThrow({ where: { id } });
  if (request.processingToken !== token) return null;
  const row = await prisma.appleTransaction.findUnique({ where: { environment_transactionId: { environment: request.environment, transactionId: request.transactionId } } });
  if (!row) {
    await prisma.appleConsumptionRequest.updateMany({ where: { id, processingToken: token }, data: { status: "WAITING_BINDING", lastIssue: "appleConsumptionBindingRequired", nextAttemptAt: reviewAfter(new Date()), processingToken: null, processingUntil: null } }); return null;
  }
  if (row.originalTransactionId !== request.originalTransactionId || row.productId !== request.productId || row.appAccountToken !== request.appAccountToken ||
    (request.organizationId && request.organizationId !== row.organizationId)) {
    await prisma.appleConsumptionRequest.updateMany({ where: { id, processingToken: token }, data: { status: "FAILED", lastIssue: "applePurchaseBindingMismatch", processingToken: null, processingUntil: null } }); return null;
  }
  await prisma.appleConsumptionRequest.updateMany({ where: { id, processingToken: token }, data: { organizationId: row.organizationId, appleTransactionId: row.id } });
  return row;
}

/** Lease recovery retries only the same frozen informational PUT, never a grant. */
export async function processAppleConsumptionRequests(options: { sender?: Sender; limit?: number } = {}) {
  const now = new Date();
  await prisma.appleConsumptionRequest.updateMany({ where: { status: { notIn: terminal }, deadlineAt: { lte: now },
    OR: [{ processingUntil: null }, { processingUntil: { lte: now } }] }, data: { status: "EXPIRED", lastIssue: "appleConsumptionDeadlineExpired", processingToken: null, processingUntil: null } });
  const rows = await prisma.appleConsumptionRequest.findMany({ where: { status: { notIn: terminal }, deadlineAt: { gt: now }, nextAttemptAt: { lte: now },
    OR: [{ processingUntil: null }, { processingUntil: { lte: now } }] }, orderBy: { deadlineAt: "asc" }, take: Math.min(options.limit ?? 20, 50) });
  let sent = 0, attempted = 0;
  for (const seed of rows) {
    if (attempted >= 3) break;
    const token = randomUUID();
    const claimed = await prisma.appleConsumptionRequest.updateMany({ where: { id: seed.id, status: { notIn: terminal },
      OR: [{ processingUntil: null }, { processingUntil: { lte: new Date() } }] }, data: { processingToken: token, processingUntil: new Date(Date.now() + 120_000) } });
    if (!claimed.count) continue;
    try {
      const row = await bindRequest(seed.id, token); if (!row) continue;
      // Freeze the exact body durably BEFORE the external attempt. If a process
      // dies after Apple accepted but before our commit, recovery reuses it.
      const ready = await prisma.$transaction(async db => prepareResponse(db, seed.id, token, row.organizationId, true));
      if (!ready) continue;
      const result = await prisma.$transaction(async db => {
        const current = await prepareResponse(db, seed.id, token, row.organizationId);
        if (!current) return false;
        const attemptAt = new Date();
        if (current.deadlineAt <= attemptAt) return false;
        await db.appleConsumptionRequest.update({ where: { id: current.id }, data: { status: "SENDING" } });
        attempted++;
        try {
          await (options.sender ?? sendAppleConsumptionInformation)(current.environment as "Sandbox" | "Production", current.transactionId, payloadSchema.parse(current.payload));
          await db.appleConsumptionRequest.update({ where: { id: current.id }, data: { status: "SENT", sentAt: new Date(), lastIssue: null, processingToken: null, processingUntil: null } });
          return true;
        } catch (e) {
          const permanent = e instanceof AppleConsumptionTransportError && [400, 404, 409, 422].includes(e.status ?? 0);
          await db.appleConsumptionRequest.update({ where: { id: current.id }, data: { status: permanent ? "FAILED" : "PENDING",
            lastIssue: e instanceof AppleConsumptionTransportError ? e.code : "appleConsumptionOutcomeUnknown",
            nextAttemptAt: new Date(Math.min(current.deadlineAt.getTime(), Date.now() + Math.min(900_000, 30_000 * 2 ** Math.min(current.attemptCount, 5)))),
            processingToken: null, processingUntil: null } });
          return false;
        }
      }, { timeout: 45_000, maxWait: 5000 });
      if (result) sent++;
    } catch {
      // An ambiguous commit/transport outcome is not proof that no data left.
      await prisma.appleConsumptionRequest.updateMany({ where: { id: seed.id, processingToken: token }, data: {
        status: "PENDING", lastIssue: "appleConsumptionOutcomeUnknown", nextAttemptAt: reviewAfter(new Date()), processingToken: null, processingUntil: null } });
    }
  }
  return { examined: rows.length, attempted, sent };
}

async function prepareResponse(db: Prisma.TransactionClient, id: string, token: string, organizationId: string, authorizeAttempt = false) {
  await db.$executeRaw`SET LOCAL lock_timeout = '3s'`;
  await lockAppleOrganization(db, organizationId);
  const request = await db.appleConsumptionRequest.findUniqueOrThrow({ where: { id } });
  if (request.processingToken !== token || terminal.includes(request.status)) return null;
  const stop = async (status: string, lastIssue: string) => {
    await db.appleConsumptionRequest.update({ where: { id }, data: { status, lastIssue, nextAttemptAt: reviewAfter(new Date()), processingToken: null, processingUntil: null } }); return null;
  };
  if (request.deadlineAt <= new Date()) return stop("EXPIRED", "appleConsumptionDeadlineExpired");
  const row = await db.appleTransaction.findUniqueOrThrow({ where: { id: request.appleTransactionId! }, include: { intent: { select: { createdById: true } }, consumptionConsent: true } });
  if (row.organizationId !== organizationId || row.environment !== request.environment || row.transactionId !== request.transactionId || row.productId !== request.productId ||
    row.originalTransactionId !== request.originalTransactionId || row.appAccountToken !== request.appAccountToken) return stop("FAILED", "applePurchaseBindingMismatch");
  const buyer = row.intent?.createdById;
  if (buyer) await db.$queryRaw`SELECT id FROM "User" WHERE id = ${buyer} FOR UPDATE`;
  const user = buyer ? await db.user.findUnique({ where: { id: buyer }, select: { organizationId: true, isActive: true, deletedAt: true, role: true } }) : null;
  if (row.consumptionConsent) await db.$queryRaw`SELECT id FROM "AppleConsumptionConsent" WHERE id = ${row.consumptionConsent.id} FOR UPDATE`;
  // The first relation read may precede a wait on the buyer/consent locks.
  // Re-read after acquiring both; a just-committed withdrawal must win.
  const consent = await db.appleConsumptionConsent.findUnique({ where: { appleTransactionId: row.id } });
  if (!buyer || !user?.isActive || user.deletedAt || user.role !== "ADMIN" || user.organizationId !== organizationId || !consent?.consented ||
    consent.purchaserId !== buyer || consent.policyVersion !== APPLE_CONSUMPTION_POLICY_VERSION)
    return stop(request.payload ? "SUPPRESSED" : "WAITING_CONSENT", "appleConsumptionConsentInactive");
  if (request.payload && request.consentRevision !== consent.revision) return stop("SUPPRESSED", "appleConsumptionConsentChanged");
  const payload = appleConsumptionPayload(consent);
  if (!payload) return stop("WAITING_EVIDENCE", "appleConsumptionEvidenceRequired");
  if (payload.deliveryStatus === "DELIVERED" && !await hasAppleDeliveryEvidence(db, row.id)) return stop("WAITING_EVIDENCE", "appleConsumptionDeliveryMismatch");
  if (!reportingAllowed(request.environment, organizationId)) return stop("PENDING", "appleConsumptionReportingDisabled");
  if (request.payload) {
    if (!payloadSchema.safeParse(request.payload).success || request.payloadDigest !== digest(payload)) return stop("SUPPRESSED", "appleConsumptionConsentChanged");
    return authorizeAttempt ? db.appleConsumptionRequest.update({ where: { id }, data: { attemptCount: { increment: 1 }, lastAttemptAt: new Date() } }) : request;
  }
  return db.appleConsumptionRequest.update({ where: { id }, data: { payload: json(payload), payloadDigest: digest(payload), consentRevision: consent.revision, status: "PENDING", lastIssue: null,
    ...(authorizeAttempt ? { attemptCount: { increment: 1 }, lastAttemptAt: new Date() } : {}) } });
}
