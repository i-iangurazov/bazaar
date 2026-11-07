import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { writeAuditLog } from "@/server/services/audit";
import {
  WHATSAPP_OFFER_VERSION,
  WHATSAPP_PACK_MESSAGES,
  WHATSAPP_PACK_PRICE_MINOR,
  whatsappKnowledgeSchema,
  whatsappProfileSchema,
  whatsappRecipientCountry,
  whatsappWindowOpen,
} from "@/lib/whatsapp-ai";
import {
  ensureWhatsAppDraft,
  whatsappAccess,
  whatsappConnection,
  whatsappConversationAccess,
  whatsappOrganizationLock,
  whatsappStores,
  type WhatsAppActor,
} from "./access";
import { decryptWhatsAppSecret, encryptWhatsAppSecret, whatsappConfig } from "./config";
import {
  configureGupshupWebhook,
  createGupshupApp,
  gupshupAppDetails,
  gupshupAppToken,
  gupshupOnboardingLink,
  gupshupWallet,
} from "./gupshup";
import { settleWhatsAppUnit, whatsappQuota } from "./quota";

export async function whatsAppWorkspace(actor: WhatsAppActor, storeId: string) {
  const access = await whatsappConnection(actor, storeId);
  const [quota, worker, store] = await Promise.all([
    whatsappQuota(actor.organizationId),
    prisma.whatsAppWorkerState.findUnique({ where: { id: "worker" } }),
    prisma.store.findFirstOrThrow({
      where: { id: storeId, organizationId: actor.organizationId },
      select: { name: true, currencyCode: true },
    }),
  ]);
  const config = whatsappConfig(),
    c = access.connection;
  const workerReady = Boolean(
    worker?.state === "READY" && Date.now() - worker.heartbeatAt.getTime() < 90000,
  );
  const manualWorkerReady = Boolean(
    worker &&
    ["READY", "MANUAL"].includes(worker.state) &&
    Date.now() - worker.heartbeatAt.getTime() < 90000,
  );
  return {
    entitled: access.entitled,
    active: access.active,
    canConnect: access.user.role === "ADMIN" || access.user.isOrgOwner,
    store,
    connection: c
      ? {
          id: c.id,
          state: c.state,
          mode: c.mode,
          phone: c.phoneNumber,
          aiEnabled: c.aiEnabled,
          configVersion: c.configVersion,
          knowledgePublished: c.knowledgePublished,
          lastIssue: c.lastIssue,
          lastWebhookAt: c.lastWebhookAt,
          lastProviderCheckAt: c.lastProviderCheckAt,
        }
      : null,
    profile: whatsappProfileSchema.parse(c?.profile ?? {}),
    knowledge: whatsappKnowledgeSchema.parse(c?.knowledge ?? { storeName: store.name }),
    readiness: {
      ready: config.ready,
      transportReady: config.transportReady,
      onboardingReady: config.onboardingReady,
      previewReady: Boolean(
        config.deepseekKey &&
        process.env.WHATSAPP_PRIVACY_APPROVED === "1" &&
        process.env.HARDENING_EXTERNAL_PROVIDER_MODE !== "disabled",
      ),
      reasons: config.reasons,
      workerReady,
      manualWorkerReady,
    },
    quota,
    pack: {
      priceMinor: WHATSAPP_PACK_PRICE_MINOR,
      messages: WHATSAPP_PACK_MESSAGES,
      offerVersion: WHATSAPP_OFFER_VERSION,
      paymentsApproved: config.paymentsApproved && config.salesReady,
    },
  };
}

