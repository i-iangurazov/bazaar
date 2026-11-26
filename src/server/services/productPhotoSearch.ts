import sharp from "sharp";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { productPhotoSearchMaxBytes, productPhotoSearchMinScore, productPhotoSearchModel,
  type ProductPhotoSearchResult, type ProductPhotoAnalysis, type ProductPhotoRegion } from "@/lib/productPhotoSearch";
import { AppError } from "./errors";
import { prepareProductStudioSource } from "./productImageSourceUpload";
import { checkPreparedPhotoIndex, photoSearchIndexEnabled, photoSearchStreamingEnabled, photoSearchVectorPage,
  queryPreparedProductPhoto, queryProductPhoto, queryProductPhotoStream, type PreparedPhotoIndex } from "./productPhotoSearchEngine";
import { productPhotoIndexRevision } from "./productPhotoIndexRevision";
import { matchProductPhotoLabel } from "./productPhotoLabel";
import { assertPhotoStore, loadPhotoSearchScope, photoSearchStoreSelect, photoSourceKey, type PhotoSource } from "./productPhotoSearchScope";
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

type PhotoQueryInput = { user: StoreAccessUser; storeId: string; file: File; allowPartial: boolean; signal?: AbortSignal; region?: ProductPhotoRegion; autoRegion?: boolean };
type SourceRef = { id: string; productId: string; sourceKey: string };

export async function* readyVectorPages(input: Pick<PhotoQueryInput, "user" | "storeId" | "signal">, features: SourceRef[]) {
  for (let offset = 0; offset < features.length; offset += photoSearchVectorPage) {
    input.signal?.throwIfAborted();
    const page = features.slice(offset, offset + photoSearchVectorPage);
    // Avoid serializing every float as a JSON number across the Prisma boundary.
    const rows = await prisma.$queryRaw<(SourceRef & { embedding: Uint8Array })[]>`
      SELECT f.id, f."productId", f."sourceKey", pg_catalog.array_send(f.embedding) AS embedding
      FROM "ProductPhotoFeature" f
      JOIN "Product" p ON p.id = f."productId" AND p."organizationId" = f."organizationId"
      WHERE f.id IN (${Prisma.join(page.map(({ id }) => id))})
        AND f."organizationId" = ${input.user.organizationId}
        AND f.status = 'READY' AND f."modelVersion" = ${productPhotoSearchModel}
        AND NOT p."isDeleted"
        AND EXISTS (
          SELECT 1 FROM "StoreProduct" s
          WHERE s."productId" = p.id AND s."organizationId" = p."organizationId"
            AND s."storeId" = ${input.storeId} AND s."isActive" AND NOT s."isHidden"
        )
    `;
    const byId = new Map(rows.map((row) => [row.id, row]));
    yield page.map((feature) => {
      const row = byId.get(feature.id);
      if (row?.productId !== feature.productId || row.sourceKey !== feature.sourceKey)
        throw new AppError("photoSearchPreparing", "CONFLICT", 409);
      return row;
    });
  }
}

async function photoQuery(input: PhotoQueryInput) {
  const jpeg = await canonicalPhoto(input.file);
  if (input.region) {
    const { width, height } = await sharp(jpeg).metadata();
    if (!width || !height || input.region.width * width < 4 || input.region.height * height < 4)
      throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }
  return { jpeg, options: { region: input.region, autoRegion: input.autoRegion } };
}

const preparedProgress = ({ count, withoutPhoto }: PreparedPhotoIndex) => ({ total: count, ready: count, pending: 0, failed: 0, withoutPhoto });

export async function preparedPhotoSearchProgress(user: StoreAccessUser, storeId: string, signal?: AbortSignal) {
  if (!photoSearchIndexEnabled()) return null;
  const { organizationId } = user;
  const [index, revision] = await Promise.all([
    checkPreparedPhotoIndex({ organizationId, storeId }, signal), productPhotoIndexRevision(prisma, organizationId, storeId),
  ]);
  return index && index.revision === revision ? preparedProgress(index) : null;
}

