import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { assertAppleSupportOperator, type AppleSupportOperator } from "./appleSupportAuth";
import { appleApiClient, appleReceiptVerifier, verifyAppleTransaction, type VerifiedAppleTransaction } from "./appleVerification";
import { applyAppleTransaction } from "./applePayments";
import { applyAppleSignedRenewal } from "./appleLifecycle";
import { readAppleDeferredSource } from "./appleDeferredEvidence";

export const appleSupportCaseIdSchema = z.string().regex(/^(intent|transaction):[A-Za-z0-9_-]{1,80}$/);
export const appleSupportListInputSchema = z.object({ organizationId: z.string().min(1).max(80).optional(), cursor: z.string().max(500).optional(),
  limit: z.number().int().min(1).max(50).default(20) }).strict();
const intentInclude = { organization: { select: { id: true, name: true } }, transactions: { orderBy: { purchaseDate: "desc" as const }, take: 1 }, chains: true } satisfies Prisma.ApplePurchaseIntentInclude;
const transactionInclude = { organization: { select: { id: true, name: true } }, intent: true } satisfies Prisma.AppleTransactionInclude;
type Case = { kind: "intent"; row: Prisma.ApplePurchaseIntentGetPayload<{ include: typeof intentInclude }> } |
  { kind: "transaction"; row: Prisma.AppleTransactionGetPayload<{ include: typeof transactionInclude }> };