export async function saveWhatsAppProfile(
  actor: WhatsAppActor,
  input: {
    storeId: string;
    expectedVersion: number | null;
    profile: unknown;
    knowledge: unknown;
    knowledgeConfirmed: boolean;
  },
  requestId: string,
) {
  await whatsappAccess(actor, input.storeId, { active: true });
  const profile = whatsappProfileSchema.parse(input.profile),
    knowledge = whatsappKnowledgeSchema.parse(input.knowledge);
  const draft = await ensureWhatsAppDraft(actor, input.storeId);
  return whatsappOrganizationLock(actor.organizationId, async (tx) => {
    const updated = await tx.whatsAppConnection.updateMany({
      where: {
        id: draft.id,
        organizationId: actor.organizationId,
        configVersion: input.expectedVersion ?? 1,
      },
      data: {
        profile,
        knowledge,
        knowledgePublished: input.knowledgeConfirmed,
        ...(input.knowledgeConfirmed ? {} : { aiEnabled: false }),
        configVersion: { increment: 1 },
      },
    });
    if (!updated.count) throw new AppError("whatsappChanged", "CONFLICT", 409);
    await writeAuditLog(tx, {
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: "WHATSAPP_PROFILE_UPDATE",
      entity: "WhatsAppConnection",
      entityId: draft.id,
      requestId,
      after: { knowledgePublished: input.knowledgeConfirmed },
    });
    return { saved: true };
  });
}

export async function beginWhatsAppOnboarding(
  actor: WhatsAppActor,
  storeId: string,
  locale: string,
  requestId: string,
) {
  await whatsappAccess(actor, storeId, { admin: true, active: true });
  const config = whatsappConfig();
  if (!config.onboardingReady) throw new AppError("whatsappNotReady", "CONFLICT", 409);
  let draft = await ensureWhatsAppDraft(actor, storeId);
  if (!draft.providerAppId) {
    const name = `Bazaar${createHash("sha256").update(draft.id).digest("hex").slice(0, 24)}`;
    const claim = await prisma.whatsAppConnection.updateMany({
      where: { id: draft.id, state: { in: ["DRAFT", "DISCONNECTED"] }, providerAppId: null },
      data: { state: "PROVISIONING", providerAppName: name },
    });
    if (!claim.count) throw new AppError("whatsappProvisioningReview", "CONFLICT", 409);
    try {
      const appId = await createGupshupApp(name);
      draft = await prisma.whatsAppConnection.update({
        where: { id: draft.id },
        data: { providerAppId: appId, state: "CONNECTING" },
      });
    } catch {
      // An external app could already exist after a timeout. Do not create more apps.
      await prisma.whatsAppConnection.update({
        where: { id: draft.id },
        data: { state: "PROVISIONING_REVIEW", lastIssue: "whatsappProvisioningReview" },
      });
      throw new AppError("whatsappProvisioningReview", "CONFLICT", 409);
    }
  }
  const state = randomBytes(32).toString("hex");
  const link = await gupshupOnboardingLink(draft.providerAppId!, actor.id, locale);
  await prisma.whatsAppConnection.update({
    where: { id: draft.id },
    data: {
      onboardingStateHash: createHash("sha256").update(`${actor.id}:${state}`).digest("hex"),
      onboardingExpiresAt: new Date(Date.now() + 30 * 60000),
    },
  });
  await writeAuditLog(prisma, {
    organizationId: actor.organizationId,
    actorId: actor.id,
    action: "WHATSAPP_ONBOARDING_START",
    entity: "WhatsAppConnection",
    entityId: draft.id,
    requestId,
  });
  return { link, state };
}

