import { randomUUID } from "node:crypto";
import { Environment } from "@apple/app-store-server-library";
import bcrypt from "bcryptjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/prisma";
import { createContractTerms } from "@/server/billing/contractTerms";
import { appleSubscriptionOffer } from "@/server/billing/appleOfferCatalog";
import { applyAppleTransaction, authorizeApplePurchase, createApplePurchaseIntent, getApplePurchasePreview, getAppleBillingState } from "@/server/billing/applePayments";
import { acceptAppleServerNotification } from "@/server/billing/appleLifecycle";
import { APPLE_CONSUMPTION_POLICY_VERSION, enqueueAppleConsumptionRequest, getPersonalAppleConsumptionConsents, processAppleConsumptionRequests, revokePersonalAppleConsumptionConsent, setAppleConsumptionConsent } from "@/server/billing/appleConsumption";
import { AppleConsumptionTransportError } from "@/server/billing/appleConsumptionTransport";
import * as verification from "@/server/billing/appleVerification";
import { LEGAL_TERMS_VERSION } from "@/lib/legalPublication";
import { deleteOwnAccount } from "@/server/services/accountDeletion";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { signSyntheticApplePayload, syntheticAppleTransaction, syntheticAppleVerifier } from "../helpers/appleSignedFixture";
import { parsePreflightTarget, runIosBillingPreflight } from "../../scripts/deployment/ios-billing-preflight";

