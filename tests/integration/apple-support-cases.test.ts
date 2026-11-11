import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { Environment, Type } from "@apple/app-store-server-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/prisma";
import { LEGAL_TERMS_VERSION } from "@/lib/legalPublication";
import { createContractTerms } from "@/server/billing/contractTerms";
import { appleSubscriptionOffer } from "@/server/billing/appleOfferCatalog";
import { authorizeApplePurchase, createApplePurchaseIntent } from "@/server/billing/applePayments";
import { getAppleSupportCase, importAppleSupportEvidence, listAppleSupportCases, recheckAppleSupportCase } from "@/server/billing/appleSupportCases";
import { deleteOwnAccount } from "@/server/services/accountDeletion";
import * as verification from "@/server/billing/appleVerification";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { syntheticAppleTransaction, syntheticAppleVerifier } from "../helpers/appleSignedFixture";

const describeDb = shouldRunDbTests ? describe : describe.skip;
const terms = createContractTerms("2026-11"), selection = { plan: "BUSINESS" as const, months: 1 as const, extras: { stores: 0, productPacks: 0, userPacks: 0 as const } };
const seed = async () => {
  const f = await seedBase({ plan: "BUSINESS" });
  await prisma.organization.update({ where: { id: f.org.id }, data: { subscriptionBillingMode: "SELF_SERVE", trialEndsAt: null, currentPeriodEndsAt: null } });
  await prisma.subscriptionContract.create({ data: { organizationId: f.org.id, catalogVersion: "2026-11", termsSnapshot: terms } });
  const mapping = { offerKey: appleSubscriptionOffer(terms, selection).offerKey, productId: "synthetic.support.business", productType: "AUTO_RENEWABLE",
    subscriptionGroupId: "synthetic-support-group", approved: true };
  for (const [key, value] of Object.entries({ APPLE_BILLING_MODE: "sandbox", APPLE_APP_ID: "1234567890", APPLE_IAP_KEY_ID: "SYNTHETIC",
    APPLE_IAP_ISSUER_ID: "SYNTHETIC", APPLE_IAP_PRIVATE_KEY: "SYNTHETIC PRIVATE KEY", APPLE_BILLING_TERMS_VERSION: LEGAL_TERMS_VERSION,
    APPLE_BILLING_TERMS_APPROVED: "true", APPLE_BILLING_SALES_APPROVED: "true", APPLE_BILLING_SANDBOX_ORGANIZATION_IDS: f.org.id,
    APPLE_BILLING_CATALOG_JSON: JSON.stringify([mapping]) })) vi.stubEnv(key, value);
  const actor = { id: f.adminUser.id, organizationId: f.org.id };
  const intent = await createApplePurchaseIntent(actor, { expectedOrganizationId: f.org.id, offerKey: mapping.offerKey, action: "RENEW",
    idempotencyKey: randomUUID(), acceptedTerms: true, termsVersion: LEGAL_TERMS_VERSION });
  const attemptId = randomUUID(); await authorizeApplePurchase(actor, intent.intentId, { attemptId });
  const operatorOrg = await prisma.organization.create({ data: { name: "Synthetic platform operations" } });
  const operator = await prisma.user.create({ data: { organizationId: operatorOrg.id, email: "apple-support-operator@synthetic.invalid",
    name: "Synthetic platform operator", role: "STAFF", passwordHash: "not-a-login" } });
  vi.stubEnv("PLATFORM_OWNER_EMAILS", operator.email);
  const caseId = `intent:${intent.intentId}`, scope = { id: operator.id, requestId: "synthetic-apple-support", caseId };
  const payload = { appAccountToken: intent.appAccountToken, productId: intent.productId, type: Type.AUTO_RENEWABLE_SUBSCRIPTION,
    subscriptionGroupIdentifier: "synthetic-support-group", purchaseDate: Date.now(), expiresDate: Date.now() + 30 * 86_400_000,
    transactionId: "100000000000001", originalTransactionId: "100000000000001", price: 9990, currency: "USD" };
  return { ...f, intent, attemptId, operator, caseId, scope, payload };
};
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((yes) => { resolve = yes; }); return { promise, resolve }; };

