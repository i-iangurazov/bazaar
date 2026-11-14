import sharp from "sharp";
import { prisma } from "@/server/db/prisma";
import { productPhotoSearchMaxBytes, type ProductPhotoSearchResult } from "@/lib/productPhotoSearch";
import { AppError } from "./errors";
import { prepareProductStudioSource } from "./productImageSourceUpload";
import { matchProductPhoto } from "./productPhotoSearchEngine";
import { loadPhotoSearchScope } from "./productPhotoSearchScope";
import type { StoreAccessUser } from "./storeAccess";
import { resolveStoreSellingPrice } from "./storeSellingPrice";
import { getEffectiveProductPrice } from "./effectiveProductPrice";

export async function canonicalPhoto(file: File, maxBytes = productPhotoSearchMaxBytes) {
  if (!file.size || file.size > maxBytes)
    throw new AppError(file.size ? "imageTooLarge" : "imageInvalidType", "BAD_REQUEST", file.size ? 413 : 400);
  try {
    const source = await prepareProductStudioSource(file);
    return await sharp(source.buffer, { pages: 1, limitInputPixels: 40_000_000 }).rotate()
      .resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).flatten({ background: "white" })
      .jpeg({ quality: 90 }).toBuffer();
  } catch { throw new AppError("imageInvalidType", "BAD_REQUEST", 400); }
}

export async function findPhotoCandidates(input: { user: StoreAccessUser; storeId: string; file: File; allowPartial: boolean; signal?: AbortSignal }) {
  const scope = await loadPhotoSearchScope(input.user, input.storeId);
  if (scope.progress.pending && !input.allowPartial) throw new AppError("photoSearchPreparing", "CONFLICT", 409);
  if (!scope.progress.ready && scope.progress.failed) throw new AppError("photoSearchImagesFailed", "INTERNAL_SERVER_ERROR", 503);
  const current = new Map(scope.sources.map((source) => [source.sourceKey, source]));
  const features = scope.features.filter((feature) => feature.status === "READY");
  const rows = features.length ? await prisma.productPhotoFeature.findMany({ where: {
    organizationId: input.user.organizationId, id: { in: features.map((feature) => feature.id) }, status: "READY",
  }, select: { productId: true, sourceKey: true, embedding: true } }) : [];
  const scopedRows = rows.filter((row) => current.get(row.sourceKey)?.productId === row.productId);
  const jpeg = await canonicalPhoto(input.file);
  const matches = await matchProductPhoto(jpeg, scopedRows, input.signal);
  // Experimental laboratory calibration. This ranks candidates, never proves SKU identity.
  const threshold = 0.68;
  return matches.filter((match) => match.score >= threshold).map((match) => scopedRows[match.index]);
}

/** Called after revalidating the session again, after inference. No stale prices or grants. */
export async function presentPhotoCandidates(user: StoreAccessUser, storeId: string, candidates: { productId: string; sourceKey: string }[], allowPartial: boolean): Promise<ProductPhotoSearchResult> {
  const scope = await loadPhotoSearchScope(user, storeId);
  if (scope.progress.pending && !allowPartial) throw new AppError("photoSearchPreparing", "CONFLICT", 409);
  const current = new Map(scope.sources.map((source) => [source.sourceKey, source]));
  const selected = candidates.filter((candidate) => current.get(candidate.sourceKey)?.productId === candidate.productId);
  const ids = [...new Set(selected.map((candidate) => candidate.productId))];
  const [organization, products, prices, extras] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: user.organizationId }, select: { retailWholesaleEnabled: true } }),
    prisma.product.findMany({ where: { id: { in: ids }, organizationId: user.organizationId, isDeleted: false,
      storeProducts: { some: { organizationId: user.organizationId, storeId, isActive: true, isHidden: false } } },
      select: { id: true, name: true, sku: true, basePriceKgs: true,
        inventorySnapshots: { where: { storeId, store: { organizationId: user.organizationId } }, select: { onHand: true } } } }),
    prisma.storePrice.findMany({ where: { organizationId: user.organizationId, storeId, productId: { in: ids }, variantKey: "BASE" } }),
    prisma.storePriceTypes.findMany({ where: { organizationId: user.organizationId, storeId, productId: { in: ids }, variantKey: "BASE" } }),
  ]);
  const now = new Date();
  const byId = new Map(products.map((product) => [product.id, product]));
  const seen = new Set<string>();
  const items = selected.flatMap((candidate) => {
    const product = byId.get(candidate.productId);
    if (!product || seen.has(product.id)) return [];
    seen.add(product.id);
    const price = prices.find((row) => row.productId === product.id);
    const extra = extras.find((row) => row.productId === product.id);
    const amount = resolveStoreSellingPrice({ enabled: organization.retailWholesaleEnabled, mode: "RETAIL",
      standard: price?.priceKgs ?? product.basePriceKgs, retail: extra?.retailPriceKgs, wholesale: extra?.wholesalePriceKgs }).price;
    const effective = amount === null ? null : getEffectiveProductPrice({ basePrice: amount, currency: "KGS", now,
      discount: price?.discountType === "PERCENTAGE" && price.discountPercentage ? {
        type: "PERCENTAGE", percentage: price.discountPercentage, startsAt: price.discountStartsAt, endsAt: price.discountEndsAt,
      } : null }).effectivePrice.toNumber();
    const source = current.get(candidate.sourceKey)!;
    const imageUrl = source.sourceUrl.startsWith("/uploads/") || /^https?:\/\//i.test(source.sourceUrl) ? source.sourceUrl : null;
    return [{ id: product.id, name: product.name, sku: scope.store.enableSku ? product.sku : null,
      imageUrl, priceKgs: effective, onHand: product.inventorySnapshots.reduce((sum, snapshot) => sum + snapshot.onHand, 0) }];
  });
  return { storeId, currencyCode: scope.store.currencyCode, currencyRateKgsPerUnit: Number(scope.store.currencyRateKgsPerUnit),
    items, progress: scope.progress, partial: scope.progress.pending > 0 || scope.progress.failed > 0 };
}
