import sharp from "sharp";
import { prisma } from "@/server/db/prisma";
import { ownBaamConversation } from "./baamConversations";
import { readBaamAttachmentBytes } from "./baamPrivateMedia";
import { AppError } from "./errors";

// Only attachments already owned by this conversation are accepted. Neither a
// user prompt nor a model-generated URL can initiate a server-side image fetch.
export async function readBaamImages(
  ctx: Parameters<typeof ownBaamConversation>[0],
  conversationId: string,
  ids: string[],
) {
  if (!ids.length) return [];
  const { scope } = await ownBaamConversation(ctx, conversationId);
  const attachments = await prisma.baamAttachment.findMany({
    where: { conversationId, id: { in: ids } },
    select: { id: true, url: true, mimeType: true, conversationId: true },
  });
  if (attachments.length !== new Set(ids).size)
    throw new AppError("baamAttachmentNotFound", "NOT_FOUND", 404);
  return Promise.all(
    attachments.map(async (attachment) => {
      const buffer = await readBaamAttachmentBytes(attachment, scope.organizationId);
      const prepared = await sharp(buffer, { limitInputPixels: 40_000_000 })
        .rotate()
        .resize({ width: 1536, height: 1536, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
      return `data:image/jpeg;base64,${prepared.toString("base64")}`;
    }),
  );
}
