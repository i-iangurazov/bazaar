import { createHash } from "node:crypto";
import { createContext } from "@/server/trpc/trpc";
import { ownBaamConversation } from "@/server/services/baamConversations";
import { transcribeBaamAudio } from "@/server/services/baamAudio";
import { resolveProductPhotoSourceMimeType } from "@/lib/productImageUpload";
import { prepareProductStudioSource } from "@/server/services/productImageSourceUpload";
import { createRateLimiter } from "@/server/middleware/rateLimiter";
import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { assertAiConsent } from "@/server/services/aiPrivacy";
import { baamAttachmentHref, encryptBaamMedia, readBaamAttachmentBytes } from "@/server/services/baamPrivateMedia";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const limiter = createRateLimiter({ windowMs: 60_000, max: 12, prefix: "baam-media" });
export async function GET(request: Request) {
  try {
    const ctx = await createContext({ req: request, resHeaders: new Headers() });
    const id = new URL(request.url).searchParams.get("attachmentId");
    if (!id) throw new AppError("baamAttachmentNotFound", "NOT_FOUND", 404);
    const attachment = await prisma.baamAttachment.findUnique({ where: { id } });
    if (!attachment) throw new AppError("baamAttachmentNotFound", "NOT_FOUND", 404);
    const { scope } = await ownBaamConversation(ctx, attachment.conversationId);
    if (!/^image\/(?:jpeg|png|webp|avif|heic|heif|gif|tiff|bmp)$/.test(attachment.mimeType))
      throw new AppError("imageInvalidType", "BAD_REQUEST", 400);
    const buffer = await readBaamAttachmentBytes(attachment, scope.organizationId);
    return new Response(new Uint8Array(buffer), {
      headers: { "Content-Type": attachment.mimeType, "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" },
    });
  } catch (error) {
    return Response.json(
      { message: error instanceof AppError ? error.message : "baamMediaFailed" },
      { status: error instanceof AppError ? error.status : 400 },
    );
  }
}
export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin)
      throw new AppError("forbidden", "FORBIDDEN", 403);
    if (Number(request.headers.get("content-length")) > 3.3 * 1024 * 1024)
      return Response.json({ message: "baamMediaTooLarge" }, { status: 413 });
    const ctx = await createContext({ req: request, resHeaders: new Headers() });
    if (!ctx.user) throw new AppError("unauthorized", "UNAUTHORIZED", 401);
    await assertAiConsent({ userId: ctx.user.id, organizationId: ctx.user.organizationId,
      impersonating: Boolean(ctx.impersonator) });
    await limiter.consume(ctx.user.id);
    // Bound chunked uploads too; Content-Length is not trustworthy or mandatory.
    const reader = request.body?.getReader();
    if (!reader) throw new AppError("invalidInput", "BAD_REQUEST", 400);
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > 3.3 * 1024 * 1024) {
        await reader.cancel();
        throw new AppError("baamMediaTooLarge", "BAD_REQUEST", 413);
      }
      chunks.push(chunk.value);
    }
    const form = await new Response(Buffer.concat(chunks), {
      headers: { "content-type": request.headers.get("content-type") ?? "" },
    }).formData();
    const conversationId = form.get("conversationId"),
      kind = form.get("kind"),
      file = form.get("file"),
      locale = form.get("locale");
    if (
      typeof conversationId !== "string" ||
      !(file instanceof File) ||
      !["ru", "en", "kg"].includes(String(locale))
    )
      throw new AppError("invalidInput", "BAD_REQUEST", 400);
    const access = await ownBaamConversation(ctx, conversationId);
    if (!file.size)
      throw new AppError(
        kind === "image" ? "imageInvalidType" : "baamAudioEmpty",
        "BAD_REQUEST",
        400,
      );
    if (file.size > 3 * 1024 * 1024)
      throw new AppError(
        kind === "image" ? "imageTooLarge" : "baamAudioTooLarge",
        "BAD_REQUEST",
        413,
      );
    const buffer = Buffer.from(await file.arrayBuffer());
    if (kind === "audio") {
      const result = await transcribeBaamAudio(
        ctx,
        conversationId,
        buffer,
        file.type,
        String(locale),
      );
      return Response.json({
        id: result.id,
        text: result.text,
        languages: result.languages,
        needsReview: true,
      });
    }
    if (kind !== "image" || !resolveProductPhotoSourceMimeType(file))
      throw new AppError("imageInvalidType", "BAD_REQUEST", 400);
    const contentHash = createHash("sha256").update(buffer).digest("hex");
    const existing = await prisma.baamAttachment.findUnique({
      where: { conversationId_contentHash: { conversationId, contentHash } },
    });
    if (existing) return Response.json({ id: existing.id, name: existing.name, mimeType: existing.mimeType,
      url: baamAttachmentHref(existing.id) });
    const prepared = await prepareProductStudioSource(file);
    const envelope = encryptBaamMedia(prepared.buffer, { organizationId: access.scope.organizationId,
      conversationId, mimeType: prepared.contentType });
    const attachment = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "BaamConversation" WHERE id = ${conversationId} FOR UPDATE`;
        const current = await tx.baamConversation.findFirst({
          where: { id: conversationId, userId: ctx.user!.id, deletedAt: null }, select: { id: true },
        });
        if (!current) throw new AppError("baamConversationNotFound", "NOT_FOUND", 404);
        return tx.baamAttachment.upsert({
          where: { conversationId_contentHash: { conversationId, contentHash } }, update: {},
          create: { contentHash, conversationId, url: envelope,
            name: file.name.slice(0, 180), mimeType: prepared.contentType },
        });
    });
    return Response.json({ id: attachment.id, name: attachment.name, mimeType: attachment.mimeType,
      url: baamAttachmentHref(attachment.id) });
  } catch (error) {
    const message =
      error instanceof AppError
        ? error.message
        : error instanceof Error &&
            [
              "rateLimited",
              "imageInvalidType",
              "imageTooLarge",
              "imageStorageNotConfigured",
            ].includes(error.message)
          ? error.message
          : "baamMediaFailed";
    console.warn("baam.media.failed", {
      code: message,
      status: error instanceof AppError ? error.status : 400,
    });
    return Response.json(
      { message },
      { status: error instanceof AppError ? error.status : message === "rateLimited" ? 429 : 400 },
    );
  }
}