export type AppleSupportCase = {
  caseId: string; organization: { id: string; name: string }; state: "NATIVE_PENDING" | "FINANCIAL_REVIEW" | "RESOLVED";
  productId: string; environment: string; createdAt: string; reason: string | null;
  payerState: "ACTIVE_ADMIN" | "DEPARTED" | "SYSTEM" | "UNKNOWN"; completionCapability: boolean; hasAppleReference: boolean;
  transaction: null | { transactionId: string; originalTransactionId: string; status: string; currency: string | null; priceMillis: string | null };
};
async function loadCase(db: Prisma.TransactionClient, caseId: string): Promise<Case> {
  const [kind, id] = appleSupportCaseIdSchema.parse(caseId).split(":");
  if (kind === "intent") {
    const row = await db.applePurchaseIntent.findUnique({ where: { id }, include: intentInclude });
    if (row) return { kind: "intent", row };
  } else {
    const row = await db.appleTransaction.findUnique({ where: { id }, include: transactionInclude });
    if (row) return { kind: "transaction", row };
  }
  throw new AppError("appleSupportCaseNotFound", "NOT_FOUND", 404);
}
function references(item: Case) {
  if (item.kind === "transaction") return { token: item.row.appAccountToken, environment: item.row.environment,
    transactions: [item.row.transactionId], originals: item.row.productType === "AUTO_RENEWABLE" ? [item.row.originalTransactionId] : [] };
  const source = readAppleDeferredSource(item.row.offerSnapshot);
  return { token: item.row.purchaseAppAccountToken ?? item.row.appAccountToken, environment: item.row.environment,
    transactions: [...new Set([...item.row.transactions.map((v) => v.transactionId), ...(source ? [source.transactionId] : [])])],
    originals: [...new Set([...item.row.chains.map((v) => v.originalTransactionId), ...(source ? [source.originalTransactionId] : [])])] };
}
async function present(db: Prisma.TransactionClient, item: Case): Promise<AppleSupportCase> {
  const intent = item.kind === "intent" ? item.row : item.row.intent;
  const payer = intent ? await db.user.findUnique({ where: { id: intent.createdById }, select: { role: true, organizationId: true, deletedAt: true, isActive: true } }) : null;
  const transaction = item.kind === "transaction" ? item.row : item.row.transactions[0] ?? null;
  const refs = references(item);
  return { caseId: `${item.kind}:${item.row.id}`, organization: item.row.organization,
    state: transaction?.status === "REVIEW" ? "FINANCIAL_REVIEW" : item.kind === "intent" && ["PENDING", "REVIEW"].includes(item.row.status) ? "NATIVE_PENDING" : "RESOLVED",
    productId: item.row.productId, environment: item.row.environment, createdAt: item.row.createdAt.toISOString(), reason: item.row.lastIssue,
    payerState: intent?.createdById === "APPLE_SUBSCRIPTION_MANAGEMENT" ? "SYSTEM" : !payer ? "UNKNOWN" :
      payer && payer.organizationId === item.row.organizationId && payer.role === "ADMIN" && payer.isActive && !payer.deletedAt ? "ACTIVE_ADMIN" : "DEPARTED",
    completionCapability: Boolean(intent?.completionKeyFingerprint), hasAppleReference: Boolean(refs.transactions.length || refs.originals.length),
    transaction: transaction ? { transactionId: transaction.transactionId, originalTransactionId: transaction.originalTransactionId,
      status: transaction.status, currency: transaction.currency, priceMillis: transaction.priceMillis?.toString() ?? null } : null };
}
async function authorizedCase(actorId: string, caseId: string) {
  return prisma.$transaction(async (db) => { await assertAppleSupportOperator(actorId, db); return loadCase(db, caseId); });
}
export async function getAppleSupportCase(actorId: string, caseId: string) {
  return prisma.$transaction(async (db) => { await assertAppleSupportOperator(actorId, db); return present(db, await loadCase(db, caseId)); });
}
const cursorSchema = z.object({ at: z.string().datetime(), kind: z.enum(["intent", "transaction"]), id: z.string().min(1).max(80) }).strict();
export async function listAppleSupportCases(actorId: string, raw: z.infer<typeof appleSupportListInputSchema>) {
  const input = appleSupportListInputSchema.parse(raw);
  let cursor: z.infer<typeof cursorSchema> | null = null;
  if (input.cursor) { try { cursor = cursorSchema.parse(JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8"))); }
    catch { throw new AppError("appleSupportCaseNotFound", "BAD_REQUEST", 400); } }
  const boundary = (kind: "intent" | "transaction") => !cursor ? {} : { OR: [{ createdAt: { lt: new Date(cursor.at) } },
    ...(kind < cursor.kind ? [{ createdAt: new Date(cursor.at) }] : kind === cursor.kind ? [{ createdAt: new Date(cursor.at), id: { lt: cursor.id } }] : [])] };
  return prisma.$transaction(async (db) => {
    await assertAppleSupportOperator(actorId, db);
    const [intents, transactions] = await Promise.all([
      db.applePurchaseIntent.findMany({ where: { organizationId: input.organizationId, authorizedAt: { not: null }, status: { in: ["PENDING", "REVIEW"] },
        transactions: { none: {} }, ...boundary("intent") }, include: intentInclude, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: input.limit + 1 }),
      db.appleTransaction.findMany({ where: { organizationId: input.organizationId, status: "REVIEW", ...boundary("transaction") },
        include: transactionInclude, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: input.limit + 1 }),
    ]);
    const all: Case[] = [...intents.map((row) => ({ kind: "intent" as const, row })), ...transactions.map((row) => ({ kind: "transaction" as const, row }))];
    all.sort((a, b) => b.row.createdAt.getTime() - a.row.createdAt.getTime() || b.kind.localeCompare(a.kind) || b.row.id.localeCompare(a.row.id));
    const page = all.slice(0, input.limit), last = page.at(-1);
    return { items: await Promise.all(page.map((item) => present(db, item))), nextCursor: all.length > input.limit && last
      ? Buffer.from(JSON.stringify({ at: last.row.createdAt.toISOString(), kind: last.kind, id: last.row.id })).toString("base64url") : null };
  });
}
function assertReceiptMatchesCase(item: Case, receipt: VerifiedAppleTransaction) {
  const refs = references(item), d = receipt.data;
  if (d.appAccountToken !== refs.token || d.environment !== refs.environment || (item.kind === "transaction" && d.transactionId !== item.row.transactionId))
    throw new AppError("appleSupportEvidenceMismatch", "CONFLICT", 409);
}
export async function importAppleSupportEvidence(operator: AppleSupportOperator, signedTransactionInfo: string) {
  const item = await authorizedCase(operator.id, operator.caseId), receipt = await verifyAppleTransaction(signedTransactionInfo);
  assertReceiptMatchesCase(item, receipt);
  const result = await applyAppleTransaction(receipt, { organizationId: item.row.organizationId,
    ...(item.kind === "intent" ? { intentId: item.row.id } : {}), source: "RECONCILIATION", operator });
  return { confirmation: result, case: await getAppleSupportCase(operator.id, operator.caseId) };
}
/** Recheck only the selected known references. No reference/empty response is
 * evidence of absence; the periodic job remains the full-history recovery path. */
export async function recheckAppleSupportCase(operator: AppleSupportOperator) {
  const item = await authorizedCase(operator.id, operator.caseId), refs = references(item);
  if (!refs.transactions.length && !refs.originals.length) return { status: "NO_APPLE_REFERENCE" as const, checkedReferences: 0, case: await getAppleSupportCase(operator.id, operator.caseId) };
  const api = appleApiClient(refs.environment), verifier = appleReceiptVerifier(refs.environment as "Production" | "Sandbox");
  let checkedReferences = 0;
  for (const transactionId of refs.transactions) {
    const response = await api.getTransactionInfo(transactionId);
    if (!response.signedTransactionInfo) throw new AppError("appleReconciliationUnavailable", "CONFLICT", 409);
    const receipt = await verifier.transaction(response.signedTransactionInfo);
    assertReceiptMatchesCase(item, receipt);
    await applyAppleTransaction(receipt, { organizationId: item.row.organizationId, source: "RECONCILIATION", operator });
    checkedReferences++;
  }
  for (const original of refs.originals) {
    const status = await api.getAllSubscriptionStatuses(original);
    for (const group of status.data ?? []) for (const current of group.lastTransactions ?? []) {
      if (current.originalTransactionId && current.originalTransactionId !== original) continue;
      if (current.signedTransactionInfo) {
        const receipt = await verifier.transaction(current.signedTransactionInfo);
        if (receipt.data.originalTransactionId !== original || receipt.data.appAccountToken !== refs.token) continue;
        await applyAppleTransaction(receipt, { organizationId: item.row.organizationId, source: "RECONCILIATION", operator });
      }
      if (current.signedRenewalInfo) {
        const renewal = await verifier.renewal(current.signedRenewalInfo);
        if (renewal.originalTransactionId !== original || (renewal.appAccountToken && renewal.appAccountToken.toLowerCase() !== refs.token)) continue;
        await applyAppleSignedRenewal(current.signedRenewalInfo, verifier, operator);
      }
    }
    checkedReferences++;
  }
  return { status: "RECHECKED" as const, checkedReferences, case: await getAppleSupportCase(operator.id, operator.caseId) };
}
