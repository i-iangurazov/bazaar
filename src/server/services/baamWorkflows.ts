import { captureWorkflowReview } from "./baamWorkflowReview";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/server/db/prisma";
import type { Context } from "@/server/trpc/trpc";
import {
  workflowTitle,
  type WorkflowValues,
  type WorkflowPresentation,
  type WorkflowOperation,
  type workflowSubmitSchema,
} from "@/lib/baam/workflows";
import { ownBaamConversation, baamHash, baamJson, assertBaamTurnActive } from "./baamConversations";
import { baamActions, prepareBusinessAction, businessCaller } from "./baamBusiness";
import { executeBaamAction } from "./baamActions";
import { workflowFields } from "./baamWorkflowCatalog";
import { resolveWorkflowValues } from "./baamWorkflowRecords";
import { AppError } from "./errors";

const conflict = () => new AppError("baamWorkflowChanged", "CONFLICT", 409);
export function cleanWorkflowInput(kind: string, values: WorkflowValues) {
  const result = { ...values };
  if (kind === "pos_create_draft") delete result.storeId;
  for (const key of Object.keys(result))
    if (result[key] === null || result[key] === "") delete result[key];
  return result;
}
export async function createBaamWorkflow(
  ctx: Context,
  turnId: string,
  kind: string,
  parameters: WorkflowValues,
) {
  const access = await assertBaamTurnActive(ctx, turnId);
  const { turn, conversation, scope } = access;
  const def = baamActions[kind];
  if (!def || !def.roles.includes(scope.role))
    throw new AppError("baamActionUnavailable", "FORBIDDEN", 403);
  const fields = workflowFields(kind, turn.locale);
  if (kind === "product_create" && !parameters.imageChoice)
    parameters.imageChoice = parameters.attachmentId ? "attached_photo" : "without_photo";
  const resolved = await resolveWorkflowValues(ctx, {
    conversationId: conversation.id,
    fields,
    parameters,
    locale: turn.locale,
  });
  let presentation: WorkflowPresentation = {
    title: workflowTitle(kind, turn.locale),
    fields,
    labels: resolved.labels,
    choices: resolved.choices,
    errors: {},
  };
  presentation = await captureWorkflowReview(access, kind, resolved.parameters, presentation);
  if (kind.startsWith("pos_") && typeof resolved.parameters.saleId === "string") {
    const fresh = await receiptState(ctx, resolved.parameters.saleId, presentation);
    presentation = fresh.presentation;
    if (kind === "pos_complete" && !resolved.parameters.payments)
      resolved.parameters.payments = [{ amountKgs: Number(fresh.sale.totalKgs) }];
    if (
      ["pos_update_line", "pos_remove_line"].includes(kind) &&
      fresh.sale.lines.length === 1 &&
      !resolved.parameters.lineId
    ) {
      resolved.parameters.lineId = fresh.sale.lines[0].id;
      presentation.labels.lineId = fresh.sale.lines[0].product.name;
      if (kind === "pos_update_line" && resolved.parameters.qty === undefined)
        resolved.parameters.qty = fresh.sale.lines[0].qty;
    }
  }
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "BaamConversation" WHERE "id" = ${conversation.id} FOR UPDATE`;
    const current = await tx.baamConversation.findUniqueOrThrow({ where: { id: conversation.id } });
    const active = await tx.baamTurn.findUniqueOrThrow({ where: { id: turnId } });
    if (
      current.activeTurnId !== turnId ||
      active.cancelRequested ||
      current.revision !== turn.scopeRevision
    )
      throw conflict();
    await tx.baamWorkflow.updateMany({
      where: { conversationId: conversation.id, status: { in: ["EDITING", "FAILED", "RECEIPT"] } },
      data: { status: "SUPERSEDED" },
    });
    const workflow = await tx.baamWorkflow.create({
      data: {
        conversationId: conversation.id,
        turnId,
        kind,
        scopeRevision: conversation.revision,
        parameters: baamJson(resolved.parameters),
        presentation: baamJson(presentation),
      },
    });
    await tx.baamConversation.update({
      where: { id: conversation.id },
      data: { activeWorkflowId: workflow.id },
    });
    return workflow;
  });
}
export async function saveBaamWorkflow(
  ctx: Context,
  input: { id: string; revision: number; parameters: WorkflowValues },
) {
  const wf = await prisma.baamWorkflow.findUnique({ where: { id: input.id } });
  if (!wf) throw conflict();
  const access = await ownBaamConversation(ctx, wf.conversationId);
  const presentation = await captureWorkflowReview(
    access,
    wf.kind,
    input.parameters,
    wf.presentation as unknown as WorkflowPresentation,
  );
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "BaamConversation" WHERE "id" = ${wf.conversationId} FOR UPDATE`;
    const c = await tx.baamConversation.findUniqueOrThrow({ where: { id: wf.conversationId } });
    if (
      c.activeWorkflowId !== wf.id ||
      c.revision !== wf.scopeRevision ||
      c.activeTurnId ||
      c.deletedAt
    )
      throw conflict();
    const changed = await tx.baamWorkflow.updateMany({
      where: {
        id: wf.id,
        revision: input.revision,
        status: { in: ["EDITING", "FAILED", "RECEIPT"] },
        pendingRequestId: null,
      },
      data: {
        parameters: baamJson(input.parameters),
        presentation: baamJson(presentation),
        revision: { increment: 1 },
      },
    });
    if (!changed.count) throw conflict();
    return tx.baamWorkflow.findUniqueOrThrow({ where: { id: wf.id } });
  });
}
export const receiptFingerprint = (sale: {
  status: string;
  isHeld: boolean;
  totalKgs: unknown;
  lines: Array<{
    id: string;
    productId: string;
    variantId: string | null;
    qty: number;
    unitPriceKgs: unknown;
  }>;
}) =>
  baamHash({
    status: sale.status,
    isHeld: sale.isHeld,
    total: String(sale.totalKgs),
    lines: sale.lines
      .map((l) => ({
        id: l.id,
        product: l.productId,
        variant: l.variantId,
        qty: l.qty,
        price: String(l.unitPriceKgs),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
async function receiptState(ctx: Context, saleId: string, presentation: WorkflowPresentation) {
  const sale = await businessCaller(ctx).pos.sales.get({ saleId });
  if (!sale) throw new AppError("posSaleNotFound", "NOT_FOUND", 404);
  return {
    sale,
    presentation: {
      ...presentation,
      totalKgs: Number(sale.totalKgs),
      number: sale.number,
      documentStatus: sale.status,
      isHeld: sale.isHeld,
      saleFingerprint: receiptFingerprint(sale),
      note: sale.lines
        .map(
          (l) =>
            `${l.product.name}${l.variant?.name ? ` · ${l.variant.name}` : ""} — ${l.qty} × ${l.unitPriceKgs} KGS`,
        )
        .join("\n"),
    },
  };
}
export async function submitBaamWorkflow(
  ctx: Context,
  input: z.infer<typeof workflowSubmitSchema>,
) {
  const wf = await prisma.baamWorkflow.findUnique({
    where: { id: input.id },
    include: { turn: true },
  });
  if (!wf) throw conflict();
  const access = await ownBaamConversation(ctx, wf.conversationId);
  const hash = baamHash({
    id: input.id,
    revision: input.revision,
    operation: input.operation,
    parameters: input.parameters,
  });
  const attemptToken = randomUUID();
  const claim = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "BaamConversation" WHERE "id" = ${wf.conversationId} FOR UPDATE`;
    const previous = await tx.baamWorkflowRequest.findUnique({
      where: { id: input.clientRequestId },
    });
    if (previous) {
      if (previous.workflowId !== wf.id || previous.inputHash !== hash)
        throw new AppError("idempotencyConflict", "CONFLICT", 409);
      if (previous.status === "COMPLETED" || (previous.status === "FAILED" && !wf.pendingRequestId))
        return { request: previous, replay: true };
      if (previous.status === "RUNNING" && previous.leaseUntil > new Date())
        return { request: previous, replay: true };
    }
    const current = await tx.baamWorkflow.findUniqueOrThrow({ where: { id: wf.id } });
    const c = await tx.baamConversation.findUniqueOrThrow({ where: { id: wf.conversationId } });
    if (
      c.activeWorkflowId !== wf.id ||
      c.revision !== wf.scopeRevision ||
      c.deletedAt ||
      c.activeTurnId
    )
      throw conflict();
    if (
      !previous &&
      (current.revision !== input.revision ||
        !["EDITING", "FAILED", "RECEIPT"].includes(current.status) ||
        current.pendingRequestId)
    )
      throw conflict();
    if (current.pendingRequestId && current.pendingRequestId !== input.clientRequestId)
      throw conflict();
    if (
      await tx.baamAction.count({
        where: {
          conversationId: wf.conversationId,
          status: "RUNNING",
          ...(previous?.actionId ? { id: { not: previous.actionId } } : {}),
        },
      })
    )
      throw new AppError("baamBusy", "CONFLICT", 409);
    const request = await tx.baamWorkflowRequest.upsert({
      where: { id: input.clientRequestId },
      create: {
        id: input.clientRequestId,
        workflowId: wf.id,
        operation: input.operation,
        inputHash: hash,
        parameters: baamJson(input.parameters),
        attemptToken,
        leaseUntil: new Date(Date.now() + 100000),
      },
      update: {
        status: "RUNNING",
        attemptToken,
        leaseUntil: new Date(Date.now() + 100000),
        errorCode: null,
      },
    });
    await tx.baamWorkflow.update({
      where: { id: wf.id },
      data: {
        status: "RUNNING",
        pendingRequestId: request.id,
        parameters: baamJson(input.parameters),
      },
    });
    return { request, replay: false };
  });
  if (claim.replay) return prisma.baamWorkflow.findUniqueOrThrow({ where: { id: wf.id } });
  let presentation = wf.presentation as unknown as WorkflowPresentation;
  let actionId = claim.request.actionId;
  let resourceId = wf.resourceId;
  let result = wf.result;
  let status = "COMPLETED";
  let parameters = input.parameters;
  try {
    let kind = wf.kind;
    let args = cleanWorkflowInput(kind, parameters);
    if (input.operation === "cancel") {
      if (resourceId && wf.kind === "pos_create_draft")
        throw new AppError("baamUseReceiptCancel", "BAD_REQUEST", 400);
      status = "CANCELLED";
    } else if (input.operation === "refresh" && !wf.kind.startsWith("pos_")) {
      presentation = await captureWorkflowReview(access, wf.kind, parameters, {
        ...presentation,
        reviews: [],
        stockReview: undefined,
      });
      status = "EDITING";
    } else if (input.operation === "refresh") {
      const saleId =
        wf.kind === "pos_create_draft"
          ? resourceId
          : typeof parameters.saleId === "string"
            ? parameters.saleId
            : undefined;
      if (!saleId || !wf.kind.startsWith("pos_")) throw conflict();
      const fresh = await receiptState(access.ctx, saleId, presentation);
      presentation = await captureWorkflowReview(access, wf.kind, parameters, {
        ...fresh.presentation,
        reviews: [],
      });
      status =
        fresh.sale.status === "DRAFT"
          ? wf.kind === "pos_create_draft"
            ? "RECEIPT"
            : "EDITING"
          : "COMPLETED";
    } else {
      if (wf.kind === "pos_create_draft" && resourceId) {
        const map: Partial<Record<WorkflowOperation, string>> = {
          complete: "pos_complete",
          hold: "pos_holdDraft",
          resume: "pos_resumeHeldDraft",
          cancelReceipt: "pos_cancelDraft",
        };
        kind = map[input.operation] ?? "";
        if (!kind) throw conflict();
        if (!actionId) {
          const fresh = await receiptState(access.ctx, resourceId, presentation);
          if (fresh.presentation.saleFingerprint !== presentation.saleFingerprint)
            throw new AppError("baamReceiptChanged", "CONFLICT", 409);
        }
        args = {
          saleId: resourceId,
          ...(input.operation === "complete" ? { payments: parameters.payments ?? [] } : {}),
        };
      } else if (!["execute", "prepare"].includes(input.operation)) throw conflict();
      if (!actionId) {
        if (
          kind.startsWith("pos_") &&
          typeof args.saleId === "string" &&
          presentation.saleFingerprint
        ) {
          const fresh = await receiptState(access.ctx, args.saleId, presentation);
          if (fresh.presentation.saleFingerprint !== presentation.saleFingerprint)
            throw new AppError("baamReceiptChanged", "CONFLICT", 409);
        }
        const prepared = await prepareBusinessAction(access.ctx, {
          tool: kind,
          arguments: args,
          conversationId: wf.conversationId,
          locale: wf.turn.locale,
        });
        prepared.reviews = prepared.reviews?.map(
          (review) =>
            presentation.reviews?.find((r) => r.entity === review.entity && r.id === review.id) ??
            review,
        );
        if (kind === "stock_set" && presentation.stockReview) {
          const data = prepared.input as {
            data: { expectedVersion: number; expectedOnHand: number };
          };
          data.data.expectedVersion = presentation.stockReview.version;
          data.data.expectedOnHand = presentation.stockReview.onHand;
        }
        const created = await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "BaamConversation" WHERE "id" = ${wf.conversationId} FOR UPDATE`;
          const request = await tx.baamWorkflowRequest.findUniqueOrThrow({
            where: { id: input.clientRequestId },
          });
          const c = await tx.baamConversation.findUniqueOrThrow({
            where: { id: wf.conversationId },
          });
          if (
            request.attemptToken !== attemptToken ||
            request.status !== "RUNNING" ||
            c.activeWorkflowId !== wf.id ||
            c.revision !== wf.scopeRevision ||
            c.activeTurnId
          )
            throw conflict();
          const action = await tx.baamAction.create({
            data: {
              conversationId: wf.conversationId,
              turnId: wf.turnId,
              scopeRevision: wf.scopeRevision,
              tool: kind,
              fingerprint: baamHash({ request: request.id, prepared }),
              input: baamJson(prepared),
              summary: baamJson(prepared.summary),
            },
          });
          await tx.baamWorkflowRequest.update({
            where: { id: request.id },
            data: { actionId: action.id },
          });
          return action;
        });
        actionId = created.id;
      }
      const action = await executeBaamAction(access.ctx, actionId);
      if (action.status !== "COMPLETED")
        throw new AppError(action.errorCode ?? "baamExecutionUncertain", "CONFLICT", 409);
      result = action.result;
      const value = action.result as { resourceId?: string } | null;
      resourceId = resourceId ?? value?.resourceId ?? null;
      if (
        wf.kind !== "pos_create_draft" &&
        wf.kind.startsWith("pos_") &&
        wf.kind !== "pos_open_shift" &&
        resourceId
      ) {
        const fresh = await receiptState(access.ctx, resourceId, presentation);
        presentation = fresh.presentation;
      }
      if (wf.kind === "pos_create_draft" && resourceId) {
        const fresh = await receiptState(access.ctx, resourceId, presentation);
        presentation = fresh.presentation;
        status = fresh.sale.status === "DRAFT" ? "RECEIPT" : "COMPLETED";
        if (status === "RECEIPT") {
          presentation.fields = workflowFields("pos_complete", wf.turn.locale).filter(
            (f) => f.key === "payments",
          );
          parameters = {
            ...parameters,
            payments: Array.isArray(parameters.payments)
              ? parameters.payments
              : [{ amountKgs: Number(fresh.sale.totalKgs) }],
          };
        }
      }
    }
    presentation.errors = {};
    return await prisma.$transaction(async (tx) => {
      const won = await tx.baamWorkflowRequest.updateMany({
        where: { id: input.clientRequestId, attemptToken, status: "RUNNING" },
        data: { status: "COMPLETED", result: baamJson(result), errorCode: null },
      });
      if (!won.count) throw conflict();
      return tx.baamWorkflow.update({
        where: { id: wf.id },
        data: {
          status,
          parameters: baamJson(parameters),
          presentation: baamJson(presentation),
          result: result === null ? undefined : baamJson(result),
          resourceId,
          pendingRequestId: null,
          revision: { increment: 1 },
        },
      });
    });
  } catch (error) {
    const errors: Record<string, string> = {};
    if (error instanceof z.ZodError)
      for (const issue of error.issues) errors[issue.path.join(".")] = "baamInvalidField";
    const code =
      error instanceof z.ZodError
        ? "baamCheckFields"
        : error instanceof AppError
          ? error.message
          : "baamActionFailed";
    presentation.errors = errors;
    const action = actionId
      ? await prisma.baamAction.findUnique({ where: { id: actionId } })
      : null;
    const committed = actionId
      ? await prisma.baamExecution.count({ where: { actionId, status: "COMMITTED" } })
      : 0;
    const uncertain = Boolean(
      committed || (action && ["RUNNING", "NEEDS_REVIEW"].includes(action.status)),
    );
    await prisma.$transaction(async (tx) => {
      const won = await tx.baamWorkflowRequest.updateMany({
        where: { id: input.clientRequestId, attemptToken, status: "RUNNING" },
        data: { status: "FAILED", errorCode: code },
      });
      if (!won.count) return;
      await tx.baamWorkflow.update({
        where: { id: wf.id },
        data: {
          status: "FAILED",
          ...(action?.result ? { result: baamJson(action.result) } : {}),
          presentation: baamJson({ ...presentation, errors: { ...errors, _form: code } }),
          pendingRequestId: uncertain ? input.clientRequestId : null,
          ...(!uncertain ? { revision: { increment: 1 } } : {}),
        },
      });
    });
    return prisma.baamWorkflow.findUniqueOrThrow({ where: { id: wf.id } });
  }
}
export async function cancelActiveWorkflow(ctx: Context, conversationId: string) {
  const { conversation } = await ownBaamConversation(ctx, conversationId);
  if (!conversation.activeWorkflowId) return;
  await prisma.baamWorkflow.updateMany({
    where: {
      id: conversation.activeWorkflowId,
      conversationId,
      status: { in: ["EDITING", "FAILED"] },
      pendingRequestId: null,
      resourceId: null,
    },
    data: { status: "CANCELLED", revision: { increment: 1 } },
  });
}

export async function recoverBaamWorkflow(ctx: Context, id: string) {
  const wf = await prisma.baamWorkflow.findUniqueOrThrow({ where: { id } });
  await ownBaamConversation(ctx, wf.conversationId);
  if (!wf.pendingRequestId) return wf;
  const request = await prisma.baamWorkflowRequest.findUniqueOrThrow({
    where: { id: wf.pendingRequestId },
  });
  if (request.workflowId !== wf.id) throw conflict();
  return submitBaamWorkflow(ctx, {
    id: wf.id,
    revision: wf.revision,
    parameters: request.parameters as WorkflowValues,
    clientRequestId: request.id,
    operation: request.operation as WorkflowOperation,
  });
}
