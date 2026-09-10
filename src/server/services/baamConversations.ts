import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import type { Context } from "@/server/trpc/trpc";
import { AppError } from "./errors";
import { getBaamAccessScope } from "./baamMetrics";
import { baamText, type BaamSend, type BaamPart } from "@/lib/baam/companion";

export const baamJson = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export const baamHash = (value: unknown): string => {
  const stable = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(stable)
      : item && typeof item === "object"
        ? Object.fromEntries(
            Object.entries(item)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, stable(v)]),
          )
        : item;
  return createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
};

export async function baamAccess(ctx: Context, storeId?: string) {
  if (!ctx.user) throw new AppError("unauthorized", "UNAUTHORIZED", 401);
  const scope = await getBaamAccessScope(ctx.user.id, storeId, false);
  if (scope.organizationId !== ctx.user.organizationId)
    throw new AppError("forbidden", "FORBIDDEN", 403);
  return {
    scope,
    ctx: { ...ctx, user: { ...ctx.user, role: scope.role, isOrgOwner: scope.isOrgOwner } },
  };
}
export type BaamAccess = Awaited<ReturnType<typeof baamAccess>>;

export async function ownBaamConversation(ctx: Context, id: string) {
  const access = await baamAccess(ctx);
  const conversation = await prisma.baamConversation.findFirst({
    where: {
      id,
      userId: access.scope.actorId,
      organizationId: access.scope.organizationId,
      deletedAt: null,
    },
  });
  if (!conversation) throw new AppError("baamConversationNotFound", "NOT_FOUND", 404);
  // A removed store grant hides its historical business content as well.
  if (
    (conversation.storeId && !access.scope.storeIds.includes(conversation.storeId)) ||
    conversation.scopeStoreIds.some((id) => !access.scope.storeIds.includes(id))
  ) {
    throw new AppError("storeAccessDenied", "FORBIDDEN", 403);
  }
  return { ...access, conversation };
}

export async function listBaamConversations(ctx: Context, before?: string) {
  const { scope } = await baamAccess(ctx);
  const items = await prisma.baamConversation.findMany({
    where: {
      organizationId: scope.organizationId,
      userId: scope.actorId,
      deletedAt: null,
      OR: [{ storeId: null }, { storeId: { in: scope.storeIds } }],
      ...(before ? { id: { lt: before } } : {}),
    },
    orderBy: { id: "desc" },
    take: 31,
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      storeId: true,
      scopeStoreIds: true,
    },
  });
  return {
    items: items
      .slice(0, 30)
      .filter((item) => item.scopeStoreIds.every((id) => scope.storeIds.includes(id))),
    next: items.length > 30 ? items[29].id : null,
  };
}

export async function createBaamConversation(
  ctx: Context,
  input: { locale: string; storeId?: string },
) {
  const { scope } = await baamAccess(ctx, input.storeId);
  return prisma.baamConversation.create({
    data: {
      organizationId: scope.organizationId,
      userId: scope.actorId,
      storeId: input.storeId,
      scopeStoreIds: scope.storeIds,
      title: baamText(input.locale, "Новый диалог", "New conversation", "Жаңы маек"),
    },
  });
}

