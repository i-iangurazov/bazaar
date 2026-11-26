import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { productPhotoSearchDimension, productPhotoSearchModel } from "@/lib/productPhotoSearch";
import { prisma } from "@/server/db/prisma";
import { productPhotoIndexRevision } from "@/server/services/productPhotoIndexRevision";
import { readyVectorPages } from "@/server/services/productPhotoSearch";
import { packPostgresVector, photoSearchStreamingEnabled } from "@/server/services/productPhotoSearchEngine";
import { loadPhotoSearchScope } from "@/server/services/productPhotoSearchScope";

const HEADER_BYTES = 4096;
const RECORD_BYTES = 4 + productPhotoSearchDimension * 4;
const REFERENCE_BYTES = 32;
const [userId, storeId, root] = process.argv.slice(2);

async function publishIndex() {
  if (!userId || !storeId || !root || !photoSearchStreamingEnabled())
    throw new Error("Usage: PRODUCT_PHOTO_SEARCH_STREAMING=1 tsx scripts/product-photo-index.ts <user> <store> <index directory>");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId, isActive: true, deletedAt: null },
    select: { id: true, organizationId: true, role: true, isOrgOwner: true } });
  const { organizationId } = user;
  if (!organizationId || (user.role !== "ADMIN" && !user.isOrgOwner))
    throw new Error("An organization administrator is required");
  const actor = { ...user, organizationId };
  const before = await productPhotoIndexRevision(prisma, organizationId, storeId);
  const scope = await loadPhotoSearchScope(actor, storeId);
  const { ready: count, pending, failed, withoutPhoto } = scope.progress;
  if (!before || !count || pending || failed || scope.features.length !== count)
    throw new Error("A complete photo index is required before publication");

  const scopeHash = createHash("sha256").update(JSON.stringify([organizationId, storeId])).digest("hex");
  const target = resolve(root, scopeHash + ".index");
  await mkdir(dirname(target), { recursive: true });
  const draft = join(dirname(target), "." + scopeHash + "." + randomUUID() + ".tmp");
  const file = await open(draft, "wx", 0o600);
  try {
    let offset = HEADER_BYTES;
    const writeAt = async (data: Buffer, start: number) => {
      let written = 0;
      while (written < data.length) {
        const { bytesWritten } = await file.write(data, written, data.length - written, start + written);
        if (!bytesWritten) throw new Error("Photo index write made no progress");
        written += bytesWritten;
      }
    };
    const digest = createHash("sha256");
    const writeData = async (data: Buffer) => {
      await writeAt(data, offset);
      digest.update(data);
      offset += data.length;
    };
    const references = Buffer.alloc(count * REFERENCE_BYTES);
    const groups = new Map<string, number>();
    let rowIndex = 0;
    for await (const rows of readyVectorPages({ user: actor, storeId }, scope.features)) {
      const packed = Buffer.allocUnsafe(rows.length * RECORD_BYTES);
      for (const [index, row] of rows.entries()) {
        if (!groups.has(row.productId)) groups.set(row.productId, groups.size);
        packed.writeUInt32LE(groups.get(row.productId)!, index * RECORD_BYTES);
        packPostgresVector(row.embedding, packed, index * RECORD_BYTES + 4);
        if (rowIndex >= count || references.write(row.sourceKey, rowIndex * REFERENCE_BYTES, REFERENCE_BYTES, "hex") !== REFERENCE_BYTES)
          throw new Error("Invalid photo index reference");
        rowIndex += 1;
      }
      await writeData(packed);
    }
    if (rowIndex !== count) throw new Error("Incomplete photo index");
    await writeData(references);
    const sha256 = digest.digest("hex");
    const metadata = Buffer.from(JSON.stringify({ organizationId, storeId, revision: before, count, withoutPhoto, modelVersion: productPhotoSearchModel, sha256 }));
    if (metadata.length > HEADER_BYTES - 4) throw new Error("Photo index metadata too large");
    const header = Buffer.alloc(HEADER_BYTES);
    header.writeUInt32LE(metadata.length);
    metadata.copy(header, 4);
    await writeAt(header, 0);
    await file.sync();
    if (before !== await productPhotoIndexRevision(prisma, organizationId, storeId))
      throw new Error("The catalog changed during index publication");
    await file.close();
    await rename(draft, target);
    console.log(JSON.stringify({ photos: count, bytes: offset, sha256 }));
  } finally {
    await file.close();
    await rm(draft, { force: true });
  }
}

try {
  await publishIndex();
} finally {
  await prisma.$disconnect();
}
