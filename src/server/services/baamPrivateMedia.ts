import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { Context } from "@/server/trpc/trpc";
import { prisma } from "@/server/db/prisma";
import { downloadRemoteImage, uploadProductImageBuffer } from "./productImageStorage";
import { AppError } from "./errors";

export const BAAM_PRIVATE_MEDIA_PREFIX = "baam-private:v1:";
export const BAAM_PRIVATE_MEDIA_MAX_BYTES = 3 * 1024 * 1024;
const mimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
type MediaScope = { organizationId: string; conversationId: string; mimeType: string };

const mediaKey = () => {
  const value = process.env.BAAM_MEDIA_ENCRYPTION_KEY?.trim() ?? "";
  const key = Buffer.from(value, "base64");
  if (key.length !== 32 || key.toString("base64") !== value)
    throw new AppError("baamPrivateMediaNotConfigured", "CONFLICT", 409);
  return key;
};
const aad = (scope: MediaScope) => Buffer.from(JSON.stringify([
  "bazaar-private-baam-image-v1", scope.organizationId, scope.conversationId, scope.mimeType,
]));
export const baamAttachmentHref = (id: string) => `/api/baam/media?attachmentId=${encodeURIComponent(id)}`;
export const isPrivateBaamMedia = (value: string) => value.startsWith(BAAM_PRIVATE_MEDIA_PREFIX);
export const baamProductPhotoReference = (id: string) => `baam-attachment:${id}`;

// The encrypted envelope is stored only in the private database, never in a
// public product bucket, a browser response or a message/action payload.
export const encryptBaamMedia = (buffer: Buffer, scope: MediaScope) => {
  if (!mimeTypes.has(scope.mimeType) || !buffer.length || buffer.length > BAAM_PRIVATE_MEDIA_MAX_BYTES)
    throw new AppError("imageInvalidType", "BAD_REQUEST", 400);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", mediaKey(), nonce);
  cipher.setAAD(aad(scope));
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return BAAM_PRIVATE_MEDIA_PREFIX + Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString("base64url");
};

export const decryptBaamMedia = (envelope: string, scope: MediaScope) => {
  const key = mediaKey();
  try {
    if (!mimeTypes.has(scope.mimeType) || !isPrivateBaamMedia(envelope)) throw new Error();
    const encoded = envelope.slice(BAAM_PRIVATE_MEDIA_PREFIX.length);
    if (encoded.length > Math.ceil((BAAM_PRIVATE_MEDIA_MAX_BYTES + 28) * 4 / 3) || !/^[a-zA-Z0-9_-]+$/.test(encoded)) throw new Error();
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.length <= 28 || bytes.toString("base64url") !== encoded) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
    decipher.setAAD(aad(scope));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
  } catch {
    throw new AppError("baamAttachmentNotFound", "NOT_FOUND", 404);
  }
};

export const readBaamAttachmentBytes = async (
  attachment: { url: string; mimeType: string; conversationId: string }, organizationId: string,
) => {
  if (isPrivateBaamMedia(attachment.url)) return decryptBaamMedia(attachment.url, {
    organizationId, conversationId: attachment.conversationId, mimeType: attachment.mimeType,
  });
  // Legacy attachments remain readable through the authenticated route. Their
  // original public object is handled by the durable account-erasure queue.
  let buffer: Buffer;
  if (attachment.url.startsWith("/uploads/imported-products/")) {
    const root = resolve(process.cwd(), "public", "uploads", "imported-products");
    const path = resolve(process.cwd(), "public", attachment.url.slice(1));
    if (!path.startsWith(root + sep)) throw new AppError("baamAttachmentNotFound", "NOT_FOUND", 404);
    buffer = await readFile(path);
  } else {
    const downloaded = await downloadRemoteImage(attachment.url);
    if (!downloaded) throw new AppError("baamAttachmentNotFound", "NOT_FOUND", 404);
    buffer = downloaded.buffer;
  }
  if (buffer.length > 5 * 1024 * 1024) throw new AppError("imageTooLarge", "BAD_REQUEST", 400);
  return buffer;
};

// Runs only inside the already-confirmed product execution step. A private
// attachment becomes a separate organization asset when the person chooses it
// as a product photo. Account deletion never removes that adopted company file.
export const adoptBaamProductPhoto = async (ctx: Context, value?: string, productId?: string) => {
  const match = /^baam-attachment:([a-zA-Z0-9_-]{1,100})$/.exec(value ?? "");
  if (!match) return value;
  if (!ctx.user || ctx.impersonator) throw new AppError("forbidden", "FORBIDDEN", 403);
  const attachment = await prisma.baamAttachment.findFirst({
    where: { id: match[1], conversation: { userId: ctx.user.id, organizationId: ctx.user.organizationId,
      deletedAt: null, user: { deletedAt: null, isActive: true } } },
  });
  if (!attachment) throw new AppError("baamAttachmentNotFound", "NOT_FOUND", 404);
  if (!isPrivateBaamMedia(attachment.url)) return attachment.url;
  const buffer = await readBaamAttachmentBytes(attachment, ctx.user.organizationId);
  const image = await uploadProductImageBuffer({ organizationId: ctx.user.organizationId,
    productId, buffer, contentType: attachment.mimeType });
  return image.url;
};
