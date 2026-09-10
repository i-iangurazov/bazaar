import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { AuditParams } from "./audit";
import { AppError } from "./errors";

type ExecutionContext = {
  executionId: string;
  attemptToken: string;
  organizationId: string;
  actorId: string;
  storeIds: string[];
  roles: readonly string[];
  auditActions: readonly string[];
  reviews?: { entity: string; id: string; updatedAt: string }[];
};
const context = new AsyncLocalStorage<ExecutionContext>();

/** Only a server action adapter may establish this context, never model input. */
export const withBaamExecutionContext = <T>(value: ExecutionContext, run: () => Promise<T>) =>
  context.run(value, run);

/** Used at the start of an existing domain transaction, before reading/editing a reviewed object. */
export async function assertBaamReviewedVersion(
  tx: Prisma.TransactionClient,
  entity: string,
  id: string,
) {
  const current = context.getStore();
  const review = current?.reviews?.find((r) => r.entity === entity && r.id === id);
  if (!review) return;
  // SQL identifiers are server constants, never provider or request input.
  const tables: Record<string, string> = {
    Product: "Product",
    PurchaseOrder: "PurchaseOrder",
    CustomerOrder: "CustomerOrder",
    StockCount: "StockCount",
    SaleReturn: "SaleReturn",
    Customer: "Customer",
    Supplier: "Supplier",
  };
  const table = tables[entity];
  if (!table) throw new AppError("baamActionUnavailable", "BAD_REQUEST", 400);
  const rows = await tx.$queryRawUnsafe<{ updatedAt: Date }[]>(
    `SELECT "updatedAt" FROM "${table}" WHERE "id" = $1 AND "organizationId" = $2 FOR UPDATE`,
    id,
    current!.organizationId,
  );
  if (rows.length !== 1 || rows[0].updatedAt.toISOString() !== review.updatedAt)
    throw new AppError("baamRecordChanged", "CONFLICT", 409);
}

/**
 * The receipt and business changes commit in the SAME existing domain transaction.
 * A concurrent/retried invocation can do provisional work, but cannot commit it:
 * its audit boundary locks this receipt and rolls its whole transaction back.
 * No transaction/client substitution and no provider calls happen here.
 */
export async function recordBaamExecutionReceipt(
  tx: Prisma.TransactionClient | PrismaClient,
  audit: AuditParams,
  auditLogId?: string,
) {
  const current = context.getStore();
  if (!current || !current.auditActions.includes(audit.action)) return;
  if (
    audit.requestId !== current.executionId ||
    audit.actorId !== current.actorId ||
    audit.organizationId !== current.organizationId ||
    "$transaction" in tx
  )
    throw new AppError("baamExecutionBoundary", "CONFLICT", 409);

  const reference = await tx.baamExecution.findUnique({
    where: { id: current.executionId },
    select: { action: { select: { id: true, conversationId: true } } },
  });
  if (!reference) throw new AppError("baamActionNotFound", "NOT_FOUND", 404);
  // Match the claim/change lock order. A reclaimed attempt fences an old worker.
  await tx.$queryRaw`SELECT "id" FROM "BaamConversation" WHERE "id" = ${reference.action.conversationId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "BaamAction" WHERE "id" = ${reference.action.id} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "BaamExecution" WHERE "id" = ${current.executionId} FOR UPDATE`;
  const execution = await tx.baamExecution.findUnique({
    where: { id: current.executionId },
    include: { action: { include: { conversation: true } } },
  });
  if (!execution) throw new AppError("baamActionNotFound", "NOT_FOUND", 404);
  const [transaction] = await tx.$queryRaw<{ id: string }[]>`SELECT txid_current()::text AS id`;
  if (execution.status === "COMMITTED" && execution.transactionId !== transaction.id) {
    throw new AppError("baamExecutionAlreadyCommitted", "CONFLICT", 409);
  }
  const { action } = execution;
  const { conversation } = action;
  if (
    conversation.organizationId !== current.organizationId ||
    conversation.userId !== current.actorId ||
    conversation.deletedAt ||
    action.scopeRevision !== conversation.revision ||
    action.status !== "RUNNING" ||
    action.attemptToken !== current.attemptToken
  )
    throw new AppError("baamScopeChanged", "CONFLICT", 409);

  // Recheck membership at commit, and retain the user lock until commit/rollback.
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${current.actorId} FOR SHARE`;
  const actor = await tx.user.findFirst({
    where: { id: current.actorId, organizationId: current.organizationId, isActive: true },
    select: { role: true, isOrgOwner: true },
  });
  if (!actor || !["ADMIN", "MANAGER"].includes(actor.role) || !current.roles.includes(actor.role)) {
    throw new AppError("forbidden", "FORBIDDEN", 403);
  }
  const storeIds = [...new Set([...current.storeIds, ...conversation.scopeStoreIds])];
  if (actor.role !== "ADMIN" && !actor.isOrgOwner)
    await tx.$queryRaw`SELECT "id" FROM "UserStoreAccess" WHERE "userId" = ${current.actorId} AND "organizationId" = ${current.organizationId} FOR SHARE`;
  if (storeIds.length) {
    const stores = await tx.store.findMany({
      where: {
        id: { in: storeIds },
        organizationId: current.organizationId,
        ...(actor.role === "ADMIN" || actor.isOrgOwner
          ? {}
          : {
              userAccesses: {
                some: { userId: current.actorId, organizationId: current.organizationId },
              },
            }),
      },
      select: { id: true },
    });
    if (stores.length !== storeIds.length)
      throw new AppError("storeAccessDenied", "FORBIDDEN", 403);
  }
  const receipts = Array.isArray(execution.receipts) ? execution.receipts : [];
  const receipt = {
    auditLogId: auditLogId ?? null,
    action: audit.action,
    entity: audit.entity,
    entityId: audit.entityId,
    after: audit.after ?? null,
  };
  const next = JSON.parse(JSON.stringify([...receipts, receipt])) as Prisma.InputJsonValue;
  if (JSON.stringify(next).length > 262144)
    throw new AppError("baamResultTooLarge", "BAD_REQUEST", 400);
  await tx.baamExecution.update({
    where: { id: execution.id },
    data: {
      status: "COMMITTED",
      attemptToken: current.attemptToken,
      transactionId: transaction.id,
      receipts: next,
      committedAt: new Date(),
      errorCode: null,
    },
  });
}