export async function finishWhatsAppOnboarding(
  actor: WhatsAppActor,
  storeId: string,
  state: string,
  requestId: string,
) {
  const { connection: c } = await whatsappConnection(actor, storeId, { admin: true, active: true });
  if (
    !c?.providerAppId ||
    !c.onboardingStateHash ||
    !c.onboardingExpiresAt ||
    c.onboardingExpiresAt < new Date() ||
    c.onboardingStateHash !== createHash("sha256").update(`${actor.id}:${state}`).digest("hex")
  )
    throw new AppError("whatsappOnboardingExpired", "CONFLICT", 409);
  if (!whatsappConfig().onboardingReady) throw new AppError("whatsappNotReady", "CONFLICT", 409);
  const details = await gupshupAppDetails(c.providerAppId);
  if (
    details.id !== c.providerAppId ||
    details.name !== c.providerAppName ||
    !details.live ||
    details.stopped
  )
    throw new AppError("whatsappOnboardingIncomplete", "CONFLICT", 409);
  const phone = details.phone?.replace(/^\+/, "") ?? "";
  if (!whatsappRecipientCountry(phone))
    throw new AppError("whatsappCountryUnsupported", "CONFLICT", 409);
  const appToken = await gupshupAppToken(c.providerAppId);
  const wallet = await gupshupWallet(c.providerAppId, appToken);
  if (wallet.currentBalance <= 0) throw new AppError("whatsappProviderBalance", "CONFLICT", 409);
  const key = c.encryptedWebhookKey
    ? decryptWhatsAppSecret(c.encryptedWebhookKey, c.id)
    : randomBytes(32).toString("hex");
  // Persist before subscription verification can call back; never expose this key to the browser.
  await prisma.whatsAppConnection.update({
    where: { id: c.id },
    data: { encryptedWebhookKey: encryptWhatsAppSecret(key, c.id) },
  });
  await configureGupshupWebhook(c.providerAppId, appToken, c.id, key);
  const update = await prisma.whatsAppConnection.updateMany({
    where: { id: c.id, onboardingStateHash: c.onboardingStateHash },
    data: {
      encryptedAppToken: encryptWhatsAppSecret(appToken, c.id),
      phoneNumber: phone,
      phoneNumberId: details.phoneNumberId ?? null,
      messagingAccountId: details.wabaId ?? null,
      state: "CONNECTED",
      aiEnabled: false,
      onboardingStateHash: null,
      onboardingExpiresAt: null,
      lastProviderCheckAt: new Date(),
      lastIssue: null,
      configVersion: { increment: 1 },
    },
  });
  if (!update.count) throw new AppError("whatsappChanged", "CONFLICT", 409);
  await writeAuditLog(prisma, {
    organizationId: actor.organizationId,
    actorId: actor.id,
    action: "WHATSAPP_CONNECTED",
    entity: "WhatsAppConnection",
    entityId: c.id,
    requestId,
  });
  return { connected: true };
}

export async function setWhatsAppEnabled(
  actor: WhatsAppActor,
  storeId: string,
  enabled: boolean,
  requestId: string,
) {
  const { connection: c } = await whatsappConnection(actor, storeId, { active: enabled });
  if (!c) throw new AppError("recordNotFound", "NOT_FOUND", 404);
  if (enabled) {
    const workspace = await whatsAppWorkspace(actor, storeId);
    if (
      !workspace.readiness.ready ||
      !workspace.readiness.workerReady ||
      c.state !== "CONNECTED" ||
      !c.knowledgePublished ||
      !c.lastWebhookAt
    )
      throw new AppError("whatsappNotReady", "CONFLICT", 409);
    if (!workspace.quota.remaining) throw new AppError("whatsappQuotaExhausted", "CONFLICT", 409);
  }
  await prisma.whatsAppConnection.update({
    where: { id: c.id },
    data: { aiEnabled: enabled, configVersion: { increment: 1 } },
  });
  if (!enabled)
    await cancelWhatsAppPrepared({ conversation: { connectionId: c.id }, actorId: null });
  await writeAuditLog(prisma, {
    organizationId: actor.organizationId,
    actorId: actor.id,
    action: enabled ? "WHATSAPP_AI_ENABLE" : "WHATSAPP_AI_DISABLE",
    entity: "WhatsAppConnection",
    entityId: c.id,
    requestId,
  });
  return { enabled };
}