export async function findPhotoCandidates(input: PhotoQueryInput) {
  let query: Awaited<ReturnType<typeof photoQuery>> | undefined;
  if (photoSearchIndexEnabled()) {
    await assertPhotoStore(input.user, input.storeId);
    const { user: { organizationId }, storeId } = input;
    query = await photoQuery(input);
    const [revision, prepared] = await Promise.all([
      productPhotoIndexRevision(prisma, organizationId, storeId),
      queryPreparedProductPhoto(query.jpeg, { organizationId, storeId }, input.signal, query.options),
    ]);
    if (prepared && prepared.index.revision === revision) return { prepared };
  }
  const scope = await loadPhotoSearchScope(input.user, input.storeId);
  if (scope.progress.pending && !input.allowPartial) throw new AppError("photoSearchPreparing", "CONFLICT", 409);
  if (!scope.progress.ready && scope.progress.failed) throw new AppError("photoSearchImagesFailed", "INTERNAL_SERVER_ERROR", 503);
  const current = new Map(scope.sources.map((source) => [source.sourceKey, source]));
  const features = scope.features.filter((feature) => feature.status === "READY");
  const { jpeg, options } = query ?? await photoQuery(input);
  if (photoSearchStreamingEnabled()) {
    const { matches, analysis } = await queryProductPhotoStream(jpeg, features.length, readyVectorPages(input, features), input.signal, options);
    return { candidates: matches.filter((match) => match.score >= productPhotoSearchMinScore).map((match) => features[match.index]), analysis };
  }
  const rows = features.length ? await prisma.productPhotoFeature.findMany({ where: {
    organizationId: input.user.organizationId, id: { in: features.map((feature) => feature.id) }, status: "READY",
  }, select: { productId: true, sourceKey: true, embedding: true } }) : [];
  const scopedRows = rows.filter((row) => current.get(row.sourceKey)?.productId === row.productId);
  const { matches, analysis } = await queryProductPhoto(jpeg, scopedRows, input.signal, options);
  // Experimental laboratory calibration. This ranks candidates, never proves SKU identity.
  return { candidates: matches.filter((match) => match.score >= productPhotoSearchMinScore).map((match) => scopedRows[match.index]), analysis };
}

/** Called after revalidating the session again, after inference. No stale prices or grants. */
export async function presentPhotoCandidates(user: StoreAccessUser, storeId: string, candidates: { productId: string; sourceKey: string }[], allowPartial: boolean, analysis?: ProductPhotoAnalysis): Promise<ProductPhotoSearchResult> {
  const scope = await loadPhotoSearchScope(user, storeId);
  if (scope.progress.pending && !allowPartial) throw new AppError("photoSearchPreparing", "CONFLICT", 409);
  return presentPhotoItems(prisma, user, storeId, scope, candidates, (productId) => {
    const ready = new Set(scope.features.filter((feature) => feature.status === "READY").map((feature) => feature.sourceKey));
    return scope.sources.find((source) => source.productId === productId && ready.has(source.sourceKey));
  }, analysis);
}

type PreparedSearchResult = NonNullable<Awaited<ReturnType<typeof queryPreparedProductPhoto>>>;

