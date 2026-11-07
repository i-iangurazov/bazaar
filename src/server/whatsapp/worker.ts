import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import {
  getOrganizationPlan,
  hasActivePaidOrApprovedSubscription,
} from "@/server/services/planLimits";
import {
  whatsappKnowledgeSchema,
  whatsappProfileSchema,
  whatsappWindowOpen,
} from "@/lib/whatsapp-ai";
import { whatsappOrganizationLock } from "./access";
import { generateWhatsAppAnswer, whatsAppHeartbeat } from "./assistant";
import { renderWhatsAppAnswer, whatsappAnswerSchema } from "./answer";
import { refreshWhatsAppOffers } from "./catalog";
import { decryptWhatsAppSecret, whatsappConfig } from "./config";
import { sendGupshupText, WhatsAppUnknownSend } from "./gupshup";
import { whatsappImage } from "./media";
import {
  assertWhatsAppReservedUnitCanSend,
  recordWhatsAppEstimate,
  reserveWhatsAppUnit,
  settleWhatsAppUnit,
  whatsappQuota,
} from "./quota";

const factsSchema = z.object({
  answer: whatsappAnswerSchema,
  firstReply: z.boolean(),
  handoff: z.boolean(),
});
const errorKey = (error: unknown) =>
  error instanceof AppError ? error.message : "whatsappAiUnavailable";

async function needsHuman(conversationId: string, issue: string, generationVersion?: number) {
  await prisma.whatsAppConversation.updateMany({
    where: {
      id: conversationId,
      ...(generationVersion === undefined ? {} : { generationVersion }),
    },
    data: {
      mode: "HUMAN",
      needsHuman: true,
      lastIssue: issue,
      generationVersion: { increment: 1 },
    },
  });
}

