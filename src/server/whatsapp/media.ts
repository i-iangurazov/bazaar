import sharp from "sharp";
import { z } from "zod";
import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { allowedWhatsAppMediaUrl } from "./events";
import { decryptWhatsAppSecret, encryptWhatsAppSecret } from "./config";
import { whatsappAccess, type WhatsAppActor } from "./access";

const mediaSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,256}$/),
  mime: z.string().max(100),
  url: z.string().max(4096).optional(),
  cached: z.string().optional(),
  expiresAt: z.string().optional(),
});

export async function whatsappImage(messageId: string) {
  const message = await prisma.whatsAppMessage.findUnique({
    where: { id: messageId },
    include: { conversation: { include: { connection: true } } },
  });
  if (
    !message ||
    message.kind !== "IMAGE" ||
    message.createdAt.getTime() < Date.now() - 7 * 86400_000
  )
    throw new AppError("whatsappMediaUnavailable", "NOT_FOUND", 404);
  const media = mediaSchema.parse(message.media);
  if (media.cached && media.expiresAt && new Date(media.expiresAt) > new Date())
    return Buffer.from(decryptWhatsAppSecret(media.cached, message.id), "base64");
  if (
    process.env.HARDENING_EXTERNAL_PROVIDER_MODE === "disabled" ||
    process.env.WHATSAPP_PRIVACY_APPROVED !== "1"
  )
    throw new AppError("whatsappNotReady", "CONFLICT", 409);
  const c = message.conversation.connection;
  if (!c.providerAppId || !c.encryptedAppToken)
    throw new AppError("whatsappMediaUnavailable", "NOT_FOUND", 404);
  const suppliedUrl = media.url && allowedWhatsAppMediaUrl(media.url) ? media.url : null;
  const url =
    suppliedUrl ??
    `https://partner.gupshup.io/partner/app/${encodeURIComponent(c.providerAppId)}/media/${encodeURIComponent(media.id)}`;
  // A provider token is only sent to the fixed partner origin, never to media URLs.
  const response = await fetch(url, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(12000),
    headers: suppliedUrl ? {} : { Authorization: decryptWhatsAppSecret(c.encryptedAppToken, c.id) },
  });
  const reader = response.body?.getReader();
  if (
    !response.ok ||
    !reader ||
    Number(response.headers.get("content-length") ?? 0) > 5 * 1024 * 1024
  )
    throw new AppError("whatsappMediaUnavailable", "CONFLICT", 409);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > 5 * 1024 * 1024) {
      await reader.cancel();
      throw new AppError("whatsappMediaUnavailable", "CONFLICT", 409);
    }
    chunks.push(part.value);
  }
  try {
    const image = await sharp(Buffer.concat(chunks), { limitInputPixels: 16000000, pages: 1 })
      .rotate()
      .resize({ width: 960, height: 960, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 65 })
      .toBuffer();
    if (image.length > 256 * 1024) throw new Error("size");
    // A private, authenticated, encrypted thumbnail, never a public product image.
    const stored = await prisma.whatsAppMessage.updateMany({
      where: { id: message.id, conversation: { redactedAt: null } },
      data: {
        media: {
          ...media,
          cached: encryptWhatsAppSecret(image.toString("base64"), message.id),
          expiresAt: new Date(message.createdAt.getTime() + 7 * 86400_000).toISOString(),
        },
      },
    });
    if (!stored.count) throw new Error("erased");
    return image;
  } catch {
    throw new AppError("whatsappMediaUnavailable", "CONFLICT", 409);
  }
}

export async function whatsappImageForActor(actor: WhatsAppActor, messageId: string) {
  const message = await prisma.whatsAppMessage.findFirst({
    where: { id: messageId, organizationId: actor.organizationId },
    select: { storeId: true },
  });
  if (!message) throw new AppError("recordNotFound", "NOT_FOUND", 404);
  await whatsappAccess(actor, message.storeId);
  return whatsappImage(messageId);
}
