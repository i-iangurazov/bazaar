import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db/prisma";
import { productPhotoSearchModel } from "@/lib/productPhotoSearch";
import { canonicalPhoto } from "./productPhotoSearch";
import { embedProductPhoto } from "./productPhotoSearchEngine";
import { photoSourceKey } from "./productPhotoSearchScope";
import { fetchPublicProductImage, readLocalProductImage } from "./productImageFetch";
import { AppError } from "./errors";

async function currentSource(job: { productId: string; organizationId: string; sourceKey: string; sourceUrl: string }) {
  const product = await prisma.product.findFirst({ where: { id: job.productId, organizationId: job.organizationId, isDeleted: false },
    select: { id: true, photoUrl: true, updatedAt: true, images: {
      where: { organizationId: job.organizationId, url: job.sourceUrl }, select: { url: true, updatedAt: true },
    } } });
  if (!product) return false;
  return product.images.some((image) => photoSourceKey(product.id, image.url, image.updatedAt) === job.sourceKey) ||
    (product.photoUrl === job.sourceUrl && !product.images.length && photoSourceKey(product.id, job.sourceUrl, product.updatedAt) === job.sourceKey);
}

export async function processNextProductPhoto(options: { skipOrganizationId?: string; signal?: AbortSignal } = {}) {
  const now = new Date();
  await prisma.productPhotoFeature.updateMany({ where: { modelVersion: productPhotoSearchModel, status: "PROCESSING", attempts: { gte: 3 }, leaseExpiresAt: { lt: now } },
    data: { status: "FAILED", errorCode: "photoSearchTimeout", leaseToken: null, leaseExpiresAt: null } });
  const available = { modelVersion: productPhotoSearchModel, attempts: { lt: 3 }, OR: [
    { status: "PENDING", retryAfter: { lte: now } }, { status: "PROCESSING", leaseExpiresAt: { lt: now } },
  ] };
  let candidate = options.skipOrganizationId ? await prisma.productPhotoFeature.findFirst({ where: {
    ...available, organizationId: { not: options.skipOrganizationId },
  }, orderBy: { createdAt: "asc" } }) : null;
  candidate ??= await prisma.productPhotoFeature.findFirst({ where: available, orderBy: { createdAt: "asc" } });
  if (!candidate) return null;
  const leaseToken = randomUUID();
  const claimed = await prisma.productPhotoFeature.updateMany({ where: { id: candidate.id, organizationId: candidate.organizationId, ...available },
    data: { status: "PROCESSING", attempts: { increment: 1 }, leaseToken, leaseExpiresAt: new Date(Date.now() + 60_000) } });
  if (!claimed.count) return null;
  const lease = { id: candidate.id, organizationId: candidate.organizationId, status: "PROCESSING", leaseToken };
  try {
    if (!await currentSource(candidate)) {
      await prisma.productPhotoFeature.deleteMany({ where: lease });
      return candidate.organizationId;
    }
    const signal = AbortSignal.any([AbortSignal.timeout(30_000), ...(options.signal ? [options.signal] : [])]);
    const source = candidate.sourceUrl.startsWith("/uploads/")
      ? await readLocalProductImage(candidate.sourceUrl, 5 * 1024 * 1024)
      : await fetchPublicProductImage(candidate.sourceUrl, { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]), maxBytes: 5 * 1024 * 1024 });
    if (!source) throw new AppError("imageInvalidType", "BAD_REQUEST", 400);
    const name = candidate.sourceUrl.split("?")[0].split("/").pop() ?? "photo.jpg";
    const type = source.contentType.startsWith("image/") ? source.contentType.split(";")[0] : /\.(heic|heif)$/i.test(name) ? "image/heic" : "image/jpeg";
    // File intake codecs, orientation, EXIF stripping and pixel bounds are shared.
    const jpeg = await canonicalPhoto(new File([new Uint8Array(source.buffer)], name, { type }), 5 * 1024 * 1024);
    const embedding = await embedProductPhoto(jpeg, signal);
    if (!await currentSource(candidate)) {
      await prisma.productPhotoFeature.deleteMany({ where: lease });
      return candidate.organizationId;
    }
    await prisma.productPhotoFeature.updateMany({ where: lease,
      data: { status: "READY", embedding, errorCode: null, leaseToken: null, leaseExpiresAt: null } });
  } catch (error) {
    const busy = error instanceof AppError && error.message === "photoSearchBusy";
    const stopped = options.signal?.aborted;
    await prisma.productPhotoFeature.updateMany({ where: lease, data: {
      status: busy || stopped || candidate.attempts < 2 ? "PENDING" : "FAILED",
      attempts: busy || stopped ? candidate.attempts : candidate.attempts + 1,
      retryAfter: new Date(Date.now() + (busy || stopped ? 2000 : 1000 * 2 ** candidate.attempts)),
      errorCode: error instanceof AppError ? error.message : "photoSearchUnavailable", leaseToken: null, leaseExpiresAt: null,
    } });
  }
  return candidate.organizationId;
}

let pruneCursor = "";
export async function pruneObsoleteProductPhotos() {
  const entries = await prisma.productPhotoFeature.findMany({ where: { id: { gt: pruneCursor }, updatedAt: { lt: new Date(Date.now() - 86_400_000) } },
    orderBy: { id: "asc" }, take: 50 });
  // Advance past live entries too, so old valid features cannot starve cleanup.
  pruneCursor = entries.length === 50 ? entries[entries.length - 1].id : "";
  for (const entry of entries) if (!await currentSource(entry))
    await prisma.productPhotoFeature.deleteMany({ where: { id: entry.id, organizationId: entry.organizationId, updatedAt: entry.updatedAt } });
}