export async function cancelWhatsAppPrepared(where: Prisma.WhatsAppMessageWhereInput) {
  const messages = await prisma.whatsAppMessage.findMany({
    where: { ...where, direction: "OUTBOUND", state: { in: ["PREPARED", "QUEUED"] } },
    select: { id: true, organizationId: true },
  });
  for (const message of messages) {
    const cancelled = await prisma.whatsAppMessage.updateMany({
      where: { id: message.id, state: { in: ["PREPARED", "QUEUED"] } },
      data: { state: "CANCELLED" },
    });
    if (cancelled.count) await settleWhatsAppUnit(message.organizationId, message.id, false);
  }
}

export async function listWhatsAppConversations(
  actor: WhatsAppActor,
  input: {
    storeId: string;
    search?: string;
    filter: "all" | "human" | "unread" | "archived";
    cursor?: string;
  },
) {
  await whatsappAccess(actor, input.storeId);
  const where: Prisma.WhatsAppConversationWhereInput = {
    organizationId: actor.organizationId,
    storeId: input.storeId,
    archived: input.filter === "archived",
    ...(input.filter === "human" ? { needsHuman: true } : {}),
    ...(input.search
      ? {
          OR: [
            { customerName: { contains: input.search, mode: "insensitive" } },
            { phone: { contains: input.search } },
          ],
        }
      : {}),
  };
  let cursorRow: { lastMessageAt: Date; id: string } | null = null;
  if (input.cursor) {
    const cursor = await prisma.whatsAppConversation.findFirst({
      where: { ...where, id: input.cursor },
      select: { lastMessageAt: true, id: true },
    });
    if (!cursor) throw new AppError("recordNotFound", "NOT_FOUND", 404);
    cursorRow = cursor;
    where.AND = [
      {
        OR: [
          { lastMessageAt: { lt: cursor.lastMessageAt } },
          { lastMessageAt: cursor.lastMessageAt, id: { lt: cursor.id } },
        ],
      },
    ];
  }
  if (input.filter === "unread") {
    const unread = await prisma.$queryRaw<
      { id: string }[]
    >`SELECT c.id FROM "WhatsAppConversation" c
      LEFT JOIN "WhatsAppReadCursor" r ON r."conversationId" = c.id AND r."userId" = ${actor.id}
      WHERE c."organizationId" = ${actor.organizationId} AND c."storeId" = ${input.storeId}
        AND NOT c.archived AND c."inboundSequence" > COALESCE(r."inboundSequence", 0)
        ${input.search ? Prisma.sql`AND (strpos(lower(COALESCE(c."customerName", '')), lower(${input.search})) > 0 OR strpos(COALESCE(c.phone, ''), ${input.search}) > 0)` : Prisma.empty}
        ${cursorRow ? Prisma.sql`AND (c."lastMessageAt", c.id) < (${cursorRow.lastMessageAt}, ${cursorRow.id})` : Prisma.empty}
      ORDER BY c."lastMessageAt" DESC, c.id DESC LIMIT 51`;
    where.id = { in: unread.map((row) => row.id) };
  }
  const rows = await prisma.whatsAppConversation.findMany({
    where,
    orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
    take: 51,
    include: {
      readCursors: { where: { userId: actor.id } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, kind: true } },
    },
  });
  const items = rows
    .slice(0, 50)
    .map((row) => ({
      id: row.id,
      name: row.customerName,
      phone: row.phone,
      mode: row.mode,
      needsHuman: row.needsHuman,
      unread: row.inboundSequence > (row.readCursors[0]?.inboundSequence ?? 0),
      archived: row.archived,
      lastMessageAt: row.lastMessageAt,
      preview: row.messages[0]?.body.slice(0, 160) ?? "",
      kind: row.messages[0]?.kind ?? null,
    }));
  return { items, nextCursor: rows.length > 50 ? rows[49].id : null };
}