export async function readBaamConversation(ctx: Context, id: string, before?: number) {
  const { conversation } = await ownBaamConversation(ctx, id);
  await expireBaamTurn(id);
  const [messages, activeTurn] = await Promise.all([
    prisma.baamMessage.findMany({
      where: { conversationId: id, ...(before ? { sequence: { lt: before } } : {}) },
      orderBy: { sequence: "desc" },
      take: 41,
    }),
    prisma.baamTurn.findFirst({
      where: { conversationId: id, status: "RUNNING" },
      select: { id: true, status: true, cancelRequested: true },
    }),
  ]);
  const actions = await prisma.baamAction.findMany({
    where: {
      conversationId: id,
      OR: [
        { turnId: { in: messages.flatMap((m) => (m.turnId ? [m.turnId] : [])) } },
        { status: { in: ["PROPOSED", "RUNNING", "FAILED", "NEEDS_REVIEW"] } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      status: true,
      summary: true,
      result: true,
      errorCode: true,
      scopeRevision: true,
      turnId: true,
      updatedAt: true,
    },
  });
  return {
    conversation,
    messages: messages.slice(0, 40).reverse(),
    actions: actions.map((action) => ({
      ...action,
      canRecover: action.status === "RUNNING" && action.updatedAt.getTime() < Date.now() - 90_000,
    })),
    activeTurn,
    next: messages.length > 40 ? messages[39].sequence : null,
  };
}

export async function changeBaamConversation(
  ctx: Context,
  input: {
    id: string;
    title?: string;
    storeId?: string | null;
    remove?: boolean;
    revision: number;
  },
) {
  await ownBaamConversation(ctx, input.id);
  if (input.storeId) await baamAccess(ctx, input.storeId);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "BaamConversation" WHERE "id" = ${input.id} FOR UPDATE`;
    const current = await tx.baamConversation.findUniqueOrThrow({ where: { id: input.id } });
    if (current.revision !== input.revision)
      throw new AppError("baamScopeChanged", "CONFLICT", 409);
    if (await tx.baamAction.count({ where: { conversationId: input.id, status: "RUNNING" } })) {
      throw new AppError("baamActionRunning", "CONFLICT", 409);
    }
    const scopeChanged = input.storeId !== undefined && input.storeId !== current.storeId;
    if (scopeChanged || input.remove) {
      await tx.baamTurn.updateMany({
        where: { conversationId: input.id, status: "RUNNING" },
        data: { cancelRequested: true },
      });
      await tx.baamAction.updateMany({
        where: { conversationId: input.id, status: "PROPOSED" },
        data: { status: "CANCELLED" },
      });
    }
    return tx.baamConversation.update({
      where: { id: input.id },
      data: {
        ...(input.title ? { title: input.title } : {}),
        ...(scopeChanged ? { storeId: input.storeId, revision: { increment: 1 } } : {}),
        ...(input.remove ? { deletedAt: new Date(), revision: { increment: 1 } } : {}),
      },
    });
  });
}

export async function appendBaamMessage(
  tx: Prisma.TransactionClient,
  input: {
    conversationId: string;
    turnId?: string;
    role: string;
    text: string;
    parts?: BaamPart[];
  },
) {
  const conversation = await tx.baamConversation.update({
    where: { id: input.conversationId },
    data: { nextSequence: { increment: 1 } },
  });
  return tx.baamMessage.create({
    data: {
      ...input,
      sequence: conversation.nextSequence,
      parts: input.parts ? baamJson(input.parts) : undefined,
    },
  });
}

export async function expireBaamTurn(conversationId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "BaamConversation" WHERE "id" = ${conversationId} FOR UPDATE`;
    const turns = await tx.baamTurn.findMany({
      where: { conversationId, status: "RUNNING", leaseUntil: { lt: new Date() } },
      select: { id: true },
    });
    const expired = await tx.baamTurn.updateMany({
      where: { conversationId, status: "RUNNING", leaseUntil: { lt: new Date() } },
      data: { status: "INTERRUPTED", errorCode: "baamInterrupted", completedAt: new Date() },
    });
    if (expired.count) {
      await tx.baamConversation.update({
        where: { id: conversationId },
        data: { activeTurnId: null },
      });
      await tx.baamAction.updateMany({
        where: { turnId: { in: turns.map((t) => t.id) }, status: "PROPOSED" },
        data: { status: "CANCELLED" },
      });
      for (const turn of turns)
        await appendBaamMessage(tx, {
          conversationId,
          turnId: turn.id,
          role: "error",
          text: "baamInterrupted",
        });
    }
  });
}

