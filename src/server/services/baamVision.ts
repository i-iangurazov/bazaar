import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import sharp from "sharp";
import { prisma } from "@/server/db/prisma";
import { ownBaamConversation } from "./baamConversations";
import { downloadRemoteImage } from "./productImageStorage";
import { AppError } from "./errors";

// Only attachments already owned by this conversation are accepted. Neither a
// user prompt nor a model-generated URL can initiate a server-side image fetch.
export async function readBaamImages(
  ctx: Parameters<typeof ownBaamConversation>[0],
  conversationId: string,
  ids: string[],
) {
  if (!ids.length) return [];
  await ownBaamConversation(ctx, conversationId);
  const attachments = await prisma.baamAttachment.findMany({
    where: { conversationId, id: { in: ids } },
    select: { id: true, url: true },
  });
  if (attachments.length !== new Set(ids).size)
    throw new AppError("baamAttachmentNotFound", "NOT_FOUND", 404);
  const root = resolve(process.cwd(), "public", "uploads", "imported-products");
  return Promise.all(
    attachments.map(async (attachment) => {
      let buffer: Buffer;
      if (attachment.url.startsWith("/uploads/imported-products/")) {
        const path = resolve(process.cwd(), "public", attachment.url.slice(1));
        if (!path.startsWith(root + sep))
          throw new AppError("baamAttachmentNotFound", "NOT_FOUND", 404);
        buffer = await readFile(path);
      } else {
        const downloaded = await downloadRemoteImage(attachment.url);
        if (!downloaded) throw new AppError("baamAttachmentNotFound", "NOT_FOUND", 404);
        buffer = downloaded.buffer;
      }
      if (buffer.length > 5 * 1024 * 1024) throw new AppError("imageTooLarge", "BAD_REQUEST", 400);
      const prepared = await sharp(buffer, { limitInputPixels: 40_000_000 })
        .rotate()
        .resize({ width: 1536, height: 1536, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
      return `data:image/jpeg;base64,${prepared.toString("base64")}`;
    }),
  );
}