export async function readWhatsAppConversation(actor: WhatsAppActor, conversationId: string) {
  const conversation = await whatsappConversationAccess(actor, conversationId);
  const messages = await prisma.whatsAppMessage.findMany({
    where: { conversationId, organizationId: actor.organizationId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
    select: {
      id: true,
      direction: true,
      kind: true,
      body: true,
      state: true,
      inboundSequence: true,
      actorId: true,
      createdAt: true,
      lastIssue: true,
    },
  });
  return {
    id: conversation.id,
    name: conversation.customerName,
    phone: conversation.phone,
    mode: conversation.mode,
    needsHuman: conversation.needsHuman,
    lastIssue: conversation.lastIssue,
    archived: conversation.archived,
    version: conversation.generationVersion,
    inboundSequence: conversation.inboundSequence,
    windowOpen: whatsappWindowOpen(conversation.lastInboundAt),
    countrySupported: conversation.buyerCountry === "KG",
    messages: messages.reverse(),
  };
}

export async function markWhatsAppSeen(
  actor: WhatsAppActor,
  conversationId: string,
  sequence: number,
) {
  const c = await whatsappConversationAccess(actor, conversationId);
  const seen = Math.min(c.inboundSequence, sequence);
  await prisma.whatsAppReadCursor.upsert({
    where: { conversationId_userId: { conversationId, userId: actor.id } },
    create: {
      conversationId,
      organizationId: c.organizationId,
      storeId: c.storeId,
      userId: actor.id,
      inboundSequence: seen,
    },
    update: {},
  });
  await prisma.whatsAppReadCursor.updateMany({
    where: { conversationId, userId: actor.id, inboundSequence: { lt: seen } },
    data: { inboundSequence: seen },
  });
  // This cursor never sends Meta read receipts or typing indicators.
  return { seen: true };
}

export async function setWhatsAppConversationMode(
  actor: WhatsAppActor,
  conversationId: string,
  mode: "AI" | "HUMAN",
  expectedVersion: number,
  requestId: string,
) {
  const c = await whatsappConversationAccess(actor, conversationId, { active: mode === "AI" });
  if (mode === "AI") {
    const w = await whatsAppWorkspace(actor, c.storeId);
    if (
      !w.connection?.aiEnabled ||
      !w.readiness.ready ||
      !w.readiness.workerReady ||
      !w.quota.remaining
    )
      throw new AppError("whatsappNotReady", "CONFLICT", 409);
  }
  const result = await prisma.whatsAppConversation.updateMany({
    where: { id: c.id, organizationId: actor.organizationId, generationVersion: expectedVersion },
    data: { mode, needsHuman: mode === "HUMAN", generationVersion: { increment: 1 } },
  });
  if (!result.count) throw new AppError("whatsappChanged", "CONFLICT", 409);
  await cancelWhatsAppPrepared({ conversationId: c.id });
  await writeAuditLog(prisma, {
    organizationId: actor.organizationId,
    actorId: actor.id,
    action: `WHATSAPP_${mode}`,
    entity: "WhatsAppConversation",
    entityId: c.id,
    requestId,
  });
  return { mode };
}

export async function archiveWhatsAppConversation(
  actor: WhatsAppActor,
  conversationId: string,
  archived: boolean,
  requestId: string,
) {
  const c = await whatsappConversationAccess(actor, conversationId);
  await prisma.whatsAppConversation.update({
    where: { id: c.id },
    data: { archived, ...(archived ? { mode: "HUMAN", generationVersion: { increment: 1 } } : {}) },
  });
  if (archived) await cancelWhatsAppPrepared({ conversationId: c.id });
  await writeAuditLog(prisma, {
    organizationId: actor.organizationId,
    actorId: actor.id,
    action: archived ? "WHATSAPP_ARCHIVE" : "WHATSAPP_UNARCHIVE",
    entity: "WhatsAppConversation",
    entityId: c.id,
    requestId,
  });
  return { archived };
}

export async function queueWhatsAppManual(
  actor: WhatsAppActor,
  input: { conversationId: string; body: string; idempotencyKey: string },
  requestId: string,
) {
  const c = await whatsappConversationAccess(actor, input.conversationId, { active: true });
  if (!whatsappConfig().transportReady) throw new AppError("whatsappNotReady", "CONFLICT", 409);
  if (!whatsappWindowOpen(c.lastInboundAt))
    throw new AppError("whatsappWindowClosed", "CONFLICT", 409);
  if (c.buyerCountry !== "KG") throw new AppError("whatsappCountryUnsupported", "CONFLICT", 409);
  const body = input.body.trim();
  if (!body || body.length > 4096) throw new AppError("whatsappInvalidMessage", "BAD_REQUEST", 400);
  const eventKey = `manual:${actor.organizationId}:${input.idempotencyKey}`;
  const message = await whatsappOrganizationLock(actor.organizationId, async (tx) => {
    const existing = await tx.whatsAppMessage.findUnique({ where: { providerEventKey: eventKey } });
    if (existing) {
      if (existing.conversationId !== c.id || existing.body !== body)
        throw new AppError("whatsappChanged", "CONFLICT", 409);
      return existing;
    }
    const connection = await tx.whatsAppConnection.findFirst({
      where: { id: c.connectionId, organizationId: actor.organizationId, state: "CONNECTED" },
    });
    if (!connection) throw new AppError("whatsappReconnectRequired", "CONFLICT", 409);
    const previous = await tx.whatsAppConversation.findUniqueOrThrow({ where: { id: c.id } });
    const current = await tx.whatsAppConversation.update({
      where: { id: c.id },
      data: {
        mode: "HUMAN",
        needsHuman: false,
        lastIssue: null,
        ...(previous.mode === "AI" ? { generationVersion: { increment: 1 } } : {}),
        lastMessageAt: new Date(),
      },
    });
    const result = await tx.whatsAppMessage.create({
      data: {
        organizationId: actor.organizationId,
        storeId: c.storeId,
        conversationId: c.id,
        direction: "OUTBOUND",
        kind: "TEXT",
        body,
        state: "PREPARED",
        providerEventKey: eventKey,
        actorId: actor.id,
        generationVersion: current.generationVersion,
        configVersion: connection.configVersion,
      },
    });
    await writeAuditLog(tx, {
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: "WHATSAPP_MANUAL_QUEUE",
      entity: "WhatsAppMessage",
      entityId: result.id,
      requestId,
    });
    return result;
  });
  await cancelWhatsAppPrepared({ conversationId: c.id, actorId: null, id: { not: message.id } });
  return { id: message.id, state: message.state };
}

export async function eraseWhatsAppConversation(
  actor: WhatsAppActor,
  conversationId: string,
  requestId: string,
) {
  const c = await whatsappConversationAccess(actor, conversationId);
  await whatsappAccess(actor, c.storeId, { admin: true });
  await whatsappOrganizationLock(actor.organizationId, async (tx) => {
    if (
      await tx.whatsAppMessage.count({
        where: {
          conversationId,
          state: { in: ["SENDING", "PROCESSING"] },
          leaseUntil: { gt: new Date() },
        },
      })
    )
      throw new AppError("whatsappProviderBusy", "CONFLICT", 409);
    await tx.whatsAppConversation.update({
      where: { id: c.id },
      data: {
        externalIdentity: `erased:${randomBytes(24).toString("hex")}`,
        phone: null,
        bsuid: null,
        buyerCountry: null,
        customerName: null,
        mode: "HUMAN",
        needsHuman: false,
        archived: true,
        redactedAt: new Date(),
        lastInboundAt: null,
        generationVersion: { increment: 1 },
      },
    });
    await tx.whatsAppMessage.updateMany({
      where: { conversationId },
      data: { body: "", media: Prisma.DbNull, facts: Prisma.DbNull },
    });
    await writeAuditLog(tx, {
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: "WHATSAPP_ERASE",
      entity: "WhatsAppConversation",
      entityId: c.id,
      requestId,
    });
  });
  await cancelWhatsAppPrepared({ conversationId: c.id });
  return { erased: true };
}

export { whatsappStores };