export async function claimBaamTurn(ctx: Context, input: BaamSend) {
  const access = await ownBaamConversation(ctx, input.conversationId);
  await expireBaamTurn(input.conversationId);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "BaamConversation" WHERE "id" = ${input.conversationId} FOR UPDATE`;
    const conversation = await tx.baamConversation.findUniqueOrThrow({
      where: { id: input.conversationId },
    });
    const requestHash = baamHash(input);
    const previous = await tx.baamTurn.findUnique({
      where: {
        conversationId_clientRequestId: {
          conversationId: input.conversationId,
          clientRequestId: input.clientRequestId,
        },
      },
    });
    if (previous) {
      if (previous.requestHash !== requestHash)
        throw new AppError("idempotencyConflict", "CONFLICT", 409);
      return { turn: previous, fresh: false, conversation };
    }
    if (conversation.deletedAt || conversation.revision !== input.revision)
      throw new AppError("baamScopeChanged", "CONFLICT", 409);
    if (
      conversation.activeTurnId ||
      (await tx.baamAction.count({ where: { conversationId: conversation.id, status: "RUNNING" } }))
    ) {
      throw new AppError("baamBusy", "CONFLICT", 409);
    }
    const attachments = await tx.baamAttachment.findMany({
      where: { conversationId: conversation.id, id: { in: input.attachmentIds } },
    });
    if (attachments.length !== new Set(input.attachmentIds).size)
      throw new AppError("baamAttachmentNotFound", "NOT_FOUND", 404);
    const voice = input.transcriptionId
      ? await tx.baamTranscription.findFirst({
          where: {
            id: input.transcriptionId,
            conversationId: conversation.id,
            status: "COMPLETED",
          },
        })
      : null;
    if (input.transcriptionId) {
      if (!voice) throw new AppError("baamAudioNotFound", "NOT_FOUND", 404);
      if (voice.usedTurnId) throw new AppError("baamAudioAlreadySent", "CONFLICT", 409);
    }
    // A correction supersedes any unexecuted review. Successful actions stay immutable.
    await tx.baamAction.updateMany({
      where: { conversationId: conversation.id, status: { in: ["PROPOSED", "FAILED"] } },
      data: { status: "SUPERSEDED" },
    });
    const turn = await tx.baamTurn.create({
      data: {
        conversationId: conversation.id,
        clientRequestId: input.clientRequestId,
        requestHash,
        scopeRevision: conversation.revision,
        storeId: conversation.storeId,
        locale: input.locale,
        pageContext: input.page ? baamJson(input.page) : undefined,
        leaseUntil: new Date(Date.now() + 150_000),
      },
    });
    if (input.transcriptionId)
      await tx.baamTranscription.update({
        where: { id: input.transcriptionId },
        data: { usedTurnId: turn.id },
      });
    await tx.baamConversation.update({
      where: { id: conversation.id },
      data: {
        activeTurnId: turn.id,
        scopeStoreIds: [...new Set([...conversation.scopeStoreIds, ...access.scope.storeIds])],
        ...(conversation.nextSequence === 0 ? { title: input.text.slice(0, 70) } : {}),
      },
    });
    await appendBaamMessage(tx, {
      conversationId: conversation.id,
      turnId: turn.id,
      role: "user",
      text: input.text,
      parts: [
        ...attachments.map((a) => ({
          type: "attachment" as const,
          id: a.id,
          name: a.name,
          url: a.url,
        })),
        ...(voice?.text
          ? [{ type: "transcription" as const, id: voice.id, text: voice.text }]
          : []),
      ],
    });
    return { turn, fresh: true, conversation };
  });
}

export async function assertBaamTurnActive(ctx: Context, turnId: string) {
  const turn = await prisma.baamTurn.findUniqueOrThrow({ where: { id: turnId } });
  const access = await ownBaamConversation(ctx, turn.conversationId);
  if (
    turn.status !== "RUNNING" ||
    turn.cancelRequested ||
    turn.leaseUntil < new Date() ||
    turn.scopeRevision !== access.conversation.revision
  ) {
    throw new AppError("baamStopped", "CONFLICT", 409);
  }
  return { ...access, turn };
}

export async function stopBaamTurn(ctx: Context, conversationId: string) {
  await ownBaamConversation(ctx, conversationId);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "BaamConversation" WHERE "id" = ${conversationId} FOR UPDATE`;
    const running = await tx.baamTurn.findMany({ where: { conversationId, status: "RUNNING" } });
    await tx.baamTurn.updateMany({
      where: { conversationId, status: "RUNNING" },
      data: { cancelRequested: true, status: "CANCELLED", completedAt: new Date() },
    });
    await tx.baamConversation.update({
      where: { id: conversationId },
      data: { activeTurnId: null },
    });
    await tx.baamAction.updateMany({
      where: { turnId: { in: running.map((t) => t.id) }, status: "PROPOSED" },
      data: { status: "CANCELLED" },
    });
    for (const turn of running)
      await appendBaamMessage(tx, {
        conversationId,
        turnId: turn.id,
        role: "error",
        text: "baamStopped",
      });
  });
  return { stopped: true };
}
