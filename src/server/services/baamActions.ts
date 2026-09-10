import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db/prisma";
import type { Context } from "@/server/trpc/trpc";
import {
  baamActions,
  businessCaller,
  prepareBusinessAction,
  type PreparedAction,
} from "./baamBusiness";
import {
  appendBaamMessage,
  assertBaamTurnActive,
  baamHash,
  baamJson,
  ownBaamConversation,
} from "./baamConversations";
import { withBaamExecutionContext } from "./baamExecutionContext";
import { AppError } from "./errors";
import { baamText } from "@/lib/baam/companion";

export async function proposeBaamAction(ctx: Context, turnId: string, tool: string, args: unknown) {
  const { turn, conversation } = await assertBaamTurnActive(ctx, turnId);
  const prepared = await prepareBusinessAction(ctx, {
    tool,
    arguments: args,
    conversationId: conversation.id,
    locale: turn.locale,
  });
  // Re-check after potentially slow product/media reads.
  await assertBaamTurnActive(ctx, turnId);
  const fingerprint = baamHash({ tool, prepared });
  return prisma.baamAction.upsert({
    where: { turnId_fingerprint: { turnId, fingerprint } },
    update: {},
    create: {
      conversationId: conversation.id,
      turnId,
      tool,
      fingerprint,
      input: baamJson(prepared),
      summary: baamJson(prepared.summary),
      scopeRevision: turn.scopeRevision,
    },
  });
}

export async function cancelBaamAction(ctx: Context, actionId: string) {
  const action = await prisma.baamAction.findUnique({ where: { id: actionId } });
  if (!action) throw new AppError("baamActionNotFound", "NOT_FOUND", 404);
  await ownBaamConversation(ctx, action.conversationId);
  if (await prisma.baamExecution.count({ where: { actionId, status: "COMMITTED" } }))
    throw new AppError("baamPartialAction", "CONFLICT", 409);
  const changed = await prisma.baamAction.updateMany({
    where: { id: actionId, status: { in: ["PROPOSED", "FAILED"] } },
    data: { status: "CANCELLED" },
  });
  if (!changed.count && action.status !== "CANCELLED")
    throw new AppError("baamActionAlreadyStarted", "CONFLICT", 409);
  return { cancelled: true };
}

async function recoverExecution(id: string, actorId: string, organizationId: string) {
  const execution = await prisma.baamExecution.findUniqueOrThrow({ where: { id } });
  if (execution.status !== "COMMITTED")
    throw new AppError("baamExecutionUncertain", "CONFLICT", 409);
  if (execution.output !== null) return execution.output;
  const idem = await prisma.idempotencyKey.findFirst({ where: { key: id, userId: actorId } });
  if (idem?.response !== null && idem?.response !== undefined) return idem.response;
  const operation = await prisma.operationRequest.findFirst({
    where: { organizationId, idempotencyKey: id, status: "COMPLETED" },
  });
  if (
    operation?.response &&
    typeof operation.response === "object" &&
    !Array.isArray(operation.response)
  ) {
    return operation.response.purchaseOrder ?? operation.response.order ?? operation.response;
  }
  const receipts = execution.receipts;
  if (
    Array.isArray(receipts) &&
    receipts[0] &&
    typeof receipts[0] === "object" &&
    !Array.isArray(receipts[0])
  ) {
    return receipts[0].after ?? { id: receipts[0].entityId };
  }
  throw new AppError("baamExecutionUncertain", "CONFLICT", 409);
}