const describeDb = shouldRunDbTests ? describe : describe.skip;
const terms = createContractTerms("2026-11");
const selection = { plan: "BUSINESS" as const, months: 1 as const, extras: { stores: 0, productPacks: 0, userPacks: 0 as const } };
async function fixture(grant = true) {
  const f = await seedBase({ plan: "BUSINESS" });
  await prisma.organization.update({ where: { id: f.org.id }, data: { subscriptionBillingMode: "SELF_SERVE", currentPeriodEndsAt: null, trialEndsAt: null } });
  await prisma.subscriptionContract.create({ data: { organizationId: f.org.id, catalogVersion: "2026-11", termsSnapshot: terms } });
  const offer = appleSubscriptionOffer(terms, selection);
  for (const [key, value] of Object.entries({ APPLE_BILLING_MODE: "sandbox", APPLE_APP_ID: "1234567890", APPLE_IAP_KEY_ID: "SYNTHETIC",
    APPLE_IAP_ISSUER_ID: "SYNTHETIC", APPLE_IAP_PRIVATE_KEY: "SYNTHETIC PRIVATE KEY", APPLE_BILLING_TERMS_VERSION: LEGAL_TERMS_VERSION,
    APPLE_BILLING_TERMS_APPROVED: "true", APPLE_BILLING_SALES_APPROVED: "true", APPLE_BILLING_SANDBOX_ORGANIZATION_IDS: f.org.id,
    APPLE_CONSUMPTION_REPORTING_MODE: "sandbox", APPLE_BILLING_CATALOG_JSON: JSON.stringify([{ offerKey: offer.offerKey, productId: "synthetic.consumption.business", productType: "NON_RENEWING", approved: true }]) })) vi.stubEnv(key, value);
  const actor = { id: f.adminUser.id, organizationId: f.org.id };
  const preview = await getApplePurchasePreview(actor, { expectedOrganizationId: f.org.id, offerKey: offer.offerKey, action: "RENEW" });
  const intent = await createApplePurchaseIntent(actor, { expectedOrganizationId: f.org.id, offerKey: offer.offerKey, action: "RENEW", idempotencyKey: randomUUID(),
    quoteToken: preview.quoteToken ?? undefined, acceptedTerms: true, termsVersion: LEGAL_TERMS_VERSION });
  await authorizeApplePurchase(actor, intent.intentId, { attemptId: randomUUID() });
  const signed = syntheticAppleTransaction({ appAccountToken: intent.appAccountToken, productId: intent.productId, purchaseDate: Date.now() - 1000 });
  if (grant) await applyAppleTransaction(await syntheticAppleVerifier().transaction(signed), { organizationId: f.org.id, intentId: intent.intentId, source: "CLIENT" });
  vi.spyOn(verification, "appleReceiptVerifier").mockImplementation(environment => syntheticAppleVerifier(environment === "Production" ? Environment.PRODUCTION : Environment.SANDBOX));
  return { ...f, actor, intent, signed };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const consent = (f: Fixture, extra: object = {}) => setAppleConsumptionConsent(f.actor, { expectedOrganizationId: f.org.id, transactionId: "100000000000001", environment: "Sandbox",
  consented: true, policyVersion: APPLE_CONSUMPTION_POLICY_VERSION, deliveryStatus: "DELIVERED", sampleContentProvided: false, ...extra });
async function request(f: Fixture, receivedAt?: Date) {
  const id = randomUUID();
  const signedPayload = signSyntheticApplePayload({ notificationType: "CONSUMPTION_REQUEST", notificationUUID: id, version: "2.0", signedDate: Date.now(),
    data: { bundleId: "kg.bazaar.app", appAppleId: 1234567890, environment: "Sandbox", signedTransactionInfo: f.signed } });
  if (!receivedAt) await acceptAppleServerNotification(signedPayload);
  else {
    const notification = await prisma.appleServerNotification.create({ data: { id, environment: "Sandbox", notificationType: "CONSUMPTION_REQUEST", signedPayload, signedAt: new Date(), createdAt: receivedAt } });
    await enqueueAppleConsumptionRequest(notification, await syntheticAppleVerifier().transaction(f.signed));
  }
  return id;
}
const due = () => prisma.appleConsumptionRequest.updateMany({ where: { status: { notIn: ["SENT", "FAILED", "SUPPRESSED", "EXPIRED"] } }, data: { nextAttemptAt: new Date(0) } });
const counts = async () => ({ periods: await prisma.subscriptionPeriod.count(), invoices: await prisma.subscriptionInvoice.count(), receipts: await prisma.appleTransaction.count(),
  lots: await prisma.whatsAppCreditLot.count(), usage: await prisma.subscriptionUsageBucket.count(), reservations: await prisma.subscriptionUsageReservation.count() });
const audit = () => {
  const connection = new URL(process.env.DATABASE_URL!);
  const args = ["--url-env", "EXPLICIT_OWNED_CONSUMPTION_AUDIT_URL", "--expect-host", connection.hostname, "--expect-port", connection.port || "5432",
    "--expect-database", decodeURIComponent(connection.pathname.slice(1)), "--expect-user", decodeURIComponent(connection.username), "--expect-stage", "POST_TEMPORARY_MINIMUM"];
  if (process.env.IOS_MIGRATION_PREFLIGHT_PSQL) args.push("--psql", process.env.IOS_MIGRATION_PREFLIGHT_PSQL);
  return runIosBillingPreflight(parsePreflightTarget(args, { EXPLICIT_OWNED_CONSUMPTION_AUDIT_URL: process.env.DATABASE_URL }));
};

describeDb("Apple Consumption Information V2 consent/tenant/recovery on PostgreSQL", () => {
  beforeEach(resetDatabase);
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("durably ingests a verified request once without a grant, response, or inferred consent", async () => {
    const f = await fixture(false), before = await counts(), id = await request(f), sender = vi.fn().mockResolvedValue(undefined);
    const notification = await prisma.appleServerNotification.findUniqueOrThrow({ where: { id } });
    await acceptAppleServerNotification(notification.signedPayload);
    expect(await prisma.appleConsumptionRequest.count()).toBe(1);
    expect(await counts()).toEqual(before);
    await processAppleConsumptionRequests({ sender });
    expect(sender).not.toHaveBeenCalled();
    expect(await prisma.appleConsumptionRequest.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "WAITING_BINDING", payload: null });
  });
  it("does not send without explicit original purchaser consent, and unknown answers remain allowed", async () => {
    const f = await fixture(), id = await request(f), sender = vi.fn().mockResolvedValue(undefined);
    await processAppleConsumptionRequests({ sender }); expect(sender).not.toHaveBeenCalled();
    const result = await consent(f, { deliveryStatus: null, sampleContentProvided: null });
    expect(result.consumptionConsent).toMatchObject({ consented: true, valid: false, invalidReason: "appleConsumptionEvidenceRequired" });
    await processAppleConsumptionRequests({ sender }); expect(sender).not.toHaveBeenCalled();
    expect((await prisma.appleConsumptionRequest.findUniqueOrThrow({ where: { id } })).status).toBe("WAITING_EVIDENCE");
    await consent(f, { consented: false });
    expect(await prisma.appleConsumptionConsentEvent.count()).toBe(2);
  });
  it("sends only the minimal evidence-backed V2 payload, preserving all financial/usage records", async () => {
    const f = await fixture(), before = await counts(), id = await request(f), sender = vi.fn().mockResolvedValue(undefined);
    await consent(f);
    const result = await processAppleConsumptionRequests({ sender });
    expect(result.sent).toBe(1);
    expect(sender).toHaveBeenCalledExactlyOnceWith("Sandbox", "100000000000001", { customerConsented: true, deliveryStatus: "DELIVERED", sampleContentProvided: false });
    const row = await prisma.appleConsumptionRequest.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: "SENT", attemptCount: 1, consentRevision: 1 }); expect(row.sentAt).not.toBeNull();
    await due(); await processAppleConsumptionRequests({ sender }); expect(sender).toHaveBeenCalledTimes(1);
    expect(await counts()).toEqual(before);
  });
  it("honors declined/unknown sample information instead of assuming the tariff card was a sample", async () => {
    const f = await fixture(), sender = vi.fn().mockResolvedValue(undefined); await request(f);
    await consent(f, { sampleContentProvided: null }); await processAppleConsumptionRequests({ sender }); expect(sender).not.toHaveBeenCalled();
    await consent(f, { sampleContentProvided: false }); await processAppleConsumptionRequests({ sender });
    expect(sender.mock.calls[0][2].sampleContentProvided).toBe(false);
  });
  it("never reports delivered for unserved financial REVIEW, while an explicit undelivered answer needs no invented usage", async () => {
    const f = await fixture(false), sender = vi.fn().mockResolvedValue(undefined);
    await prisma.organization.update({ where: { id: f.org.id }, data: { subscriptionBillingMode: "MANUAL" } });
    const money = await applyAppleTransaction(await syntheticAppleVerifier().transaction(f.signed), { organizationId: f.org.id, intentId: f.intent.intentId, source: "CLIENT" });
    expect(money.status).toBe("REVIEW");
    await expect(consent(f)).rejects.toThrow("appleConsumptionDeliveryMismatch");
    await consent(f, { deliveryStatus: "UNDELIVERED_OTHER" }); await request(f);
    const before = await counts(); await processAppleConsumptionRequests({ sender });
    expect(sender).toHaveBeenCalledExactlyOnceWith("Sandbox", "100000000000001", { customerConsented: true, deliveryStatus: "UNDELIVERED_OTHER", sampleContentProvided: false, consumptionPercentage: 0 });
    expect(await counts()).toEqual(before); expect(await prisma.subscriptionPeriod.count()).toBe(0);
  });
  it("enforces original purchaser, tenant, environment and current ADMIN for granting", async () => {
    const f = await fixture();
    await prisma.user.update({ where: { id: f.managerUser.id }, data: { role: "ADMIN" } });
    const input = { expectedOrganizationId: f.org.id, transactionId: "100000000000001", environment: "Sandbox" as const, consented: true, policyVersion: APPLE_CONSUMPTION_POLICY_VERSION };
    await expect(setAppleConsumptionConsent({ id: f.managerUser.id, organizationId: f.org.id }, input)).rejects.toThrow("forbidden");
    await expect(consent(f, { expectedOrganizationId: "foreign-org" })).rejects.toThrow("forbidden");
    await expect(consent(f, { environment: "Production" })).rejects.toThrow("forbidden");
    await expect(consent(f, { policyVersion: "old-unshown-policy" })).rejects.toThrow("appleConsumptionPolicyChanged");
    expect(await prisma.appleConsumptionConsent.count()).toBe(0);
  });
  it("hides original buyer's personal evidence from a different organization administrator", async () => {
    const f = await fixture(); await consent(f); await prisma.user.update({ where: { id: f.managerUser.id }, data: { role: "ADMIN" } });
    const state = await getAppleBillingState({ id: f.managerUser.id, organizationId: f.org.id });
    expect(state.recentTransactions[0].consumptionConsent).toMatchObject({ viewerUserId: f.managerUser.id, availableToViewer: false, canManage: false, canRevoke: false,
      consented: false, deliveryStatus: null, sampleContentProvided: null, grantedAt: null, responseStatus: null, invalidReason: null });
  });
  it("keeps reporting disabled by default even with valid consent, keys, and approved test sales", async () => {
    const f = await fixture(), id = await request(f), sender = vi.fn().mockResolvedValue(undefined); await consent(f); vi.stubEnv("APPLE_CONSUMPTION_REPORTING_MODE", "");
    await processAppleConsumptionRequests({ sender }); expect(sender).not.toHaveBeenCalled();
    expect(await prisma.appleConsumptionRequest.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "PENDING", payload: null, lastIssue: "appleConsumptionReportingDisabled" });
  });
  it("does not send Sandbox data for a nonallowlisted organization", async () => {
    const f = await fixture(), sender = vi.fn().mockResolvedValue(undefined); await request(f); await consent(f); vi.stubEnv("APPLE_BILLING_SANDBOX_ORGANIZATION_IDS", "");
    await processAppleConsumptionRequests({ sender }); expect(sender).not.toHaveBeenCalled();
  });
  it("never extends the12h deadline on replay and expires an unsent historical request", async () => {
    const f = await fixture(), received = new Date(Date.now() - 13 * 60 * 60_000), id = await request(f, received), sender = vi.fn().mockResolvedValue(undefined); await consent(f);
    await processAppleConsumptionRequests({ sender }); expect(sender).not.toHaveBeenCalled();
    const row = await prisma.appleConsumptionRequest.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("EXPIRED"); expect(row.deadlineAt.getTime()).toBe(received.getTime() + 12 * 60 * 60_000);
    await expect(prisma.appleConsumptionRequest.update({ where: { id }, data: { deadlineAt: new Date(Date.now() + 12 * 60 * 60_000) } })).rejects.toThrow();
  });
  it("retries an ambiguous accepted-response loss with the exact frozen body and no second grant", async () => {
    const f = await fixture(), id = await request(f); await consent(f); const before = await counts();
    const sender = vi.fn().mockRejectedValueOnce(new AppleConsumptionTransportError("appleConsumptionOutcomeUnknown")).mockResolvedValue(undefined);
    await processAppleConsumptionRequests({ sender }); const first = await prisma.appleConsumptionRequest.findUniqueOrThrow({ where: { id } });
    expect(first).toMatchObject({ status: "PENDING", attemptCount: 1, consentRevision: 1 });
    await due(); await processAppleConsumptionRequests({ sender });
    const next = await prisma.appleConsumptionRequest.findUniqueOrThrow({ where: { id } });
    expect(next).toMatchObject({ status: "SENT", attemptCount: 2, payloadDigest: first.payloadDigest, consentRevision: 1 });
    expect(sender.mock.calls[0]).toEqual(sender.mock.calls[1]); expect(await counts()).toEqual(before);
  });
  it("does not retry a permanent provider rejection or claim that it succeeded", async () => {
    const f = await fixture(), id = await request(f), sender = vi.fn().mockRejectedValue(new AppleConsumptionTransportError("appleConsumptionProviderRejected", 400)); await consent(f);
    await processAppleConsumptionRequests({ sender }); await due(); await processAppleConsumptionRequests({ sender });
    expect(sender).toHaveBeenCalledTimes(1); expect(await prisma.appleConsumptionRequest.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "FAILED", sentAt: null });
  });
  it("withdrawal suppresses a frozen uncertain response and regrant never repurposes that old request", async () => {
    const f = await fixture(), id = await request(f); await consent(f);
    const sender = vi.fn().mockRejectedValue(new AppleConsumptionTransportError("appleConsumptionOutcomeUnknown"));
    await processAppleConsumptionRequests({ sender }); await consent(f, { consented: false });
    await processAppleConsumptionRequests({ sender }); expect(sender).toHaveBeenCalledTimes(1);
    expect((await prisma.appleConsumptionRequest.findUniqueOrThrow({ where: { id } })).status).toBe("SUPPRESSED");
    await consent(f); await due(); await processAppleConsumptionRequests({ sender }); expect(sender).toHaveBeenCalledTimes(1);
  });
  it.each(["STAFF", "INACTIVE", "DEPARTED"] as const)("rechecks buyer eligibility at dispatch after %s and permits personal withdrawal without financial history", async state => {
    const f = await fixture(), sender = vi.fn().mockResolvedValue(undefined); await request(f); await consent(f);
    const targetOrg = state === "DEPARTED" ? await prisma.organization.create({ data: { name: "Synthetic new membership" } }) : f.org;
    await prisma.user.update({ where: { id: f.adminUser.id }, data: state === "STAFF" ? { role: "STAFF" } : state === "INACTIVE" ? { isActive: false } : { organizationId: targetOrg.id } });
    await processAppleConsumptionRequests({ sender }); expect(sender).not.toHaveBeenCalled();
    if (state !== "INACTIVE") {
      const actor = { id: f.actor.id, organizationId: targetOrg.id }, personal = await getPersonalAppleConsumptionConsents(actor);
      expect(Object.keys(personal.consents[0]).sort()).toEqual(["consentId", "consented", "grantedAt", "policyVersion", "revokedAt"].sort());
      const updated = await revokePersonalAppleConsumptionConsent(actor, personal.consents[0].consentId);
      expect(updated.consents).toHaveLength(0);
    }
  });
  it("does not share under an earlier consent after the original purchaser deletes their account", async () => {
    const f = await fixture(), sender = vi.fn().mockResolvedValue(undefined); await request(f); await consent(f);
    await prisma.user.update({ where: { id: f.actor.id }, data: { passwordHash: await bcrypt.hash("synthetic-consumption-delete", 4) } });
    await deleteOwnAccount({ userId: f.actor.id, organizationId: f.org.id, requestId: randomUUID(), password: "synthetic-consumption-delete", confirmation: "DELETE", successorUserId: f.managerUser.id });
    await processAppleConsumptionRequests({ sender }); expect(sender).not.toHaveBeenCalled();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: f.actor.id } })).deletedAt).not.toBeNull();
    expect(await prisma.appleConsumptionConsentEvent.count()).toBe(1);
  });
  it("re-reads a deactivation that commits while the worker waits for the actual buyer row lock", async () => {
    const f = await fixture(), sender = vi.fn().mockResolvedValue(undefined); await request(f); await consent(f);
    let release!: () => void, entered!: (pid: number) => void;
    const unlocked = new Promise<void>(resolve => { release = resolve; });
    const locked = new Promise<number>(resolve => { entered = resolve; });
    const holder = prisma.$transaction(async db => {
      await db.user.update({ where: { id: f.actor.id }, data: { isActive: false } });
      const [pid] = await db.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      entered(pid.pid); await unlocked;
    }, { timeout: 15_000 }).then(value => ({ status: "fulfilled" as const, value }), reason => ({ status: "rejected" as const, reason }));
    let worker: Promise<Awaited<ReturnType<typeof processAppleConsumptionRequests>>> | undefined;
    try {
      const pid = await locked; worker = processAppleConsumptionRequests({ sender });
      let blocked = false;
      for (let i = 0; i < 100; i++) {
        const [state] = await prisma.$queryRaw<{ blocked: boolean }[]>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))) AS blocked`;
        if (state.blocked) { blocked = true; break; } await new Promise<void>(resolve => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true); release(); expect(await holder).toMatchObject({ status: "fulfilled" }); await worker;
      expect(sender).not.toHaveBeenCalled();
    } finally { release(); await holder; if (worker) await worker; }
  });
  it("serializes competing workers to one accepted response and recovers an expired lease", async () => {
    const f = await fixture(), id = await request(f), sender = vi.fn().mockResolvedValue(undefined); await consent(f);
    await prisma.appleConsumptionRequest.update({ where: { id }, data: { processingToken: randomUUID(), processingUntil: new Date(Date.now() - 1000) } });
    const both = await Promise.allSettled([processAppleConsumptionRequests({ sender }), processAppleConsumptionRequests({ sender })]);
    expect(both.every(r => r.status === "fulfilled")).toBe(true); expect(sender).toHaveBeenCalledTimes(1);
  });
  it("the SQL boundary prevents foreign binding, altered frozen payloads, and unaudited consent rewrites", async () => {
    const f = await fixture(), id = await request(f); await consent(f);
    const sender = vi.fn().mockRejectedValue(new AppleConsumptionTransportError("appleConsumptionOutcomeUnknown")); await processAppleConsumptionRequests({ sender });
    await expect(prisma.appleConsumptionRequest.update({ where: { id }, data: { organizationId: "foreign" } })).rejects.toThrow();
    await expect(prisma.appleConsumptionRequest.update({ where: { id }, data: { payload: { customerConsented: true, deliveryStatus: "DELIVERED", sampleContentProvided: true } } })).rejects.toThrow();
    const saved = await prisma.appleConsumptionConsent.findFirstOrThrow();
    await expect(prisma.appleConsumptionConsent.update({ where: { id: saved.id }, data: { revision: saved.revision + 1, sampleContentProvided: true } })).rejects.toThrow();
    await expect(prisma.appleConsumptionConsentEvent.deleteMany()).rejects.toThrow();
  });
  it("read-only preflight validates historical sent evidence after withdrawal and emits only counts", async () => {
    const f = await fixture(); await consent(f); const id = await request(f), sender = vi.fn().mockResolvedValue(undefined);
    await processAppleConsumptionRequests({ sender }); await consent(f, { consented: false });
    const before = await prisma.appleConsumptionRequest.findUniqueOrThrow({ where: { id } });
    const result = await audit();
    expect(result).toMatchObject({ ok: true, schemaStage: "POST_TEMPORARY_MINIMUM", blockerChecks: 0, skippedChecks: 0 });
    expect(result.checks.find(c => c.name === "consumption_request_rows_total")?.count).toBe(1);
    for (const check of result.checks.filter(c => c.name.startsWith("consumption_") && c.severity === "blocker")) expect(check.count).toBe(0);
    for (const privateValue of [f.org.id, f.actor.id, f.signed, id]) expect(JSON.stringify(result)).not.toContain(privateValue);
    expect(await prisma.appleConsumptionRequest.findUniqueOrThrow({ where: { id } })).toEqual(before);
  });
  it("read-only preflight detects disabled consent-audit enforcement instead of accepting a table-shaped stub", async () => {
    await fixture();
    await prisma.$executeRawUnsafe('ALTER TABLE "AppleConsumptionConsentEvent" DISABLE TRIGGER "AppleConsumptionConsentEvent_protect"');
    try {
      const result = await audit(); expect(result.ok).toBe(false);
      expect(result.checks.find(c => c.name === "consumption_required_triggers_missing")?.count).toBe(1);
    } finally { await prisma.$executeRawUnsafe('ALTER TABLE "AppleConsumptionConsentEvent" ENABLE TRIGGER "AppleConsumptionConsentEvent_protect"'); }
  });
});
