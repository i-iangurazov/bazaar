import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { productPhotoSearchMaxImages, productPhotoSearchStreamMaxImages, productPhotoSearchModel, type ProductPhotoProgress } from "@/lib/productPhotoSearch";
import { AppError } from "./errors";
import { photoSearchStreamingEnabled } from "./productPhotoSearchEngine";
import { assertUserCanAccessStore, type StoreAccessUser } from "./storeAccess";

export type PhotoSource = { productId: string; sourceKey: string; sourceUrl: string };
export const photoSourceKey = (productId: string, url: string, revision: Date) =>
  createHash("sha256").update(JSON.stringify([productId, url, revision.toISOString()])).digest("hex");

export async function assertPhotoStore(user: StoreAccessUser, storeId: string, db: Prisma.TransactionClient = prisma) {
  if (!storeId || storeId.length > 128) throw new AppError("invalidInput", "BAD_REQUEST", 400);
  await assertUserCanAccessStore(db, user, storeId);
}

export const photoSearchStoreSelect = { id: true, name: true, enableSku: true, currencyCode: true, currencyRateKgsPerUnit: true } as const;

/** Bounded metadata only; never uses embeddings of another store or organization. */
export async function loadPhotoSearchScope(user: StoreAccessUser, storeId: string, db: Prisma.TransactionClient = prisma, productId?: string) {
  await assertPhotoStore(user, storeId, db);
  const limit = photoSearchStreamingEnabled() ? productPhotoSearchStreamMaxImages : productPhotoSearchMaxImages;
  const assortment = { id: productId, organizationId: user.organizationId, isDeleted: false,
    storeProducts: { some: { organizationId: user.organizationId, storeId, isActive: true, isHidden: false } } };
  const store = await db.store.findFirstOrThrow({ where: { id: storeId, organizationId: user.organizationId }, select: photoSearchStoreSelect });
  const products = await db.product.findMany({
    where: assortment,
    select: { id: true, name: true, photoUrl: true, updatedAt: true }, orderBy: { id: "asc" }, take: limit + 1,
  });
  if (products.length > limit) throw new AppError("photoSearchCatalogTooLarge", "BAD_REQUEST", 422);
  const productIds = new Set(products.map((product) => product.id));
  const images = products.length ? await db.productImage.findMany({
    where: { organizationId: user.organizationId, product: assortment, url: { not: "" } },
    select: { id: true, productId: true, url: true, updatedAt: true }, orderBy: [{ position: "asc" }, { id: "asc" }], take: limit + 1,
  }) : [];
  if (images.length > limit) throw new AppError("photoSearchCatalogTooLarge", "BAD_REQUEST", 422);
  const sources: PhotoSource[] = [];
  const seen = new Set<string>();
  for (const image of images) {
    if (!productIds.has(image.productId)) continue;
    const key = `${image.productId}:${image.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({ productId: image.productId, sourceUrl: image.url, sourceKey: photoSourceKey(image.productId, image.url, image.updatedAt) });
  }
  for (const product of products) {
    if (!product.photoUrl || seen.has(`${product.id}:${product.photoUrl}`)) continue;
    sources.push({ productId: product.id, sourceUrl: product.photoUrl, sourceKey: photoSourceKey(product.id, product.photoUrl, product.updatedAt) });
  }
  if (sources.length > limit)
    throw new AppError("photoSearchCatalogTooLarge", "BAD_REQUEST", 422);
  const productByKey = new Map(sources.map((source) => [source.sourceKey, source.productId]));
  const featureWhere = { organizationId: user.organizationId, modelVersion: productPhotoSearchModel, product: assortment };
  const selectFeature = { id: true, productId: true, sourceKey: true, status: true } as const;
  const featuresByKey = new Map<string, { id: string; productId: string; sourceKey: string; status: string }>();
  if (photoSearchStreamingEnabled() && sources.length) {
    const rows = await db.productPhotoFeature.findMany({ where: featureWhere, select: selectFeature, take: limit + 1 });
    if (rows.length <= limit) {
      for (const row of rows) if (productByKey.get(row.sourceKey) === row.productId) featuresByKey.set(row.sourceKey, row);
    } else {
      // More stored rows than the catalog bound can mean retired photo revisions.
      // Look up the exact keys in pages rather than using a truncated snapshot.
      await findCurrentFeatures();
    }
  } else {
    await findCurrentFeatures();
  }
  async function findCurrentFeatures() {
    for (let offset = 0; offset < sources.length; offset += 8_192) {
      const rows = await db.productPhotoFeature.findMany({
        where: { ...featureWhere, sourceKey: { in: sources.slice(offset, offset + 8_192).map(({ sourceKey }) => sourceKey) } },
        select: selectFeature,
      });
      for (const row of rows) if (productByKey.get(row.sourceKey) === row.productId) featuresByKey.set(row.sourceKey, row);
    }
  }
  const photoProducts = new Set(sources.map((source) => source.productId));
  const progress: ProductPhotoProgress = { total: sources.length, ready: 0, pending: 0, failed: 0, withoutPhoto: products.length - photoProducts.size };
  for (const source of sources) {
    const status = featuresByKey.get(source.sourceKey)?.status;
    if (status === "READY") progress.ready += 1;
    else if (status === "FAILED") progress.failed += 1;
    else progress.pending += 1;
  }
  const features = sources.flatMap(({ sourceKey }) => featuresByKey.has(sourceKey) ? [featuresByKey.get(sourceKey)!] : []);
  return { store, products, sources, features, progress };
}

export async function preparePhotoSearch(user: StoreAccessUser, storeId: string, retryFailed: boolean) {
  const scope = await loadPhotoSearchScope(user, storeId);
  const existing = new Set(scope.features.map((feature) => feature.sourceKey));
  const missing = scope.sources.filter((source) => !existing.has(source.sourceKey));
  const failed = retryFailed ? scope.features.filter((feature) => feature.status === "FAILED") : [];
  for (let offset = 0; offset < missing.length; offset += 1_000) {
    await prisma.productPhotoFeature.createMany({ data: missing.slice(offset, offset + 1_000).map((source) => ({
        organizationId: user.organizationId, ...source, modelVersion: productPhotoSearchModel,
      })), skipDuplicates: true });
  }
  for (let offset = 0; offset < failed.length; offset += 8_192) {
    await prisma.productPhotoFeature.updateMany({
      where: { organizationId: user.organizationId, id: { in: failed.slice(offset, offset + 8_192).map((feature) => feature.id) },
        status: "FAILED", updatedAt: { lt: new Date(Date.now() - 5000) } },
      data: { status: "PENDING", attempts: 0, retryAfter: new Date(), errorCode: null, leaseToken: null, leaseExpiresAt: null },
    });
  }
  return missing.length || failed.length ? (await loadPhotoSearchScope(user, storeId)).progress : scope.progress;
}