export async function executeBaamAction(ctx: Context, actionId: string) {
  const original = await prisma.baamAction.findUnique({
    where: { id: actionId },
    include: { turn: true },
  });
  if (!original) throw new AppError("baamActionNotFound", "NOT_FOUND", 404);
  const access = await ownBaamConversation(ctx, original.conversationId);
  const definition = baamActions[original.tool];
  if (!definition || !definition.roles.includes(access.scope.role))
    throw new AppError("baamActionUnavailable", "FORBIDDEN", 403);
  if (original.status === "COMPLETED") return original;
  const prepared = original.input as unknown as PreparedAction;
  if (prepared.storeIds.some((id) => !access.scope.storeIds.includes(id)))
    throw new AppError("storeAccessDenied", "FORBIDDEN", 403);
  const attemptToken = randomUUID();
  const claimed = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "BaamConversation" WHERE "id" = ${original.conversationId} FOR UPDATE`;
    const conversation = await tx.baamConversation.findUniqueOrThrow({
      where: { id: original.conversationId },
    });
    if (conversation.deletedAt || conversation.revision !== original.scopeRevision)
      throw new AppError("baamScopeChanged", "CONFLICT", 409);
    if (conversation.activeTurnId) throw new AppError("baamBusy", "CONFLICT", 409);
    const busy = await tx.baamAction.count({
      where: { conversationId: conversation.id, status: "RUNNING", id: { not: actionId } },
    });
    if (busy) throw new AppError("baamBusy", "CONFLICT", 409);
    return tx.baamAction.updateMany({
      where: {
        id: actionId,
        OR: [
          { status: { in: ["PROPOSED", "FAILED"] } },
          { status: "RUNNING", updatedAt: { lt: new Date(Date.now() - 90_000) } },
        ],
      },
      data: { status: "RUNNING", attemptToken, errorCode: null },
    });
  });
  if (!claimed.count) return prisma.baamAction.findUniqueOrThrow({ where: { id: actionId } });
  try {
    const final = await definition.execute(
      {
        ctx: access.ctx,
        locale: original.turn.locale,
        step: async (step, audits, run) => {
          const current = await ownBaamConversation(ctx, original.conversationId);
          if (current.conversation.revision !== original.scopeRevision)
            throw new AppError("baamScopeChanged", "CONFLICT", 409);
          const fingerprint = baamHash({ step, input: prepared.input });
          const execution = await prisma.baamExecution.upsert({
            where: { actionId_step: { actionId, step } },
            update: {},
            create: { actionId, step, fingerprint },
          });
          if (execution.fingerprint !== fingerprint)
            throw new AppError("idempotencyConflict", "CONFLICT", 409);
          if (execution.status === "COMMITTED")
            return recoverExecution(
              execution.id,
              current.scope.actorId,
              current.scope.organizationId,
            );
          try {
            const output = await withBaamExecutionContext(
              {
                executionId: execution.id,
                attemptToken,
                organizationId: current.scope.organizationId,
                actorId: current.scope.actorId,
                storeIds: prepared.storeIds,
                roles: definition.roles,
                auditActions: audits,
                reviews: prepared.reviews,
              },
              () => run(businessCaller({ ...current.ctx, requestId: execution.id }), execution.id),
            );
            const committed = await prisma.baamExecution.findUniqueOrThrow({
              where: { id: execution.id },
            });
            if (committed.status !== "COMMITTED")
              throw new AppError("baamExecutionUncertain", "CONFLICT", 409);
            await prisma.baamExecution.update({
              where: { id: execution.id },
              data: { output: baamJson(output ?? null) },
            });
            return output;
          } catch (error) {
            // A service may have committed before a transport/post-commit hook failed.
            const committed = await prisma.baamExecution.findUniqueOrThrow({
              where: { id: execution.id },
            });
            if (committed.status === "COMMITTED")
              return recoverExecution(
                execution.id,
                current.scope.actorId,
                current.scope.organizationId,
              );
            throw error;
          }
        },
      },
      prepared.input,
    );
    return await prisma.$transaction(async (tx) => {
      const won = await tx.baamAction.updateMany({
        where: { id: actionId, status: "RUNNING", attemptToken },
        data: { status: "COMPLETED", result: baamJson(final), errorCode: null },
      });
      if (won.count && !(await tx.baamWorkflowRequest.count({ where: { actionId } })))
        await appendBaamMessage(tx, {
          conversationId: original.conversationId,
          turnId: original.turnId,
          role: "result",
          text: baamText(original.turn.locale, "Выполнено", "Completed", "Аткарылды"),
          parts: [{ type: "action", actionId }],
        });
      return tx.baamAction.findUniqueOrThrow({ where: { id: actionId } });
    });
  } catch (error) {
    const errorCode =
      error instanceof AppError
        ? error.message
        : error &&
            typeof error === "object" &&
            "message" in error &&
            typeof error.message === "string" &&
            /^[a-zA-Z][a-zA-Z0-9]+$/.test(error.message)
          ? error.message
          : "baamActionFailed";
    const committedSteps = await prisma.baamExecution.findMany({
      where: { actionId, status: "COMMITTED" },
      orderBy: { createdAt: "asc" },
    });
    const first = committedSteps[0]?.receipts;
    const receipt =
      Array.isArray(first) && first[0] && typeof first[0] === "object" && !Array.isArray(first[0])
        ? first[0]
        : null;
    const partial = committedSteps.length
      ? {
          title: baamText(
            original.turn.locale,
            "Часть задачи выполнена",
            "Partially completed",
            "Тапшырма жарым-жартылай аткарылды",
          ),
          details: [
            prepared.summary.title,
            baamText(
              original.turn.locale,
              `Выполнено шагов: ${committedSteps.length}. Они не будут повторены.`,
              `${committedSteps.length} steps completed. They will not be repeated.`,
              `${committedSteps.length} кадам аткарылды. Алар кайталанбайт.`,
            ),
          ],
          href: prepared.summary.href ?? "/inventory",
          resourceId: receipt?.entityId ?? null,
        }
      : undefined;
    await prisma.baamAction.updateMany({
      where: { id: actionId, status: "RUNNING", attemptToken },
      data: {
        status: errorCode === "baamExecutionUncertain" ? "NEEDS_REVIEW" : "FAILED",
        errorCode,
        ...(partial ? { result: baamJson(partial) } : {}),
      },
    });
    throw new AppError(errorCode, "CONFLICT", 409);
  }
}
