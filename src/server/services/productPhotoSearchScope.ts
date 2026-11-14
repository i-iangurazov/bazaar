import { createHash } from "node:crypto";
import { prisma } from "@/server/db/prisma";
import { productPhotoSearchMaxImages, productPhotoSearchModel, type ProductPhotoProgress } from "@/lib/productPhotoSearch";
import { AppError } from "./errors";
import { assertUserCanAccessStore, type StoreAccessUser } from "./storeAccess";

export type PhotoSource = { productId: string; sourceKey: string; sourceUrl: string };
export const photoSourceKey = (productId: string, url: string, revision: Date) =>
  createHash("sha256").update(JSON.stringify([productId, url, revision.toISOString()])).digest("hex");

/** Bounded metadata only; never uses embeddings of another store or organization. */
export async function loadPhotoSearchScope(user: StoreAccessUser, storeId: string) {
  if (!storeId || storeId.length > 128) throw new AppError("invalidInput", "BAD_REQUEST", 400);
  await assertUserCanAccessStore(prisma, user, storeId);
  const store = await prisma.store.findFirstOrThrow({ where: { id: storeId, organizationId: user.organizationId },
    select: { id: true, name: true, enableSku: true, currencyCode: true, currencyRateKgsPerUnit: true } });
  const products = await prisma.product.findMany({
    where: { organizationId: user.organizationId, isDeleted: false,
      storeProducts: { some: { organizationId: user.organizationId, storeId, isActive: true, isHidden: false } } },
    select: { id: true, name: true, photoUrl: true, updatedAt: true }, orderBy: { id: "asc" }, take: productPhotoSearchMaxImages + 1,
  });
  if (products.length > productPhotoSearchMaxImages) throw new AppError("photoSearchCatalogTooLarge", "BAD_REQUEST", 422);
  const images = products.length ? await prisma.productImage.findMany({
    where: { organizationId: user.organizationId, productId: { in: products.map((product) => product.id) }, url: { not: "" } },
    select: { id: true, productId: true, url: true, updatedAt: true }, orderBy: [{ position: "asc" }, { id: "asc" }], take: productPhotoSearchMaxImages + 1,
  }) : [];
  const sources: PhotoSource[] = [];
  const seen = new Set<string>();
  for (const image of images) {
    const key = `${image.productId}:${image.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({ productId: image.productId, sourceUrl: image.url, sourceKey: photoSourceKey(image.productId, image.url, image.updatedAt) });
  }
  for (const product of products) {
    if (!product.photoUrl || seen.has(`${product.id}:${product.photoUrl}`)) continue;
    sources.push({ productId: product.id, sourceUrl: product.photoUrl, sourceKey: photoSourceKey(product.id, product.photoUrl, product.updatedAt) });
  }
  if (images.length > productPhotoSearchMaxImages || sources.length > productPhotoSearchMaxImages)
    throw new AppError("photoSearchCatalogTooLarge", "BAD_REQUEST", 422);
  const sourceKeys = new Set(sources.map((source) => source.sourceKey));
  const features = sources.length ? await prisma.productPhotoFeature.findMany({
    where: { organizationId: user.organizationId, modelVersion: productPhotoSearchModel,
      productId: { in: products.map((product) => product.id) }, sourceKey: { in: [...sourceKeys] } },
    select: { id: true, productId: true, sourceKey: true, status: true, updatedAt: true },
  }) : [];
  const featuresByKey = new Map(features.map((feature) => [feature.sourceKey, feature]));
  const photoProducts = new Set(sources.map((source) => source.productId));
  const progress: ProductPhotoProgress = { total: sources.length, ready: 0, pending: 0, failed: 0, withoutPhoto: products.length - photoProducts.size };
  for (const source of sources) {
    const status = featuresByKey.get(source.sourceKey)?.status;
    if (status === "READY") progress.ready += 1;
    else if (status === "FAILED") progress.failed += 1;
    else progress.pending += 1;
  }
  return { store, products, sources, features, progress };
}

export async function preparePhotoSearch(user: StoreAccessUser, storeId: string, retryFailed: boolean) {
  const scope = await loadPhotoSearchScope(user, storeId);
  if (scope.sources.length) {
    for (let offset = 0; offset < scope.sources.length; offset += 500) {
      await prisma.productPhotoFeature.createMany({ data: scope.sources.slice(offset, offset + 500).map((source) => ({
        organizationId: user.organizationId, ...source, modelVersion: productPhotoSearchModel,
      })), skipDuplicates: true });
    }
    if (retryFailed) await prisma.productPhotoFeature.updateMany({
      where: { organizationId: user.organizationId, id: { in: scope.features.filter((feature) => feature.status === "FAILED").map((feature) => feature.id) },
        status: "FAILED", updatedAt: { lt: new Date(Date.now() - 5000) } },
      data: { status: "PENDING", attempts: 0, retryAfter: new Date(), errorCode: null, leaseToken: null, leaseExpiresAt: null },
    });
  }
  return (await loadPhotoSearchScope(user, storeId)).progress;
}