async function processIncoming(id: string) {
  const seed = await prisma.whatsAppMessage.findUnique({
    where: { id },
    include: { conversation: { include: { connection: true } } },
  });
  if (!seed) return;
  const token = randomUUID();
  const claimed = await whatsappOrganizationLock(seed.organizationId, async (tx) => {
    const message = await tx.whatsAppMessage.findUnique({
      where: { id },
      include: { conversation: { include: { connection: true } } },
    });
    if (!message || message.state !== "RECEIVED" || message.nextAttemptAt > new Date()) return null;
    const c = message.conversation,
      connection = c.connection;
    const busy = await tx.whatsAppMessage.count({
      where: { conversationId: c.id, state: "PROCESSING", leaseUntil: { gt: new Date() } },
    });
    if (busy) return null;
    if (
      c.mode !== "AI" ||
      !connection.aiEnabled ||
      connection.state !== "CONNECTED" ||
      !connection.knowledgePublished ||
      !whatsappWindowOpen(c.lastInboundAt) ||
      c.buyerCountry !== "KG"
    ) {
      await tx.whatsAppMessage.update({
        where: { id },
        data: { state: "HUMAN", lastIssue: "whatsappHumanRequired" },
      });
      await tx.whatsAppConversation.update({ where: { id: c.id }, data: { needsHuman: true } });
      return null;
    }
    const org = await getOrganizationPlan(message.organizationId, tx);
    if (
      (org.plan === "STARTER" && !org.lifetimeAccess) ||
      !hasActivePaidOrApprovedSubscription(org)
    ) {
      await tx.whatsAppMessage.update({
        where: { id },
        data: { state: "HUMAN", lastIssue: "whatsappPlanRequired" },
      });
      await tx.whatsAppConversation.update({
        where: { id: c.id },
        data: { needsHuman: true, lastIssue: "whatsappPlanRequired" },
      });
      return null;
    }
    // New short messages supersede older waiting jobs, while all text remains in history.
    const latest = await tx.whatsAppMessage.findFirst({
      where: { conversationId: c.id, state: "RECEIVED", direction: "INBOUND" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    if (latest && latest.id !== message.id) {
      await tx.whatsAppMessage.update({ where: { id }, data: { state: "COALESCED" } });
      return null;
    }
    const changed = await tx.whatsAppMessage.updateMany({
      where: { id, state: "RECEIVED" },
      data: {
        state: "PROCESSING",
        leaseToken: token,
        leaseUntil: new Date(Date.now() + 120000),
        attempts: { increment: 1 },
      },
    });
    return changed.count ? { message, conversation: c, connection } : null;
  });
  if (!claimed) return;
  try {
    if (!whatsappConfig().ready) throw new AppError("whatsappAiUnavailable", "CONFLICT", 409);
    const quota = await whatsappQuota(seed.organizationId);
    if (!quota.active || !quota.remaining)
      throw new AppError("whatsappQuotaExhausted", "CONFLICT", 409);
    const image =
      seed.kind === "IMAGE"
        ? `data:image/jpeg;base64,${(await whatsappImage(id)).toString("base64")}`
        : undefined;
    const firstReply =
      (await prisma.whatsAppMessage.count({
        where: {
          conversationId: seed.conversationId,
          direction: "OUTBOUND",
          actorId: null,
          state: { in: ["SENT", "DELIVERED", "READ"] },
        },
      })) === 0;
    const result = await generateWhatsAppAnswer({
      organizationId: seed.organizationId,
      storeId: seed.storeId,
      conversationId: seed.conversationId,
      incomingMessageId: id,
      incoming: seed.body,
      profile: claimed.connection.profile,
      knowledge: claimed.connection.knowledge,
      image,
      firstReply,
    });
    await whatsappOrganizationLock(seed.organizationId, async (tx) => {
      const current = await tx.whatsAppMessage.findFirst({
        where: { id, leaseToken: token, state: "PROCESSING" },
        include: { conversation: { include: { connection: true } } },
      });
      if (!current) return;
      const c = current.conversation;
      if (
        c.mode !== "AI" ||
        c.generationVersion !== claimed.conversation.generationVersion ||
        c.inboundSequence !== seed.inboundSequence ||
        !c.connection.aiEnabled ||
        c.connection.configVersion !== claimed.connection.configVersion
      ) {
        await tx.whatsAppMessage.update({
          where: { id },
          data: { state: "COALESCED", leaseUntil: null, leaseToken: null },
        });
        return;
      }
      const version = c.generationVersion + (result.needsHuman ? 1 : 0);
      if (result.needsHuman)
        await tx.whatsAppConversation.update({
          where: { id: c.id },
          data: { mode: "HUMAN", needsHuman: true, generationVersion: version },
        });
      else
        await tx.whatsAppConversation.update({
          where: { id: c.id },
          data: { needsHuman: false, lastIssue: null },
        });
      await tx.whatsAppMessage.upsert({
        where: { responseToId: current.id },
        create: {
          organizationId: current.organizationId,
          storeId: current.storeId,
          conversationId: c.id,
          responseToId: current.id,
          direction: "OUTBOUND",
          kind: "TEXT",
          providerEventKey: `ai:${current.id}`,
          inboundSequence: c.inboundSequence,
          body: result.body,
          state: "PREPARED",
          generationVersion: version,
          configVersion: c.connection.configVersion,
          facts: { answer: result.answer, firstReply, handoff: result.needsHuman },
        },
        update: {},
      });
      await tx.whatsAppMessage.update({
        where: { id },
        data: { state: "PROCESSED", leaseToken: null, leaseUntil: null },
      });
    });
  } catch (error) {
    const key = errorKey(error);
    const updated = await prisma.whatsAppMessage.updateMany({
      where: { id, leaseToken: token, state: "PROCESSING" },
      data: { state: "HUMAN", lastIssue: key, leaseToken: null, leaseUntil: null },
    });
    if (updated.count)
      await needsHuman(seed.conversationId, key, claimed.conversation.generationVersion);
  }
}

async function processOutbound(id: string) {
  const seed = await prisma.whatsAppMessage.findFirst({
    where: { id, state: "PREPARED" },
    include: { conversation: { include: { connection: true } } },
  });
  if (!seed) return;
  try {
    const c = seed.conversation,
      connection = c.connection;
    const facts = seed.actorId ? null : factsSchema.parse(seed.facts);
    const allowedMode = seed.actorId
      ? c.mode === "HUMAN"
      : c.mode === "AI" || (facts?.handoff && c.mode === "HUMAN");
    if (
      !(seed.actorId ? whatsappConfig().transportReady : whatsappConfig().ready) ||
      !allowedMode ||
      connection.state !== "CONNECTED" ||
      (!seed.actorId && !connection.aiEnabled) ||
      c.generationVersion !== seed.generationVersion ||
      (!seed.actorId && c.inboundSequence !== seed.inboundSequence) ||
      (!seed.actorId && connection.configVersion !== seed.configVersion) ||
      c.buyerCountry !== "KG" ||
      !whatsappWindowOpen(c.lastInboundAt)
    )
      throw new AppError("whatsappSendCancelled", "CONFLICT", 409);
    if (seed.actorId) {
      const actor = await prisma.user.findFirst({
        where: {
          id: seed.actorId,
          organizationId: seed.organizationId,
          isActive: true,
          role: { in: ["ADMIN", "MANAGER"] },
        },
      });
      if (!actor) throw new AppError("forbidden", "FORBIDDEN", 403);
      const { assertUserCanAccessStore } = await import("@/server/services/storeAccess");
      await assertUserCanAccessStore(
        prisma,
        { ...actor, organizationId: seed.organizationId },
        seed.storeId,
      );
    }
    let body = seed.body;
    if (facts) {
      const offers = await refreshWhatsAppOffers(
        seed.organizationId,
        seed.storeId,
        facts.answer.offerRefs,
      );
      const catalog = await prisma.bazaarCatalog.findFirst({
        where: { organizationId: seed.organizationId, storeId: seed.storeId, status: "PUBLISHED" },
        select: { publicUrlPath: true },
      });
      body = renderWhatsAppAnswer({
        answer: facts.answer,
        offers,
        profile: whatsappProfileSchema.parse(connection.profile),
        knowledge: whatsappKnowledgeSchema.parse(connection.knowledge),
        firstReply: facts.firstReply,
        origin: whatsappConfig().origin,
        catalogLink: catalog?.publicUrlPath,
      }).body;
    }
    if (!connection.encryptedAppToken || !connection.providerAppId)
      throw new AppError("whatsappReconnectRequired", "CONFLICT", 409);
    await reserveWhatsAppUnit(seed.organizationId, id);
    const token = randomUUID();
    // Recheck current flags/version atomically immediately before the external send.
    const claimed = await whatsappOrganizationLock(seed.organizationId, async (tx) => {
      const current = await tx.whatsAppMessage.findFirst({
        where: { id, state: "PREPARED" },
        include: { conversation: { include: { connection: true } } },
      });
      if (
        !current ||
        current.conversation.generationVersion !== seed.generationVersion ||
        (!seed.actorId && current.conversation.connection.configVersion !== seed.configVersion) ||
        (!seed.actorId && !current.conversation.connection.aiEnabled) ||
        current.conversation.connection.state !== "CONNECTED" ||
        current.conversation.buyerCountry !== "KG" ||
        (!seed.actorId && current.conversation.inboundSequence !== seed.inboundSequence) ||
        !whatsappWindowOpen(current.conversation.lastInboundAt) ||
        current.conversation.archived ||
        current.conversation.redactedAt
      )
        return "STALE";
      const older = await tx.whatsAppMessage.count({
        where: {
          conversationId: c.id,
          direction: "OUTBOUND",
          state: { in: ["PREPARED", "SENDING"] },
          OR: [
            { createdAt: { lt: current.createdAt } },
            { createdAt: current.createdAt, id: { lt: current.id } },
          ],
        },
      });
      if (older) return "WAIT";
      // A refund can revoke a paid lot after preparation/reservation. The refund
      // and this final claim share the organization lock; in-flight sends retain
      // their reservation so late delivery can still be accounted exactly once.
      await assertWhatsAppReservedUnitCanSend(seed.organizationId, id, tx);
      const changed = await tx.whatsAppMessage.updateMany({
        where: { id, state: "PREPARED" },
        data: {
          state: "SENDING",
          body,
          leaseToken: token,
          leaseUntil: new Date(Date.now() + 60000),
          sendStartedAt: new Date(),
        },
      });
      return changed.count ? "CLAIMED" : "STALE";
    });
    if (claimed === "WAIT") return;
    if (claimed !== "CLAIMED") {
      // A concurrent worker may already own SENDING. Its reservation must remain held.
      const cancelled = await prisma.whatsAppMessage.updateMany({
        where: { id, state: "PREPARED" },
        data: { state: "CANCELLED" },
      });
      if (cancelled.count) await settleWhatsAppUnit(seed.organizationId, id, false);
      return;
    }
    await recordWhatsAppEstimate(seed.organizationId, 1000); // conservative transport estimate
    try {
      const providerMessageId = await sendGupshupText({
        appId: connection.providerAppId,
        token: decryptWhatsAppSecret(connection.encryptedAppToken, connection.id),
        phone: c.phone,
        bsuid: c.bsuid,
        body,
        messageId: id,
      });
      await prisma.whatsAppMessage.updateMany({
        where: { id, leaseToken: token, state: "SENDING" },
        data: { state: "SENT", providerMessageId, leaseToken: null, leaseUntil: null },
      });
      await prisma.whatsAppConversation.update({
        where: { id: c.id },
        data: { lastMessageAt: new Date() },
      });
    } catch (error) {
      const unknown = error instanceof WhatsAppUnknownSend;
      await prisma.whatsAppMessage.updateMany({
        where: { id, leaseToken: token, state: "SENDING" },
        data: {
          state: unknown ? "UNKNOWN" : "FAILED",
          lastIssue: unknown ? "whatsappDeliveryUnknown" : errorKey(error),
          leaseToken: null,
          leaseUntil: null,
        },
      });
      if (!unknown) await settleWhatsAppUnit(seed.organizationId, id, false);
      await needsHuman(
        c.id,
        unknown ? "whatsappDeliveryUnknown" : errorKey(error),
        seed.generationVersion,
      );
    }
  } catch (error) {
    const changed = await prisma.whatsAppMessage.updateMany({
      where: { id, state: "PREPARED" },
      data: { state: "CANCELLED", lastIssue: errorKey(error) },
    });
    if (changed.count) {
      await settleWhatsAppUnit(seed.organizationId, id, false);
      if (errorKey(error) !== "whatsappSendCancelled")
        await needsHuman(seed.conversationId, errorKey(error), seed.generationVersion ?? -1);
    }
  }
}

export async function reconcileWhatsAppStatuses(limit = 100) {
  const events = await prisma.whatsAppEvent.findMany({
    where: { eventType: "STATUS", processedAt: null },
    take: limit,
    orderBy: { createdAt: "asc" },
  });
  for (const e of events) {
    const settlement = await whatsappOrganizationLock(e.organizationId, async (tx) => {
      const event = await tx.whatsAppEvent.findUnique({ where: { id: e.id } });
      if (!event || event.processedAt || !event.providerMessageId) return null;
      const message = await tx.whatsAppMessage.findFirst({
        where: {
          organizationId: e.organizationId,
          direction: "OUTBOUND",
          sendStartedAt: { not: null },
          conversation: { connectionId: e.connectionId },
          OR: [
            { providerMessageId: event.providerMessageId },
            ...(event.opaqueMessageId ? [{ id: event.opaqueMessageId }] : []),
          ],
        },
      });
      if (!message) {
        // Non-Bazaar sends also generate events. Give a just-accepted send a minute
        // to persist its provider ID, then retire unrelated receipts from this queue.
        if (event.createdAt.getTime() < Date.now() - 60000)
          await tx.whatsAppEvent.update({ where: { id: e.id }, data: { processedAt: new Date() } });
        return null;
      }
      const delivered = ["DELIVERED", "READ"].includes(event.providerStatus ?? ""),
        terminal = ["DELIVERED", "READ"].includes(message.state);
      if (!terminal || event.providerStatus === "READ")
        await tx.whatsAppMessage.update({
          where: { id: message.id },
          data: {
            providerMessageId: message.providerMessageId ?? event.providerMessageId,
            state: delivered
              ? event.providerStatus!
              : event.providerStatus === "FAILED"
                ? "FAILED"
                : "SENT",
            ...(delivered
              ? {
                  deliveredAt: message.deliveredAt ?? event.providerAt ?? event.createdAt,
                  lastIssue: null,
                }
              : {}),
          },
        });
      await tx.whatsAppEvent.update({ where: { id: e.id }, data: { processedAt: new Date() } });
      return delivered || terminal || event.providerStatus === "FAILED"
        ? { messageId: message.id, delivered: delivered || terminal }
        : null;
    });
    if (settlement)
      await settleWhatsAppUnit(e.organizationId, settlement.messageId, settlement.delivered);
  }
  // Receipt and settlement survive a crash between either commit.
  const pending = await prisma.whatsAppCreditUse.findMany({
    where: {
      OR: [
        {
          state: "RESERVED",
          message: { state: { in: ["DELIVERED", "READ", "FAILED", "CANCELLED"] } },
        },
        { state: "RELEASED", message: { state: { in: ["DELIVERED", "READ"] } } },
      ],
    },
    take: limit,
    include: { message: { select: { state: true } } },
  });
  for (const use of pending)
    await settleWhatsAppUnit(
      use.organizationId,
      use.messageId,
      ["DELIVERED", "READ"].includes(use.message.state),
    );
}

export async function runWhatsAppWorkerBatch(limit = 10, shouldStop = () => false) {
  const config = whatsappConfig();
  const workerState = config.ready ? "READY" : config.transportReady ? "MANUAL" : "DISABLED";
  await whatsAppHeartbeat(workerState);
  await reconcileWhatsAppStatuses();
  await prisma.whatsAppMessage.updateMany({
    where: { state: "SENDING", leaseUntil: { lt: new Date() } },
    data: {
      state: "UNKNOWN",
      lastIssue: "whatsappDeliveryUnknown",
      leaseToken: null,
      leaseUntil: null,
    },
  });
  await prisma.whatsAppMessage.updateMany({
    where: { state: "PROCESSING", leaseUntil: { lt: new Date() }, attempts: { lt: 3 } },
    data: { state: "RECEIVED", leaseToken: null, leaseUntil: null },
  });
  const exhausted = await prisma.whatsAppMessage.findMany({
    where: { state: "PROCESSING", leaseUntil: { lt: new Date() }, attempts: { gte: 3 } },
    take: 20,
  });
  for (const message of exhausted) {
    await prisma.whatsAppMessage.update({
      where: { id: message.id },
      data: { state: "HUMAN", leaseToken: null, leaseUntil: null },
    });
    await needsHuman(message.conversationId, "whatsappAiUnavailable");
  }
  if (!config.transportReady) return { processed: 0, state: "DISABLED" };
  const ids = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM (
      SELECT id, "nextAttemptAt", row_number() OVER (PARTITION BY "organizationId" ORDER BY "nextAttemptAt", id) AS turn
      FROM "WhatsAppMessage" WHERE state IN ('RECEIVED', 'PREPARED') AND "nextAttemptAt" <= NOW()
    ) waiting ORDER BY turn, "nextAttemptAt", id LIMIT ${Math.min(20, Math.max(1, limit))}`;
  const candidates = await prisma.whatsAppMessage.findMany({
    where: { id: { in: ids.map((item) => item.id) } },
  });
  candidates.sort(
    (a, b) => ids.findIndex((item) => item.id === a.id) - ids.findIndex((item) => item.id === b.id),
  );
  const conversations = new Map<string, typeof candidates>();
  for (const message of candidates)
    conversations.set(message.conversationId, [
      ...(conversations.get(message.conversationId) ?? []),
      message,
    ]);
  const groups = [...conversations.values()];
  let processed = 0;
  // Three independent conversations overlap network waits; each conversation is
  // serialized and the final database claim also preserves order across workers.
  for (let start = 0; start < groups.length && !shouldStop(); start += 3) {
    const results = await Promise.allSettled(
      groups.slice(start, start + 3).map(async (group) => {
        for (const message of group) {
          if (shouldStop()) break;
          if (message.direction === "INBOUND") await processIncoming(message.id);
          else if (message.direction === "OUTBOUND") await processOutbound(message.id);
          processed++;
          await whatsAppHeartbeat(workerState);
        }
      }),
    );
    if (results.some((result) => result.status === "rejected"))
      throw new Error("WhatsApp durable batch needs retry");
  }
  return { processed, state: workerState };
}

export async function redactExpiredWhatsAppData(now = new Date()) {
  await prisma.whatsAppMessage.updateMany({
    where: {
      createdAt: { lt: new Date(now.getTime() - 7 * 86400_000) },
      media: { not: Prisma.DbNull },
    },
    data: { media: Prisma.DbNull },
  });
  await prisma.whatsAppMessage.updateMany({
    where: { createdAt: { lt: new Date(now.getTime() - 90 * 86400_000) }, body: { not: "" } },
    data: { body: "", facts: Prisma.DbNull },
  });
  const expired = await prisma.whatsAppConversation.findMany({
    where: { redactedAt: null, lastMessageAt: { lt: new Date(now.getTime() - 90 * 86400_000) } },
    take: 100,
  });
  for (const c of expired) {
    await prisma.whatsAppConversation.update({
      where: { id: c.id },
      data: {
        externalIdentity: `erased:${randomUUID()}`,
        phone: null,
        bsuid: null,
        buyerCountry: null,
        customerName: null,
        lastInboundAt: null,
        redactedAt: now,
        archived: true,
        mode: "HUMAN",
        generationVersion: { increment: 1 },
      },
    });
  }
}
