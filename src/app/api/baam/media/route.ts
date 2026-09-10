import { createContext } from "@/server/trpc/trpc";
import { ownBaamConversation } from "@/server/services/baamConversations";
import { transcribeBaamAudio } from "@/server/services/baamAudio";
import { uploadProductImageBuffer } from "@/server/services/productImageStorage";
import { createRateLimiter } from "@/server/middleware/rateLimiter";
import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";

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
    await ownBaamConversation(ctx, attachment.conversationId);
    const target = new URL(attachment.url, request.url);
    if (!["http:", "https:"].includes(target.protocol))
      throw new AppError("imageInvalidType", "BAD_REQUEST", 400);
    return new Response(null, {
      status: 307,
      headers: { Location: target.href, "Cache-Control": "private, no-store" },
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
      return Response.json({ message: "baamAudioTooLarge" }, { status: 413 });
    const ctx = await createContext({ req: request, resHeaders: new Headers() });
    if (!ctx.user) throw new AppError("unauthorized", "UNAUTHORIZED", 401);
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
        throw new AppError("baamAudioTooLarge", "BAD_REQUEST", 413);
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
    if (!file.size) throw new AppError("baamAudioEmpty", "BAD_REQUEST", 400);
    if (file.size > 3 * 1024 * 1024) throw new AppError("baamAudioTooLarge", "BAD_REQUEST", 400);
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
    if (
      kind !== "image" ||
      !["image/jpeg", "image/png", "image/webp", "image/avif", "image/heic", "image/heif"].includes(
        file.type,
      )
    )
      throw new AppError("imageInvalidType", "BAD_REQUEST", 400);
    const uploaded = await uploadProductImageBuffer({
      organizationId: access.scope.organizationId,
      buffer,
      contentType: file.type,
      sourceFileName: file.name,
    });
    await ownBaamConversation(ctx, conversationId);
    const attachment = await prisma.baamAttachment.create({
      data: {
        conversationId,
        url: uploaded.url,
        name: file.name.slice(0, 180),
        mimeType: file.type,
      },
    });
    return Response.json(attachment);
  } catch (error) {
    const message =
      error instanceof AppError
        ? error.message
        : error instanceof Error && error.message === "rateLimited"
          ? "rateLimited"
          : "baamMediaFailed";
    return Response.json(
      { message },
      { status: error instanceof AppError ? error.status : message === "rateLimited" ? 429 : 400 },
    );
  }
}