describeDb("platform Apple case review without unsupported absence clearing", () => {
  let network: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    await resetDatabase(); network = vi.fn(() => { throw new Error("Apple support tests cannot call providers"); }); vi.stubGlobal("fetch", network);
    vi.spyOn(verification, "verifyAppleTransaction").mockImplementation((signed) => syntheticAppleVerifier().transaction(signed));
    vi.spyOn(verification, "appleReceiptVerifier").mockImplementation((environment) => syntheticAppleVerifier(environment === "Production" ? Environment.PRODUCTION : Environment.SANDBOX));
  });
  afterEach(() => { expect(network).not.toHaveBeenCalled(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("keeps a reference-less legacy hold unresolved and exposes no native secrets or private payer identity", async () => {
    const f = await seed(), before = await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: f.intent.intentId } });
    const view = await getAppleSupportCase(f.operator.id, f.caseId);
    expect(view).toMatchObject({ state: "NATIVE_PENDING", hasAppleReference: false, completionCapability: false, transaction: null });
    const serialized = JSON.stringify(view);
    for (const secret of [f.attemptId, f.adminUser.email, f.adminUser.passwordHash, f.intent.appAccountToken]) expect(serialized).not.toContain(secret);
    expect(await recheckAppleSupportCase(f.scope)).toMatchObject({ status: "NO_APPLE_REFERENCE", checkedReferences: 0 });
    expect(await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: before.id } })).toEqual(before);
    expect(await prisma.appleTransaction.count()).toBe(0); expect(await prisma.subscriptionPeriod.count()).toBe(0);
    await expect(getAppleSupportCase(f.adminUser.id, f.caseId)).rejects.toThrow("forbidden");
    expect((await listAppleSupportCases(f.operator.id, { limit: 1 })).items[0]?.caseId).toBe(f.caseId);
  });

  it("applies genuine verified funding after payer deletion without restoring that user or mixing USD into gateway invoices", async () => {
    const f = await seed(), password = "Synthetic-support-payer-password";
    await prisma.user.update({ where: { id: f.adminUser.id }, data: { passwordHash: await bcrypt.hash(password, 4) } });
    await deleteOwnAccount({ userId: f.adminUser.id, organizationId: f.org.id, requestId: "synthetic-support-deletion",
      password, confirmation: "DELETE", successorUserId: f.managerUser.id });
    const tombstone = await prisma.user.findUniqueOrThrow({ where: { id: f.adminUser.id } });
    const signed = syntheticAppleTransaction(f.payload);
    const result = await importAppleSupportEvidence(f.scope, signed);
    expect(result.confirmation).toMatchObject({ status: "GRANTED", organizationId: f.org.id });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: tombstone.id } })).toEqual(tombstone);
    expect(await prisma.subscriptionInvoice.count()).toBe(0); expect(await prisma.subscriptionPeriod.count()).toBe(1);
    expect(await prisma.appleTransaction.findFirstOrThrow()).toMatchObject({ currency: "USD", priceMillis: 9990n, organizationId: f.org.id });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "APPLE_SUPPORT_EVIDENCE_APPLY" } });
    expect(audit.actorId).toBe(f.operator.id); expect(JSON.stringify(audit)).not.toContain(signed);
    expect(result.case.payerState).toBe("DEPARTED");
  });

  it("rejects another organization's signed evidence before creating any financial record", async () => {
    const f = await seed(), signed = syntheticAppleTransaction({ ...f.payload, appAccountToken: randomUUID() });
    await expect(importAppleSupportEvidence(f.scope, signed)).rejects.toThrow("appleSupportEvidenceMismatch");
    expect(await prisma.appleTransaction.count()).toBe(0); expect(await prisma.subscriptionPeriod.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "APPLE_SUPPORT_EVIDENCE_APPLY" } })).toBe(0);
  });

  it.each(["DEACTIVATED", "ALLOWLIST_REMOVED"] as const)("rechecks operator permission at financial commit after %s while evidence verification was waiting", async (failure) => {
    const f = await seed(), started = deferred(), release = deferred();
    vi.mocked(verification.verifyAppleTransaction).mockImplementation(async (signed) => {
      started.resolve(); await release.promise; return syntheticAppleVerifier().transaction(signed);
    });
    const pending = importAppleSupportEvidence(f.scope, syntheticAppleTransaction(f.payload));
    const outcome = pending.then((value) => ({ value }), (error: unknown) => ({ error }));
    await started.promise;
    if (failure === "DEACTIVATED") await prisma.user.update({ where: { id: f.operator.id }, data: { isActive: false } });
    else vi.stubEnv("PLATFORM_OWNER_EMAILS", "another-platform-owner@synthetic.invalid");
    release.resolve();
    expect(await outcome).toMatchObject({ error: expect.objectContaining({ message: "forbidden" }) });
    expect(await prisma.appleTransaction.count()).toBe(0); expect(await prisma.subscriptionPeriod.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "APPLE_SUPPORT_EVIDENCE_APPLY" } })).toBe(0);
  });

  it("rechecks only known references and resolves financial review only from a newer verified Apple refund", async () => {
    const f = await seed(), signed = syntheticAppleTransaction({ ...f.payload, quantity: 2, signedDate: Date.now() });
    const first = await importAppleSupportEvidence(f.scope, signed);
    expect(first.confirmation.status).toBe("REVIEW");
    const row = await prisma.appleTransaction.findFirstOrThrow();
    const page = await listAppleSupportCases(f.operator.id, { limit: 1 });
    expect(page.items[0]).toMatchObject({ caseId: `transaction:${row.id}`, state: "FINANCIAL_REVIEW", transaction: { currency: "USD", priceMillis: "9990" } });
    const refund = syntheticAppleTransaction({ ...f.payload, quantity: 2, revocationDate: Date.now(), signedDate: row.lastSignedAt.getTime() + 1000 });
    const read = vi.fn().mockResolvedValue({ signedTransactionInfo: refund });
    vi.spyOn(verification, "appleApiClient").mockReturnValue({ getTransactionInfo: read,
      getAllSubscriptionStatuses: vi.fn().mockResolvedValue({ data: [] }) } as unknown as ReturnType<typeof verification.appleApiClient>);
    expect(await recheckAppleSupportCase({ ...f.scope, caseId: `transaction:${row.id}` })).toMatchObject({ status: "RECHECKED", case: { state: "RESOLVED" } });
    expect(read).toHaveBeenCalledWith(row.transactionId);
    expect((await prisma.appleTransaction.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("REVOKED");
    expect(await prisma.subscriptionPeriod.count()).toBe(0);
  });
});