/** Validate the exact catalog revision again in the same read snapshot as the live results. */
export async function presentPreparedPhotoCandidates(user: StoreAccessUser, storeId: string, result: PreparedSearchResult) {
  const { organizationId } = user;
  return prisma.$transaction(async (db) => {
    await assertPhotoStore(user, storeId, db);
    if (await productPhotoIndexRevision(db, organizationId, storeId) !== result.index.revision)
      throw new AppError("photoSearchPreparing", "CONFLICT", 409);
    const assortment = { organizationId, isDeleted: false,
      storeProducts: { some: { organizationId, storeId, isActive: true, isHidden: false } } };
    const store = await db.store.findFirstOrThrow({ where: { id: storeId, organizationId }, select: photoSearchStoreSelect });
    const products = result.analysis.lines.some((line) => line.confidence >= 0.85)
      ? await db.product.findMany({ where: assortment, select: { id: true, name: true }, orderBy: { id: "asc" } }) : [];
    const features = result.sourceKeys.length ? await db.productPhotoFeature.findMany({ where: {
      organizationId, sourceKey: { in: result.sourceKeys }, status: "READY", modelVersion: productPhotoSearchModel, product: assortment,
    }, select: { sourceKey: true, productId: true, sourceUrl: true, product: { select: { updatedAt: true, photoUrl: true } } } }) : [];
    const images = features.length ? await db.productImage.findMany({ where: { organizationId,
      OR: features.map(({ productId, sourceUrl: url }) => ({ productId, url })) },
    select: { productId: true, url: true, updatedAt: true }, orderBy: [{ position: "asc" }, { id: "asc" }] }) : [];
    const sourceByKey = new Map<string, PhotoSource>();
    for (const { productId, sourceKey, sourceUrl, product } of features) {
      const image = images.find((row) => row.productId === productId && row.url === sourceUrl);
      const updatedAt = image?.updatedAt ?? (product.photoUrl === sourceUrl ? product.updatedAt : null);
      if (updatedAt && photoSourceKey(productId, sourceUrl, updatedAt) === sourceKey)
        sourceByKey.set(sourceKey, { productId, sourceKey, sourceUrl });
    }
    const sources = result.sourceKeys.flatMap((key) => sourceByKey.get(key) ?? []);
    return presentPhotoItems(db, user, storeId, { store, products, sources, progress: preparedProgress(result.index) }, sources,
      async (productId) => {
        const scope = await loadPhotoSearchScope(user, storeId, db, productId);
        const ready = new Set(scope.features.filter((feature) => feature.status === "READY").map((feature) => feature.sourceKey));
        return scope.sources.find(({ sourceKey }) => ready.has(sourceKey));
      }, result.analysis);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

type PhotoPresentationScope = Pick<Awaited<ReturnType<typeof loadPhotoSearchScope>>, "store" | "sources" | "progress"> & {
  products: { id: string; name: string }[];
};

async function presentPhotoItems(db: Prisma.TransactionClient, user: StoreAccessUser, storeId: string, scope: PhotoPresentationScope,
  candidates: { productId: string; sourceKey: string }[], textSource: (productId: string) => PhotoSource | undefined | Promise<PhotoSource | undefined>,
  analysis?: ProductPhotoAnalysis): Promise<ProductPhotoSearchResult> {
  const current = new Map(scope.sources.map((source) => [source.sourceKey, source]));
  const selected = candidates.filter((candidate) => current.get(candidate.sourceKey)?.productId === candidate.productId);
  const visualIds = new Set(selected.map((candidate) => candidate.productId));
  const text = analysis ? matchProductPhotoLabel(analysis, scope.products, [...visualIds]) : undefined;
  if (text?.textCandidateId) {
    const source = await textSource(text.textCandidateId);
    if (source) {
      current.set(source.sourceKey, source);
      selected.push(source);
    }
  }
  const ids = [...new Set(selected.map((candidate) => candidate.productId))];
  const [organization, products, prices, extras] = await Promise.all([
    db.organization.findUniqueOrThrow({ where: { id: user.organizationId }, select: { retailWholesaleEnabled: true } }),
    db.product.findMany({ where: { id: { in: ids }, organizationId: user.organizationId, isDeleted: false,
      storeProducts: { some: { organizationId: user.organizationId, storeId, isActive: true, isHidden: false } } },
      select: { id: true, name: true, sku: true, basePriceKgs: true,
        inventorySnapshots: { where: { storeId, store: { organizationId: user.organizationId } }, select: { onHand: true } } } }),
    db.storePrice.findMany({ where: { organizationId: user.organizationId, storeId, productId: { in: ids }, variantKey: "BASE" } }),
    db.storePriceTypes.findMany({ where: { organizationId: user.organizationId, storeId, productId: { in: ids }, variantKey: "BASE" } }),
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
  const checkedLabel = analysis ? matchProductPhotoLabel(analysis, scope.products.map((product) => ({ id: product.id, name: byId.get(product.id)?.name ?? product.name })), items.filter((item) => visualIds.has(item.id)).map((item) => item.id)) : undefined;
  // Recheck independent brand/model context too: adding a text candidate must not
  // turn it into visual evidence if its metadata changed during presentation.
  const label = checkedLabel?.textCandidateId && items.some((item) => item.id === checkedLabel.textCandidateId)
    ? { ...checkedLabel, status: "matched" as const, matchedIds: new Set([checkedLabel.textCandidateId]) } : checkedLabel;
  // Use current authorized metadata, even if a name or grant changed during inference.
  const ranked = label ? items.filter((item) => visualIds.has(item.id) || label.matchedIds.has(item.id)).map((item) => ({ ...item, labelMatched: label.matchedIds.has(item.id),
    matchSource: (visualIds.has(item.id) ? label.matchedIds.has(item.id) ? "photo-text" : "photo" : "text") as "photo" | "text" | "photo-text" }))
    .sort((a, b) => Number(b.labelMatched) - Number(a.labelMatched)) : items;
  return { storeId, currencyCode: scope.store.currencyCode, currencyRateKgsPerUnit: Number(scope.store.currencyRateKgsPerUnit),
    items: ranked.slice(0, 8), progress: scope.progress, partial: scope.progress.pending > 0 || scope.progress.failed > 0,
    ...(analysis && label ? { recognition: { regionSource: analysis.regionSource, region: analysis.region, labelStatus: label.status, text: label.text } } : {}) };
}
