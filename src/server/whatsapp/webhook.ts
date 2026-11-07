import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { whatsappPeriod, whatsappRecipientCountry } from "@/lib/whatsapp-ai";
import { decryptWhatsAppSecret, validWhatsAppWebhookSecret, whatsappConfig } from "./config";
import { normalizeWhatsAppEvents, type WhatsAppNormalizedEvent } from "./events";
import { cancelWhatsAppPrepared } from "./workspace";
import { whatsappOrganizationLock } from "./access";

export async function receiveWhatsAppWebhook(request: Request, connectionId: string) {
  const reply = (status: number) =>
    new Response(status === 200 ? "ok" : "unavailable", {
      status,
      headers: { "Cache-Control": "no-store" },
    });
  if (!/^[a-zA-Z0-9_-]{10,80}$/.test(connectionId)) return reply(404);
  const c = await prisma.whatsAppConnection.findUnique({ where: { id: connectionId } });
  if (!c?.encryptedWebhookKey || !c.providerAppId) return reply(404);
  let secret: string;
  try {
    secret = decryptWhatsAppSecret(c.encryptedWebhookKey, c.id);
  } catch {
    return reply(503);
  }
  if (!validWhatsAppWebhookSecret(request.headers.get("x-gupshup-webhook-secret"), secret))
    return reply(403);
  if (process.env.WHATSAPP_PRIVACY_APPROVED !== "1" || c.state === "DISCONNECTED")
    return reply(503);
  let events: WhatsAppNormalizedEvent[];
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 262144) return reply(413);
    const reader = request.body?.getReader();
    if (!reader) return reply(400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 262144) {
        await reader.cancel();
        return reply(413);
      }
      chunks.push(part.value);
    }
    events = normalizeWhatsAppEvents(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
      c.providerAppId,
    );
  } catch {
    return reply(400);
  }
  for (const event of events) {
    const outcome = await whatsappOrganizationLock(c.organizationId, async (tx) => {
      const inserted = await tx.whatsAppEvent.createMany({
        data: [
          {
            organizationId: c.organizationId,
            storeId: c.storeId,
            connectionId: c.id,
            eventKey: event.key,
            eventType: event.kind,
            providerMessageId: event.kind === "STATUS" ? event.id : null,
            providerStatus: event.status ?? null,
            providerAt: event.at,
            opaqueMessageId: event.opaqueMessageId ?? null,
            processedAt: event.kind === "STATUS" ? null : new Date(),
          },
        ],
        skipDuplicates: true,
      });
      if (!inserted.count) return null;
      await tx.whatsAppConnection.update({
        where: { id: c.id },
        data: { lastWebhookAt: new Date() },
      });
      // Receipt is durable before acknowledgement; the worker applies monotonic status changes.
      if (event.kind === "STATUS") return null;
      if (event.kind === "ACCOUNT") {
        if (/DISABLED|BANNED|DELETED|REVOKED/.test(event.status ?? "")) {
          await tx.whatsAppConnection.update({
            where: { id: c.id },
            data: {
              state: "ATTENTION",
              aiEnabled: false,
              lastIssue: "whatsappReconnectRequired",
              configVersion: { increment: 1 },
            },
          });
          return { connectionId: c.id, conversationId: null };
        }
        return null;
      }
      if (!event.identity) return null;
      const country = whatsappRecipientCountry(event.phone, event.country);
      const existing = await tx.whatsAppConversation.upsert({
        where: {
          connectionId_externalIdentity: { connectionId: c.id, externalIdentity: event.identity },
        },
        create: {
          organizationId: c.organizationId,
          storeId: c.storeId,
          connectionId: c.id,
          externalIdentity: event.identity,
          phone: event.phone,
          bsuid: event.bsuid,
          buyerCountry: country,
          customerName: event.name,
        },
        update: {
          ...(event.name ? { customerName: event.name } : {}),
          ...(event.phone ? { phone: event.phone } : {}),
          ...(event.phone || event.country ? { buyerCountry: country } : {}),
        },
      });
      if (event.kind === "ECHO") {
        const own = await tx.whatsAppMessage.findFirst({
          where: {
            conversationId: existing.id,
            providerMessageId: event.id,
            direction: "OUTBOUND",
          },
        });
        if (own) return null;
        await tx.whatsAppConversation.update({
          where: { id: existing.id },
          data: {
            mode: "HUMAN",
            needsHuman: false,
            generationVersion: { increment: 1 },
            lastMessageAt: new Date(),
          },
        });
        await tx.whatsAppMessage.create({
          data: {
            organizationId: c.organizationId,
            storeId: c.storeId,
            conversationId: existing.id,
            providerEventKey: event.key,
            providerMessageId: event.id,
            direction: "STAFF_APP",
            kind: event.messageKind ?? "TEXT",
            body: event.body ?? "",
            state: "SENT",
          },
        });
        return { connectionId: null, conversationId: existing.id };
      }
      const supported = ["TEXT", "IMAGE"].includes(event.messageKind ?? "");
      const buyerCountry = event.phone || event.country ? country : existing.buyerCountry;
      const needsHuman =
        !supported ||
        buyerCountry !== "KG" ||
        existing.mode === "HUMAN" ||
        !c.aiEnabled ||
        !whatsappConfig().ready;
      const conversation = await tx.whatsAppConversation.update({
        where: { id: existing.id },
        data: {
          inboundSequence: { increment: 1 },
          lastInboundAt:
            !existing.lastInboundAt || event.at > existing.lastInboundAt
              ? event.at
              : existing.lastInboundAt,
          lastMessageAt: new Date(),
          archived: false,
          ...(needsHuman ? { mode: "HUMAN", needsHuman: true } : {}),
        },
      });
      await tx.whatsAppMessage.create({
        data: {
          organizationId: c.organizationId,
          storeId: c.storeId,
          conversationId: existing.id,
          providerEventKey: event.key,
          providerMessageId: event.id,
          direction: "INBOUND",
          kind: event.messageKind ?? "OTHER",
          body: event.body ?? "",
          media: event.media ? event.media : Prisma.DbNull,
          inboundSequence: conversation.inboundSequence,
          state: needsHuman ? "HUMAN" : "RECEIVED",
          nextAttemptAt: new Date(Date.now() + 1200),
        },
      });
      const period = whatsappPeriod().key;
      await tx.whatsAppMonth.upsert({
        where: { organizationId_period: { organizationId: c.organizationId, period } },
        create: {
          organizationId: c.organizationId,
          period,
          inboundCount: 1,
          estimatedSpendMicros: BigInt(1000),
        },
        update: {
          inboundCount: { increment: 1 },
          estimatedSpendMicros: { increment: BigInt(1000) },
        },
      });
      return needsHuman ? { connectionId: null, conversationId: existing.id } : null;
    });
    if (outcome?.conversationId)
      await cancelWhatsAppPrepared({ conversationId: outcome.conversationId });
    if (outcome?.connectionId)
      await cancelWhatsAppPrepared({ conversation: { connectionId: outcome.connectionId } });
  }
  // No external calls before acknowledgment. A durable worker owns subsequent processing.
  return reply(200);
}
