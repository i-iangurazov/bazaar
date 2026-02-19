import { randomUUID } from "node:crypto";
import type { AttributeType, Prisma } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { writeAuditLog } from "@/server/services/audit";
import { toJson } from "@/server/services/json";
import {
  resolveUniqueGeneratedBarcode,
  type BarcodeGenerationMode,
} from "@/server/services/barcodes";
import { recordFirstEvent } from "@/server/services/productEvents";
import { assertWithinLimits } from "@/server/services/planLimits";
import {
  ensureProductCategory,
  normalizeProductCategoryName,
} from "@/server/services/productCategories";
import {
  isManagedProductImageUrl,
  normalizeProductImageUrl,
  resolveProductImageUrl,
  type ResolveProductImageUrlResult,
} from "@/server/services/productImageStorage";

export type CreateProductInput = {
  organizationId: string;
  actorId: string;
  requestId: string;
  sku: string;
  name: string;
  category?: string | null;
  baseUnitId: string;
  basePriceKgs?: number | null;
  purchasePriceKgs?: number | null;
  avgCostKgs?: number | null;
  description?: string | null;
  photoUrl?: string | null;
  images?: {
    id?: string;
    url: string;
    position?: number;
  }[];
  supplierId?: string;
  barcodes?: string[];
  packs?: {
    id?: string;
    packName: string;
    packBarcode?: string | null;
    multiplierToBase: number;
    allowInPurchasing?: boolean | null;
    allowInReceiving?: boolean | null;
  }[];
  variants?: { id?: string; name?: string | null; sku?: string | null; attributes?: Record<string, unknown> }[];
  isBundle?: boolean;
  bundleComponents?: {
    componentProductId: string;
    componentVariantId?: string | null;
    qty: number;
  }[];
};

const upsertBaseProductCost = async (
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    productId: string;
    avgCostKgs: number;
  },
) => {
  const existing = await tx.productCost.findUnique({
    where: {
      organizationId_productId_variantKey: {
        organizationId: input.organizationId,
        productId: input.productId,
        variantKey: "BASE",
      },
    },
    select: { id: true, costBasisQty: true },
  });

  if (existing) {
    await tx.productCost.update({
      where: { id: existing.id },
      data: {
        avgCostKgs: input.avgCostKgs,
        costBasisQty: Math.max(existing.costBasisQty, 1),
      },
    });
    return;
  }

  await tx.productCost.create({
    data: {
      organizationId: input.organizationId,
      productId: input.productId,
      variantKey: "BASE",
      avgCostKgs: input.avgCostKgs,
      costBasisQty: 1,
    },
  });
};

const normalizeBarcodes = (barcodes?: string[]) => {
  if (!barcodes) {
    return [];
  }
  const cleaned = barcodes.map((value) => value.trim()).filter(Boolean);
  const unique = new Set(cleaned);
  if (unique.size !== cleaned.length) {
    throw new AppError("duplicateBarcode", "CONFLICT", 409);
  }
  return Array.from(unique);
};

const ensureBarcodesAvailable = async (
  tx: Prisma.TransactionClient,
  organizationId: string,
  barcodes: string[],
  excludeProductId?: string,
) => {
  if (!barcodes.length) {
    return;
  }
  const existing = await tx.productBarcode.findMany({
    where: {
      organizationId,
      value: { in: barcodes },
      ...(excludeProductId ? { productId: { not: excludeProductId } } : {}),
    },
    select: { value: true },
  });
  if (existing.length) {
    throw new AppError("barcodeExists", "CONFLICT", 409);
  }
};

const generateUniqueBarcodeValue = async (input: {
  tx: Prisma.TransactionClient;
  organizationId: string;
  mode: BarcodeGenerationMode;
}) => {
  try {
    return await resolveUniqueGeneratedBarcode({
      organizationId: input.organizationId,
      mode: input.mode,
      isTaken: async (value) => {
        const existing = await input.tx.productBarcode.findUnique({
          where: {
            organizationId_value: {
              organizationId: input.organizationId,
              value,
            },
          },
          select: { id: true },
        });
        return Boolean(existing);
      },
    });
  } catch {
    throw new AppError("barcodeGenerationFailed", "INTERNAL_SERVER_ERROR", 500);
  }
};

const ensureSupplier = async (
  tx: Prisma.TransactionClient,
  organizationId: string,
  supplierId?: string,
) => {
  if (!supplierId) {
    return;
  }
  const supplier = await tx.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier || supplier.organizationId !== organizationId) {
    throw new AppError("supplierNotFound", "NOT_FOUND", 404);
  }
};

const ensureUnit = async (
  tx: Prisma.TransactionClient,
  organizationId: string,
  baseUnitId: string,
) => {
  const unit = await tx.unit.findUnique({ where: { id: baseUnitId } });
  if (!unit || unit.organizationId !== organizationId) {
    throw new AppError("unitNotFound", "NOT_FOUND", 404);
  }
  return unit;
};

const ensureUnitByCode = async (
  tx: Prisma.TransactionClient,
  organizationId: string,
  code: string,
) =>
  tx.unit.upsert({
    where: { organizationId_code: { organizationId, code } },
    update: { labelRu: code, labelKg: code },
    create: { organizationId, code, labelRu: code, labelKg: code },
  });

const normalizeImportPhotoUrl = normalizeProductImageUrl;

const resolveRemoteImportPhotoUrl = async (
  value: string,
  organizationId: string | undefined,
  cache: Map<string, ResolveProductImageUrlResult>,
) => {
  if (!organizationId) {
    return value;
  }

  const resolved = await resolveProductImageUrl({
    value,
    organizationId,
    cache,
  });

  if (!resolved.url) {
    return value;
  }

  return resolved.url;
};

const normalizePacks = (
  packs?: CreateProductInput["packs"],
) => {
  if (!packs) {
    return [];
  }
  const cleaned = packs
    .map((pack) => ({
      id: pack.id,
      packName: pack.packName.trim(),
      packBarcode: pack.packBarcode?.trim() || null,
      multiplierToBase: Math.trunc(pack.multiplierToBase),
      allowInPurchasing: pack.allowInPurchasing ?? true,
      allowInReceiving: pack.allowInReceiving ?? true,
    }))
    .filter((pack) => pack.packName.length > 0);

  const names = cleaned.map((pack) => pack.packName);
  if (new Set(names).size !== names.length) {
    throw new AppError("packNameDuplicate", "CONFLICT", 409);
  }

  const barcodes = cleaned.map((pack) => pack.packBarcode).filter(Boolean) as string[];
  if (new Set(barcodes).size !== barcodes.length) {
    throw new AppError("packBarcodeDuplicate", "CONFLICT", 409);
  }

  cleaned.forEach((pack) => {
    if (!Number.isFinite(pack.multiplierToBase) || pack.multiplierToBase <= 0) {
      throw new AppError("packMultiplierInvalid", "BAD_REQUEST", 400);
    }
  });

  return cleaned;
};

const normalizeBundleComponents = (
  components?: CreateProductInput["bundleComponents"],
) => {
  if (!components) {
    return [];
  }
  const normalized = components
    .map((component) => ({
      componentProductId: component.componentProductId.trim(),
      componentVariantId: component.componentVariantId?.trim() || null,
      qty: Math.trunc(component.qty),
    }))
    .filter((component) => component.componentProductId.length > 0);

  const keys = normalized.map(
    (component) =>
      `${component.componentProductId}:${component.componentVariantId ?? "BASE"}`,
  );
  if (new Set(keys).size !== keys.length) {
    throw new AppError("bundleComponentDuplicate", "CONFLICT", 409);
  }
  for (const component of normalized) {
    if (!Number.isFinite(component.qty) || component.qty <= 0) {
      throw new AppError("bundleQtyPositive", "BAD_REQUEST", 400);
    }
  }
  return normalized;
};

const syncBundleComponents = async (
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    productId: string;
    components?: CreateProductInput["bundleComponents"];
    mode: "replace" | "create-only";
  },
) => {
  const normalized = normalizeBundleComponents(input.components);
  if (!normalized.length) {
    if (input.mode === "replace") {
      await tx.productBundleComponent.deleteMany({ where: { bundleProductId: input.productId } });
    }
    return;
  }

  const componentProductIds = Array.from(
    new Set(normalized.map((component) => component.componentProductId)),
  );
  const products = await tx.product.findMany({
    where: {
      id: { in: componentProductIds },
      organizationId: input.organizationId,
      isDeleted: false,
    },
    select: { id: true },
  });
  const validIds = new Set(products.map((product) => product.id));
  for (const component of normalized) {
    if (!validIds.has(component.componentProductId)) {
      throw new AppError("productNotFound", "NOT_FOUND", 404);
    }
    if (component.componentProductId === input.productId) {
      throw new AppError("bundleComponentInvalid", "BAD_REQUEST", 400);
    }
  }

  const componentVariantIds = normalized
    .map((component) => component.componentVariantId)
    .filter((value): value is string => Boolean(value));
  if (componentVariantIds.length) {
    const variants = await tx.productVariant.findMany({
      where: { id: { in: componentVariantIds }, isActive: true },
      select: { id: true, productId: true },
    });
    const variantMap = new Map(variants.map((variant) => [variant.id, variant]));
    for (const component of normalized) {
      if (!component.componentVariantId) {
        continue;
      }
      const variant = variantMap.get(component.componentVariantId);
      if (!variant || variant.productId !== component.componentProductId) {
        throw new AppError("variantNotFound", "NOT_FOUND", 404);
      }
    }
  }

  if (input.mode === "replace") {
    await tx.productBundleComponent.deleteMany({ where: { bundleProductId: input.productId } });
  }

  await tx.productBundleComponent.createMany({
    data: normalized.map((component) => ({
      organizationId: input.organizationId,
      bundleProductId: input.productId,
      componentProductId: component.componentProductId,
      componentVariantId: component.componentVariantId,
      qty: component.qty,
    })),
  });
};

type NormalizedImage = {
  id?: string;
  url: string;
  position: number;
};

const normalizeImages = (
  images?: CreateProductInput["images"],
): NormalizedImage[] => {
  if (!images) {
    return [];
  }
  const cleaned = images
    .map((image, index) => ({
      id: image.id,
      url: image.url.trim(),
      position:
        typeof image.position === "number" && Number.isFinite(image.position)
          ? Math.trunc(image.position)
          : index,
    }))
    .filter((image) => image.url.length > 0)
    .sort((a, b) => a.position - b.position)
    .map((image, index) => ({ ...image, position: index }));
  return cleaned;
};

const ensurePackBarcodesAvailable = async (
  tx: Prisma.TransactionClient,
  organizationId: string,
  packBarcodes: string[],
  excludeProductId?: string,
) => {
  if (!packBarcodes.length) {
    return;
  }
  const [existingPacks, existingBarcodes] = await Promise.all([
    tx.productPack.findMany({
      where: {
        organizationId,
        packBarcode: { in: packBarcodes },
        ...(excludeProductId ? { productId: { not: excludeProductId } } : {}),
      },
      select: { packBarcode: true },
    }),
    tx.productBarcode.findMany({
      where: {
        organizationId,
        value: { in: packBarcodes },
        ...(excludeProductId ? { productId: { not: excludeProductId } } : {}),
      },
      select: { value: true },
    }),
  ]);
  if (existingPacks.length || existingBarcodes.length) {
    throw new AppError("packBarcodeExists", "CONFLICT", 409);
  }
};

const syncProductPacks = async (
  tx: Prisma.TransactionClient,
  organizationId: string,
  productId: string,
  packs?: CreateProductInput["packs"],
) => {
  if (!packs) {
    return;
  }
  const normalized = normalizePacks(packs);
  const packBarcodes = normalized
    .map((pack) => pack.packBarcode)
    .filter(Boolean) as string[];
  await ensurePackBarcodesAvailable(tx, organizationId, packBarcodes, productId);

  await tx.productPack.deleteMany({ where: { productId } });
  if (!normalized.length) {
    return;
  }
  await tx.productPack.createMany({
    data: normalized.map((pack) => ({
      organizationId,
      productId,
      packName: pack.packName,
      packBarcode: pack.packBarcode,
      multiplierToBase: pack.multiplierToBase,
      allowInPurchasing: pack.allowInPurchasing ?? true,
      allowInReceiving: pack.allowInReceiving ?? true,
    })),
  });
};

type AttributeDefinitionRow = {
  key: string;
  type: AttributeType;
  required: boolean;
  optionsRu: Prisma.JsonValue | null;
  optionsKg: Prisma.JsonValue | null;
};

const loadAttributeDefinitions = async (
  tx: Prisma.TransactionClient,
  organizationId: string,
) =>
  tx.attributeDefinition.findMany({
    where: { organizationId, isActive: true },
    select: { key: true, type: true, required: true, optionsRu: true, optionsKg: true },
  });

const hasAttributeValue = (value: unknown, type: AttributeType) => {
  if (value === null || value === undefined) {
    return false;
  }
  if (type === "MULTI_SELECT") {
    return Array.isArray(value) && value.length > 0;
  }
  if (type === "NUMBER") {
    return Number.isFinite(typeof value === "number" ? value : Number(value));
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return true;
};

const ensureRequiredAttributes = (
  variants: CreateProductInput["variants"],
  definitions: AttributeDefinitionRow[],
) => {
  if (!variants?.length) {
    return;
  }
  const required = definitions.filter((definition) => definition.required);
  if (!required.length) {
    return;
  }
  for (const variant of variants) {
    const attributes = variant.attributes ?? {};
    for (const definition of required) {
      if (!hasAttributeValue(attributes[definition.key], definition.type)) {
        throw new AppError("attributeRequired", "BAD_REQUEST", 400);
      }
    }
  }
};

const syncVariantAttributeValues = async (
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    productId: string;
    variantId: string;
    attributes?: Record<string, unknown>;
  },
  definitionMap: Map<string, AttributeDefinitionRow>,
) => {
  const entries = Object.entries(input.attributes ?? {}).filter(([key, value]) => {
    if (!definitionMap.has(key)) {
      return false;
    }
    if (value === null || value === undefined) {
      return false;
    }
    if (typeof value === "string") {
      return value.trim().length > 0;
    }
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    return true;
  });

  if (!entries.length) {
    return;
  }

  await tx.variantAttributeValue.createMany({
    data: entries.map(([key, value]) => ({
      organizationId: input.organizationId,
      productId: input.productId,
      variantId: input.variantId,
      key,
      value: toJson(value),
    })),
    skipDuplicates: true,
  });
};

const createVariants = async (
  tx: Prisma.TransactionClient,
  productId: string,
  variants: CreateProductInput["variants"],
  organizationId: string,
  definitions: AttributeDefinitionRow[],
) => {
  if (!variants?.length) {
    return [];
  }
  const definitionMap = new Map<string, AttributeDefinitionRow>(
    definitions.map((definition: AttributeDefinitionRow) => [definition.key, definition]),
  );
  return Promise.all(
    variants.map(async (variant) => {
      const created = await tx.productVariant.create({
        data: {
          productId,
          name: variant.name ?? null,
          sku: variant.sku ?? null,
          attributes: toJson(variant.attributes ?? {}),
        },
      });

      await syncVariantAttributeValues(
        tx,
        {
          organizationId,
          productId,
          variantId: created.id,
          attributes: variant.attributes ?? {},
        },
        definitionMap,
      );

      return created;
    }),
  );
};

const ensureBaseSnapshots = async (
  tx: Prisma.TransactionClient,
  organizationId: string,
  productId: string,
  stores?: { id: string; allowNegativeStock: boolean }[],
) => {
  const resolvedStores =
    stores ??
    (await tx.store.findMany({
      where: { organizationId },
      select: { id: true, allowNegativeStock: true },
    }));

  if (!resolvedStores.length) {
    return;
  }

  await tx.inventorySnapshot.createMany({
    data: resolvedStores.map((store) => ({
      storeId: store.id,
      productId,
      variantKey: "BASE",
      onHand: 0,
      onOrder: 0,
      allowNegativeStock: store.allowNegativeStock,
    })),
    skipDuplicates: true,
  });
};

const syncProductImages = async (
  tx: Prisma.TransactionClient,
  organizationId: string,
  productId: string,
  normalizedImages: NormalizedImage[],
) => {
  await tx.productImage.deleteMany({ where: { productId } });
  if (!normalizedImages.length) {
    return;
  }
  await tx.productImage.createMany({
    data: normalizedImages.map((image) => ({
      organizationId,
      productId,
      url: image.url,
      position: image.position,
    })),
  });
};

const resolveIncomingProductImages = async (input: {
  organizationId: string;
  productId?: string | null;
  photoUrl?: string | null;
  images?: CreateProductInput["images"];
}) => {
  const cache = new Map<string, ResolveProductImageUrlResult>();
  const normalizedImages = normalizeImages(input.images);
  const resolvedImages: NormalizedImage[] = [];

  for (const image of normalizedImages) {
    const resolved = await resolveProductImageUrl({
      value: image.url,
      organizationId: input.organizationId,
      productId: input.productId,
      cache,
    });
    if (!resolved.url) {
      continue;
    }
    resolvedImages.push({ ...image, url: resolved.url });
  }

  const explicitPhotoResolved =
    input.photoUrl !== undefined
      ? await resolveProductImageUrl({
          value: input.photoUrl,
          organizationId: input.organizationId,
          productId: input.productId,
          cache,
        })
      : undefined;

  const resolvedPhotoUrl =
    explicitPhotoResolved?.url ??
    (resolvedImages.length ? resolvedImages[0].url : null);

  if (!resolvedImages.length && resolvedPhotoUrl) {
    resolvedImages.push({ id: undefined, url: resolvedPhotoUrl, position: 0 });
  }

  return {
    images: resolvedImages,
    photoUrl: resolvedPhotoUrl,
  };
};

export const createProduct = async (input: CreateProductInput) => {
  const productId = randomUUID();
  const resolvedMedia = await resolveIncomingProductImages({
    organizationId: input.organizationId,
    productId,
    photoUrl: input.photoUrl,
    images: input.images,
  });
  const normalizedBundleComponents = normalizeBundleComponents(input.bundleComponents);
  const resolvedBaseCost =
    input.avgCostKgs !== undefined && input.avgCostKgs !== null
      ? input.avgCostKgs
      : input.purchasePriceKgs !== undefined && input.purchasePriceKgs !== null
        ? input.purchasePriceKgs
        : undefined;

  return prisma.$transaction(async (tx) => {
    await assertWithinLimits({ organizationId: input.organizationId, kind: "products" });
    await ensureSupplier(tx, input.organizationId, input.supplierId);
    const baseUnit = await ensureUnit(tx, input.organizationId, input.baseUnitId);
    const attributeDefinitions = await loadAttributeDefinitions(tx, input.organizationId);
    ensureRequiredAttributes(input.variants, attributeDefinitions);
    const barcodes = normalizeBarcodes(input.barcodes);
    await ensureBarcodesAvailable(tx, input.organizationId, barcodes);
    const normalizedPacks = normalizePacks(input.packs);
    const packBarcodes = normalizedPacks
      .map((pack) => pack.packBarcode)
      .filter(Boolean) as string[];
    await ensurePackBarcodesAvailable(tx, input.organizationId, packBarcodes);
    const normalizedImages = resolvedMedia.images;
    const normalizedCategory = normalizeProductCategoryName(input.category);
    if (normalizedCategory) {
      await ensureProductCategory(tx, {
        organizationId: input.organizationId,
        name: normalizedCategory,
      });
    }
    if (input.isBundle && normalizedBundleComponents.length < 1) {
      throw new AppError("bundleEmpty", "BAD_REQUEST", 400);
    }

    const product = await tx.product.create({
      data: {
        id: productId,
        organizationId: input.organizationId,
        sku: input.sku,
        name: input.name,
        category: normalizedCategory,
        unit: baseUnit.code,
        baseUnitId: baseUnit.id,
        basePriceKgs: input.basePriceKgs ?? null,
        description: input.description ?? null,
        photoUrl: resolvedMedia.photoUrl,
        supplierId: input.supplierId,
        isBundle: Boolean(input.isBundle),
        barcodes: barcodes.length
          ? {
              create: barcodes.map((value) => ({
                organizationId: input.organizationId,
                value,
              })),
            }
          : undefined,
      },
    });

    if (normalizedPacks.length) {
      await tx.productPack.createMany({
        data: normalizedPacks.map((pack) => ({
          organizationId: input.organizationId,
          productId: product.id,
          packName: pack.packName,
          packBarcode: pack.packBarcode,
          multiplierToBase: pack.multiplierToBase,
          allowInPurchasing: pack.allowInPurchasing ?? true,
          allowInReceiving: pack.allowInReceiving ?? true,
        })),
      });
    }

    if (normalizedImages.length) {
      await tx.productImage.createMany({
        data: normalizedImages.map((image) => ({
          organizationId: input.organizationId,
          productId: product.id,
          url: image.url,
          position: image.position,
        })),
      });
    }

    await createVariants(tx, product.id, input.variants, input.organizationId, attributeDefinitions);
    if (normalizedBundleComponents.length) {
      await syncBundleComponents(tx, {
        organizationId: input.organizationId,
        productId: product.id,
        components: normalizedBundleComponents,
        mode: "create-only",
      });
    }
    await ensureBaseSnapshots(tx, input.organizationId, product.id);
    if (resolvedBaseCost !== undefined) {
      await upsertBaseProductCost(tx, {
        organizationId: input.organizationId,
        productId: product.id,
        avgCostKgs: resolvedBaseCost,
      });
    }

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "PRODUCT_CREATE",
      entity: "Product",
      entityId: product.id,
      before: null,
      after: toJson(product),
      requestId: input.requestId,
    });

    await recordFirstEvent({
      organizationId: input.organizationId,
      actorId: input.actorId,
      type: "first_product_created",
      metadata: { productId: product.id },
    });

    return product;
  });
};

export type UpdateProductInput = {
  productId: string;
  organizationId: string;
  actorId: string;
  requestId: string;
  sku: string;
  name: string;
  category?: string | null;
  baseUnitId: string;
  basePriceKgs?: number | null;
  purchasePriceKgs?: number | null;
  avgCostKgs?: number | null;
  description?: string | null;
  photoUrl?: string | null;
  images?: CreateProductInput["images"];
  supplierId?: string | null;
  barcodes?: string[];
  packs?: CreateProductInput["packs"];
  variants?: { id?: string; name?: string | null; sku?: string | null; attributes?: Record<string, unknown> }[];
  isBundle?: boolean;
  bundleComponents?: CreateProductInput["bundleComponents"];
};

export const updateProduct = async (input: UpdateProductInput) => {
  const resolvedMedia = await resolveIncomingProductImages({
    organizationId: input.organizationId,
    productId: input.productId,
    photoUrl: input.photoUrl,
    images: input.images,
  });
  const normalizedBundleComponents =
    input.bundleComponents !== undefined ? normalizeBundleComponents(input.bundleComponents) : undefined;
  const resolvedBaseCost =
    input.avgCostKgs !== undefined && input.avgCostKgs !== null
      ? input.avgCostKgs
      : input.purchasePriceKgs !== undefined && input.purchasePriceKgs !== null
        ? input.purchasePriceKgs
        : undefined;

  return prisma.$transaction(async (tx) => {
    const before = await tx.product.findUnique({ where: { id: input.productId } });
    if (!before || before.organizationId !== input.organizationId) {
      throw new AppError("productNotFound", "NOT_FOUND", 404);
    }

    await ensureSupplier(tx, input.organizationId, input.supplierId ?? undefined);
    const baseUnit = await ensureUnit(tx, input.organizationId, input.baseUnitId);
    const attributeDefinitions = await loadAttributeDefinitions(tx, input.organizationId);
    ensureRequiredAttributes(input.variants, attributeDefinitions);
    const barcodes = normalizeBarcodes(input.barcodes);
    await ensureBarcodesAvailable(tx, input.organizationId, barcodes, input.productId);
    if (before.baseUnitId !== baseUnit.id) {
      const movementCount = await tx.stockMovement.count({
        where: { productId: input.productId },
      });
      if (movementCount > 0) {
        throw new AppError("unitChangeNotAllowed", "CONFLICT", 409);
      }
    }

    const normalizedImages = input.images ? resolvedMedia.images : undefined;
    const normalizedCategory = normalizeProductCategoryName(input.category);
    if (normalizedCategory) {
      await ensureProductCategory(tx, {
        organizationId: input.organizationId,
        name: normalizedCategory,
      });
    }
    const nextIsBundle = input.isBundle ?? before.isBundle;
    if (
      nextIsBundle &&
      !before.isBundle &&
      normalizedBundleComponents !== undefined &&
      normalizedBundleComponents.length < 1
    ) {
      throw new AppError("bundleEmpty", "BAD_REQUEST", 400);
    }
    const product = await tx.product.update({
      where: { id: input.productId },
      data: {
        sku: input.sku,
        name: input.name,
        category: normalizedCategory,
        unit: baseUnit.code,
        baseUnitId: baseUnit.id,
        basePriceKgs: input.basePriceKgs ?? null,
        description: input.description ?? null,
        photoUrl:
          resolvedMedia.photoUrl ??
          (normalizedImages?.length ? normalizedImages[0].url : null),
        supplierId: input.supplierId ?? null,
        isBundle: nextIsBundle,
      },
    });

    await tx.productBarcode.deleteMany({ where: { productId: input.productId } });
    if (barcodes.length) {
      await tx.productBarcode.createMany({
        data: barcodes.map((value) => ({
          organizationId: input.organizationId,
          productId: input.productId,
          value,
        })),
      });
    }

    await syncProductPacks(tx, input.organizationId, input.productId, input.packs);
    if (normalizedImages) {
      await syncProductImages(tx, input.organizationId, input.productId, normalizedImages);
    }

    if (input.variants) {
      const incomingIds = new Set(
        input.variants.map((variant) => variant.id).filter(Boolean) as string[],
      );
      const existingVariants = await tx.productVariant.findMany({
        where: { productId: input.productId, isActive: true },
        select: { id: true },
      });
      const removedIds = existingVariants
        .map((variant) => variant.id)
        .filter((id) => !incomingIds.has(id));

      if (removedIds.length) {
        const [movementCount, snapshotCount, lineCount] = await Promise.all([
          tx.stockMovement.count({ where: { variantId: { in: removedIds } } }),
          tx.inventorySnapshot.count({
            where: {
              variantId: { in: removedIds },
              OR: [{ onHand: { not: 0 } }, { onOrder: { not: 0 } }],
            },
          }),
          tx.purchaseOrderLine.count({ where: { variantId: { in: removedIds } } }),
        ]);

        if (movementCount > 0 || snapshotCount > 0 || lineCount > 0) {
          throw new AppError("variantInUse", "CONFLICT", 409);
        }

        await tx.productVariant.updateMany({
          where: { id: { in: removedIds } },
          data: { isActive: false },
        });
        await tx.variantAttributeValue.deleteMany({
          where: { variantId: { in: removedIds } },
        });
      }

      const definitionMap = new Map<string, AttributeDefinitionRow>(
        attributeDefinitions.map((definition: AttributeDefinitionRow) => [
          definition.key,
          definition,
        ]),
      );
      for (const variant of input.variants) {
        if (variant.id) {
          await tx.productVariant.updateMany({
            where: { id: variant.id, productId: input.productId },
            data: {
              name: variant.name ?? null,
              sku: variant.sku ?? null,
              attributes: toJson(variant.attributes ?? {}),
              isActive: true,
            },
          });
          await tx.variantAttributeValue.deleteMany({
            where: { variantId: variant.id },
          });
          await syncVariantAttributeValues(
            tx,
            {
              organizationId: input.organizationId,
              productId: input.productId,
              variantId: variant.id,
              attributes: variant.attributes ?? {},
            },
            definitionMap,
          );
        } else {
          const createdVariant = await tx.productVariant.create({
            data: {
              productId: input.productId,
              name: variant.name ?? null,
              sku: variant.sku ?? null,
              attributes: toJson(variant.attributes ?? {}),
            },
          });
          await syncVariantAttributeValues(
            tx,
            {
              organizationId: input.organizationId,
              productId: input.productId,
              variantId: createdVariant.id,
              attributes: variant.attributes ?? {},
            },
            definitionMap,
          );
        }
      }
    }

    if (!nextIsBundle) {
      await tx.productBundleComponent.deleteMany({ where: { bundleProductId: input.productId } });
    } else if (normalizedBundleComponents !== undefined) {
      if (normalizedBundleComponents.length < 1) {
        throw new AppError("bundleEmpty", "BAD_REQUEST", 400);
      }
      await syncBundleComponents(tx, {
        organizationId: input.organizationId,
        productId: input.productId,
        components: normalizedBundleComponents,
        mode: "replace",
      });
    }

    if (resolvedBaseCost !== undefined) {
      await upsertBaseProductCost(tx, {
        organizationId: input.organizationId,
        productId: input.productId,
        avgCostKgs: resolvedBaseCost,
      });
    }

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "PRODUCT_UPDATE",
      entity: "Product",
      entityId: product.id,
      before: toJson(before),
      after: toJson(product),
      requestId: input.requestId,
    });

    return product;
  });
};

const resolveDuplicateSku = async (
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    sourceSku: string;
    requestedSku?: string | null;
  },
) => {
  const requested = input.requestedSku?.trim();
  if (requested) {
    const exists = await tx.product.findFirst({
      where: {
        organizationId: input.organizationId,
        sku: requested,
      },
      select: { id: true },
    });
    if (exists) {
      throw new AppError("uniqueConstraintViolation", "CONFLICT", 409);
    }
    return requested;
  }

  const base = `${input.sourceSku}-COPY`;
  let suffix = 1;
  for (;;) {
    const candidate = suffix === 1 ? base : `${base}-${suffix}`;
    const exists = await tx.product.findFirst({
      where: {
        organizationId: input.organizationId,
        sku: candidate,
      },
      select: { id: true },
    });
    if (!exists) {
      return candidate;
    }
    suffix += 1;
    if (suffix > 5000) {
      throw new AppError("unexpectedError", "INTERNAL_SERVER_ERROR", 500);
    }
  }
};

export const duplicateProduct = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  productId: string;
  sku?: string | null;
}) => {
  return prisma.$transaction(async (tx) => {
    await assertWithinLimits({ organizationId: input.organizationId, kind: "products" });

    const source = await tx.product.findUnique({
      where: { id: input.productId },
      include: {
        packs: true,
        images: true,
        variants: {
          where: { isActive: true },
          select: {
            name: true,
            sku: true,
            attributes: true,
          },
        },
        bundleComponents: {
          select: {
            componentProductId: true,
            componentVariantId: true,
            qty: true,
          },
        },
      },
    });

    if (!source || source.organizationId !== input.organizationId) {
      throw new AppError("productNotFound", "NOT_FOUND", 404);
    }

    const nextSku = await resolveDuplicateSku(tx, {
      organizationId: input.organizationId,
      sourceSku: source.sku,
      requestedSku: input.sku,
    });

    const duplicate = await tx.product.create({
      data: {
        organizationId: input.organizationId,
        supplierId: source.supplierId,
        sku: nextSku,
        name: source.name,
        category: source.category,
        unit: source.unit,
        baseUnitId: source.baseUnitId,
        basePriceKgs: source.basePriceKgs,
        description: source.description,
        photoUrl: source.photoUrl,
        isBundle: source.isBundle,
      },
    });

    if (source.images.length) {
      await tx.productImage.createMany({
        data: source.images.map((image) => ({
          organizationId: input.organizationId,
          productId: duplicate.id,
          url: image.url,
          position: image.position,
        })),
      });
    }

    if (source.packs.length) {
      await tx.productPack.createMany({
        data: source.packs.map((pack) => ({
          organizationId: input.organizationId,
          productId: duplicate.id,
          packName: pack.packName,
          packBarcode: null,
          multiplierToBase: pack.multiplierToBase,
          allowInPurchasing: pack.allowInPurchasing,
          allowInReceiving: pack.allowInReceiving,
        })),
      });
    }

    const attributeDefinitions = await loadAttributeDefinitions(tx, input.organizationId);
    if (source.variants.length) {
      await createVariants(
        tx,
        duplicate.id,
        source.variants.map((variant) => ({
          name: variant.name,
          sku: variant.sku,
          attributes:
            variant.attributes && typeof variant.attributes === "object"
              ? (variant.attributes as Record<string, unknown>)
              : {},
        })),
        input.organizationId,
        attributeDefinitions,
      );
    }

    if (source.isBundle && source.bundleComponents.length) {
      await syncBundleComponents(tx, {
        organizationId: input.organizationId,
        productId: duplicate.id,
        components: source.bundleComponents.map((component) => ({
          componentProductId: component.componentProductId,
          componentVariantId: component.componentVariantId,
          qty: component.qty,
        })),
        mode: "create-only",
      });
    }

    await ensureBaseSnapshots(tx, input.organizationId, duplicate.id);

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "PRODUCT_CREATE",
      entity: "Product",
      entityId: duplicate.id,
      before: toJson({ sourceProductId: source.id }),
      after: toJson(duplicate),
      requestId: input.requestId,
    });

    return {
      productId: duplicate.id,
      sku: duplicate.sku,
      copiedBarcodes: false,
    };
  });
};

export const generateProductBarcode = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  productId: string;
  mode: BarcodeGenerationMode;
  force?: boolean;
}) =>
  prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id: input.productId },
      select: {
        id: true,
        organizationId: true,
        isDeleted: true,
        barcodes: {
          orderBy: { createdAt: "asc" },
          select: { value: true },
        },
      },
    });
    if (!product || product.organizationId !== input.organizationId || product.isDeleted) {
      throw new AppError("productNotFound", "NOT_FOUND", 404);
    }

    const beforeValues = product.barcodes.map((barcode) => barcode.value);
    if (beforeValues.length > 0 && !input.force) {
      throw new AppError("productBarcodeExists", "CONFLICT", 409);
    }
    if (beforeValues.length > 0 && input.force) {
      await tx.productBarcode.deleteMany({
        where: {
          organizationId: input.organizationId,
          productId: input.productId,
        },
      });
    }

    const value = await generateUniqueBarcodeValue({
      tx,
      organizationId: input.organizationId,
      mode: input.mode,
    });
    await tx.productBarcode.create({
      data: {
        organizationId: input.organizationId,
        productId: input.productId,
        value,
      },
    });

    const barcodes = [value];
    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "PRODUCT_UPDATE",
      entity: "Product",
      entityId: product.id,
      before: toJson({ barcodes: beforeValues }),
      after: toJson({ barcodes, generated: true, mode: input.mode }),
      requestId: input.requestId,
    });

    return {
      productId: product.id,
      value,
      mode: input.mode,
      barcodes,
    };
  });

type ProductBulkGenerationFilter = {
  productIds?: string[];
  search?: string;
  category?: string | null;
  type?: "all" | "product" | "bundle";
  includeArchived?: boolean;
  storeId?: string | null;
  limit?: number;
};

export const bulkGenerateProductBarcodes = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  mode: BarcodeGenerationMode;
  filter?: ProductBulkGenerationFilter;
}) =>
  prisma.$transaction(async (tx) => {
    const productIds =
      input.filter?.productIds?.map((value) => value.trim()).filter(Boolean) ?? [];
    const uniqueProductIds = Array.from(new Set(productIds));
    const search = input.filter?.search?.trim();
    const category = input.filter?.category?.trim();
    const limit = Math.min(Math.max(input.filter?.limit ?? 500, 1), 5_000);

    if (input.filter?.storeId) {
      const store = await tx.store.findUnique({
        where: { id: input.filter.storeId },
        select: { id: true, organizationId: true },
      });
      if (!store || store.organizationId !== input.organizationId) {
        throw new AppError("storeAccessDenied", "FORBIDDEN", 403);
      }
    }

    const where: Prisma.ProductWhereInput = {
      organizationId: input.organizationId,
      ...(input.filter?.includeArchived ? {} : { isDeleted: false }),
      ...(uniqueProductIds.length ? { id: { in: uniqueProductIds } } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { sku: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(category ? { category } : {}),
      ...(input.filter?.type === "product"
        ? { isBundle: false }
        : input.filter?.type === "bundle"
          ? { isBundle: true }
          : {}),
      ...(input.filter?.storeId
        ? {
            inventorySnapshots: {
              some: { storeId: input.filter.storeId },
            },
          }
        : {}),
    };

    const products = await tx.product.findMany({
      where,
      select: {
        id: true,
        barcodes: {
          orderBy: { createdAt: "asc" },
          select: { value: true },
        },
      },
      orderBy: { name: "asc" },
      take: limit,
    });

    let generatedCount = 0;
    let skippedCount = 0;
    const updatedProductIds: string[] = [];

    for (const product of products) {
      if (product.barcodes.length > 0) {
        skippedCount += 1;
        continue;
      }

      const value = await generateUniqueBarcodeValue({
        tx,
        organizationId: input.organizationId,
        mode: input.mode,
      });
      await tx.productBarcode.create({
        data: {
          organizationId: input.organizationId,
          productId: product.id,
          value,
        },
      });
      await writeAuditLog(tx, {
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: "PRODUCT_UPDATE",
        entity: "Product",
        entityId: product.id,
        before: toJson({ barcodes: [] }),
        after: toJson({ barcodes: [value], generated: true, mode: input.mode }),
        requestId: input.requestId,
      });
      generatedCount += 1;
      updatedProductIds.push(product.id);
    }

    return {
      scannedCount: products.length,
      generatedCount,
      skippedCount,
      updatedProductIds,
    };
  });

export const bulkUpdateProductCategory = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  productIds: string[];
  category?: string | null;
}) =>
  prisma.$transaction(async (tx) => {
    if (!input.productIds.length) {
      return { updated: 0 };
    }

    const products = await tx.product.findMany({
      where: { organizationId: input.organizationId, id: { in: input.productIds } },
      select: { id: true, category: true },
    });

    if (!products.length) {
      return { updated: 0 };
    }

    const nextCategory = normalizeProductCategoryName(input.category);
    if (nextCategory) {
      await ensureProductCategory(tx, {
        organizationId: input.organizationId,
        name: nextCategory,
      });
    }
    await tx.product.updateMany({
      where: { organizationId: input.organizationId, id: { in: input.productIds } },
      data: { category: nextCategory },
    });

    await Promise.all(
      products.map((product) =>
        writeAuditLog(tx, {
          organizationId: input.organizationId,
          actorId: input.actorId,
          action: "PRODUCT_UPDATE",
          entity: "Product",
          entityId: product.id,
          before: toJson({ id: product.id, category: product.category }),
          after: toJson({ id: product.id, category: nextCategory }),
          requestId: input.requestId,
        }),
      ),
    );

    return { updated: products.length };
  });

export type ImportProductRow = {
  sku: string;
  name?: string;
  category?: string | null;
  unit?: string;
  description?: string | null;
  photoUrl?: string | null;
  barcodes?: string[];
  basePriceKgs?: number;
  purchasePriceKgs?: number;
  avgCostKgs?: number;
  minStock?: number;
};

export type ImportUpdateField =
  | "name"
  | "unit"
  | "category"
  | "description"
  | "photoUrl"
  | "barcodes"
  | "basePriceKgs"
  | "purchasePriceKgs"
  | "avgCostKgs"
  | "minStock";

export type ImportPhotoResolutionSummary = {
  downloaded: number;
  fallback: number;
  missing: number;
};

const resolveImportImageWorkerCount = (rowsCount: number) => {
  const parsed = Number(process.env.IMPORT_IMAGE_WORKERS);
  if (Number.isFinite(parsed) && parsed >= 1) {
    return Math.max(1, Math.min(24, Math.trunc(parsed), rowsCount));
  }
  return Math.max(1, Math.min(12, rowsCount));
};

const resolveImportImageBudgetMs = () => {
  const parsed = Number(process.env.IMPORT_IMAGE_RESOLVE_BUDGET_MS);
  if (Number.isFinite(parsed) && parsed >= 5_000) {
    return parsed;
  }
  return 30_000;
};

export const resolveImportRowsPhotoUrls = async (rows: ImportProductRow[]) => {
  const cache = new Map<string, ResolveProductImageUrlResult>();
  const resolvedRows: ImportProductRow[] = new Array(rows.length);
  let cursor = 0;
  const workerCount = resolveImportImageWorkerCount(rows.length);
  const deadline = Date.now() + resolveImportImageBudgetMs();

  const runWorker = async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= rows.length) {
        return;
      }

      const row = rows[index];
      const normalized = normalizeImportPhotoUrl(row.photoUrl);
      if (!normalized) {
        resolvedRows[index] = { ...row, photoUrl: undefined };
        continue;
      }

      if (Date.now() > deadline) {
        resolvedRows[index] = { ...row, photoUrl: normalized };
        continue;
      }

      const resolvedPhotoUrl = await resolveRemoteImportPhotoUrl(
        normalized,
        undefined,
        cache,
      );
      resolvedRows[index] = { ...row, photoUrl: resolvedPhotoUrl };
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return resolvedRows;
};

export const resolveImportRowsPhotoUrlsForOrganization = async (
  rows: ImportProductRow[],
  organizationId: string,
) => {
  const cache = new Map<string, ResolveProductImageUrlResult>();
  const resolvedRows: ImportProductRow[] = new Array(rows.length);
  const summary: ImportPhotoResolutionSummary = {
    downloaded: 0,
    fallback: 0,
    missing: 0,
  };
  let cursor = 0;
  const workerCount = resolveImportImageWorkerCount(rows.length);
  const deadline = Date.now() + resolveImportImageBudgetMs();

  const runWorker = async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= rows.length) {
        return;
      }

      const row = rows[index];
      const normalized = normalizeImportPhotoUrl(row.photoUrl);
      if (!normalized) {
        summary.missing += 1;
        resolvedRows[index] = { ...row, photoUrl: undefined };
        continue;
      }

      if (Date.now() > deadline) {
        summary.fallback += 1;
        resolvedRows[index] = { ...row, photoUrl: normalized };
        continue;
      }

      const resolvedPhotoUrl = await resolveRemoteImportPhotoUrl(
        normalized,
        organizationId,
        cache,
      );
      if (isManagedProductImageUrl(resolvedPhotoUrl)) {
        summary.downloaded += 1;
      } else {
        summary.fallback += 1;
      }
      resolvedRows[index] = { ...row, photoUrl: resolvedPhotoUrl };
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return { rows: resolvedRows, summary };
};

export type ImportProductsInput = {
  organizationId: string;
  actorId: string;
  requestId: string;
  rows: ImportProductRow[];
  storeId?: string;
  batchId?: string;
  mode?: "full" | "update_selected";
  updateMask?: ImportUpdateField[];
};

const resolveImportTransactionTimeout = () => {
  const parsed = Number(process.env.IMPORT_TRANSACTION_TIMEOUT_MS);
  if (Number.isFinite(parsed) && parsed >= 5_000) {
    return parsed;
  }
  return 120_000;
};

export const importProductsTx = async (
  tx: Prisma.TransactionClient,
  input: ImportProductsInput,
) => {
  const results: { sku: string; action: "created" | "updated" | "skipped" }[] = [];
  const isUpdateSelectedMode = input.mode === "update_selected";
  const updateMask = new Set<ImportUpdateField>(input.updateMask ?? []);
  const shouldApplyField = (field: ImportUpdateField) =>
    !isUpdateSelectedMode || updateMask.has(field);
  const stores = await tx.store.findMany({
    where: { organizationId: input.organizationId },
    select: { id: true, allowNegativeStock: true },
  });

  const recordImportedEntity = async (entityType: string, entityId: string) => {
    if (!input.batchId) {
      return;
    }
    await tx.importedEntity.create({
      data: {
        batchId: input.batchId,
        entityType,
        entityId,
      },
    });
  };

  const resolveOptionalPrice = (value?: number) => {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (!Number.isFinite(value) || value < 0) {
      throw new AppError("unitCostInvalid", "BAD_REQUEST", 400);
    }
    return value;
  };

  const resolveOptionalInteger = (value?: number) => {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
      throw new AppError("invalidInput", "BAD_REQUEST", 400);
    }
    return value;
  };

  const setBaseCost = async (productId: string, avgCostKgs: number) => {
    const existing = await tx.productCost.findUnique({
      where: {
        organizationId_productId_variantKey: {
          organizationId: input.organizationId,
          productId,
          variantKey: "BASE",
        },
      },
      select: { id: true, costBasisQty: true },
    });

    if (existing) {
      await tx.productCost.update({
        where: { id: existing.id },
        data: {
          avgCostKgs,
          costBasisQty: Math.max(existing.costBasisQty, 1),
        },
      });
      return;
    }

    await tx.productCost.create({
      data: {
        organizationId: input.organizationId,
        productId,
        variantKey: "BASE",
        avgCostKgs,
        costBasisQty: 1,
      },
    });
  };

  const upsertStoreBasePrice = async (productId: string, priceKgs: number) => {
    if (!input.storeId) {
      return;
    }

    await tx.storePrice.upsert({
      where: {
        organizationId_storeId_productId_variantKey: {
          organizationId: input.organizationId,
          storeId: input.storeId,
          productId,
          variantKey: "BASE",
        },
      },
      create: {
        organizationId: input.organizationId,
        storeId: input.storeId,
        productId,
        variantKey: "BASE",
        priceKgs,
        updatedById: input.actorId,
      },
      update: {
        priceKgs,
        updatedById: input.actorId,
      },
    });
  };

  const upsertMinStock = async (productId: string, minStock?: number) => {
    if (minStock === undefined) {
      return;
    }
    if (!input.storeId) {
      throw new AppError("storeRequired", "BAD_REQUEST", 400);
    }
    const existing = await tx.reorderPolicy.findUnique({
      where: { storeId_productId: { storeId: input.storeId, productId } },
      select: { id: true },
    });

    const policy = await tx.reorderPolicy.upsert({
      where: { storeId_productId: { storeId: input.storeId, productId } },
      update: { minStock },
      create: {
        storeId: input.storeId,
        productId,
        minStock,
        leadTimeDays: 7,
        reviewPeriodDays: 7,
        safetyStockDays: 3,
        minOrderQty: 0,
      },
    });

    if (!existing) {
      await recordImportedEntity("ReorderPolicy", policy.id);
    }
  };

  for (const row of input.rows) {
    const sku = row.sku.trim();
    if (!sku) {
      throw new AppError("skuRequired", "BAD_REQUEST", 400);
    }

    const barcodes = shouldApplyField("barcodes") ? normalizeBarcodes(row.barcodes) : [];
    const photoUrl = shouldApplyField("photoUrl")
      ? normalizeImportPhotoUrl(row.photoUrl)
      : null;
    const basePriceKgs = shouldApplyField("basePriceKgs")
      ? resolveOptionalPrice(row.basePriceKgs)
      : undefined;
    const avgCostKgs = shouldApplyField("avgCostKgs")
      ? resolveOptionalPrice(row.avgCostKgs)
      : undefined;
    const purchasePriceKgs = shouldApplyField("purchasePriceKgs")
      ? resolveOptionalPrice(row.purchasePriceKgs)
      : undefined;
    const minStock = shouldApplyField("minStock")
      ? resolveOptionalInteger(row.minStock)
      : undefined;
    const resolvedBaseCost = avgCostKgs ?? purchasePriceKgs;
    const unitCode = row.unit?.trim() ?? "";
    const baseUnit =
      shouldApplyField("unit") && unitCode
        ? await ensureUnitByCode(tx, input.organizationId, unitCode)
        : null;
    const existing = await tx.product.findUnique({
      where: { organizationId_sku: { organizationId: input.organizationId, sku } },
    });

    if (shouldApplyField("barcodes")) {
      await ensureBarcodesAvailable(
        tx,
        input.organizationId,
        barcodes,
        existing?.id,
      );
    }

    if (existing) {
      const updateData: Prisma.ProductUpdateInput = {};
      if (isUpdateSelectedMode) {
        if (shouldApplyField("name") && row.name?.trim()) {
          updateData.name = row.name.trim();
        }
        if (shouldApplyField("category")) {
          updateData.category = row.category ?? null;
        }
        if (shouldApplyField("description")) {
          updateData.description = row.description ?? null;
        }
        if (shouldApplyField("unit")) {
          if (!unitCode || !baseUnit) {
            throw new AppError("unitRequired", "BAD_REQUEST", 400);
          }
          updateData.unit = baseUnit.code;
          updateData.baseUnit = { connect: { id: baseUnit.id } };
        }
        if (shouldApplyField("basePriceKgs") && basePriceKgs !== undefined) {
          updateData.basePriceKgs = basePriceKgs;
        }
        if (shouldApplyField("photoUrl")) {
          updateData.photoUrl = photoUrl ?? existing.photoUrl;
        }
      } else {
        const name = row.name?.trim();
        if (!name) {
          throw new AppError("nameRequired", "BAD_REQUEST", 400);
        }
        if (!unitCode || !baseUnit) {
          throw new AppError("unitRequired", "BAD_REQUEST", 400);
        }
        updateData.name = name;
        updateData.category = row.category ?? null;
        updateData.unit = baseUnit.code;
        updateData.baseUnit = { connect: { id: baseUnit.id } };
        updateData.description = row.description ?? null;
        updateData.photoUrl = photoUrl ?? existing.photoUrl;
        updateData.isDeleted = false;
        if (basePriceKgs !== undefined) {
          updateData.basePriceKgs = basePriceKgs;
        }
      }

      if (Object.keys(updateData).length > 0) {
        await tx.product.update({
          where: { id: existing.id },
          data: updateData,
        });
      }

      if (shouldApplyField("photoUrl") && photoUrl) {
        await syncProductImages(tx, input.organizationId, existing.id, [
          { url: photoUrl, position: 0 },
        ]);
      }

      if (shouldApplyField("barcodes")) {
        const existingBarcodes = await tx.productBarcode.findMany({
          where: { productId: existing.id },
          select: { id: true, value: true },
        });
        const existingValues = new Map(
          existingBarcodes.map((barcode) => [barcode.value, barcode.id]),
        );
        const nextValues = new Set(barcodes);
        const toRemove = existingBarcodes.filter((barcode) => !nextValues.has(barcode.value));
        const toAdd = barcodes.filter((value) => !existingValues.has(value));

        if (toRemove.length) {
          await tx.productBarcode.deleteMany({
            where: { id: { in: toRemove.map((barcode) => barcode.id) } },
          });
        }
        for (const value of toAdd) {
          const barcode = await tx.productBarcode.create({
            data: {
              organizationId: input.organizationId,
              productId: existing.id,
              value,
            },
          });
          await recordImportedEntity("ProductBarcode", barcode.id);
        }
      }

      await ensureBaseSnapshots(tx, input.organizationId, existing.id, stores);
      if (shouldApplyField("basePriceKgs") && basePriceKgs !== undefined) {
        await upsertStoreBasePrice(existing.id, basePriceKgs);
      }
      if (
        (shouldApplyField("avgCostKgs") || shouldApplyField("purchasePriceKgs")) &&
        resolvedBaseCost !== undefined
      ) {
        await setBaseCost(existing.id, resolvedBaseCost);
      }
      if (shouldApplyField("minStock")) {
        await upsertMinStock(existing.id, minStock);
      }

      await writeAuditLog(tx, {
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: "PRODUCT_UPDATE",
        entity: "Product",
        entityId: existing.id,
        before: toJson(existing),
        after: toJson({ ...existing, ...row }),
        requestId: input.requestId,
      });

      results.push({ sku, action: "updated" });
    } else {
      if (isUpdateSelectedMode) {
        results.push({ sku, action: "skipped" });
        continue;
      }
      const name = row.name?.trim();
      if (!name) {
        throw new AppError("nameRequired", "BAD_REQUEST", 400);
      }
      if (!unitCode) {
        throw new AppError("unitRequired", "BAD_REQUEST", 400);
      }
      const resolvedBaseUnit = baseUnit ?? (await ensureUnitByCode(tx, input.organizationId, unitCode));

      const product = await tx.product.create({
        data: {
          organizationId: input.organizationId,
          sku,
          name,
          category: row.category ?? null,
          unit: resolvedBaseUnit.code,
          baseUnitId: resolvedBaseUnit.id,
          basePriceKgs: basePriceKgs ?? null,
          description: row.description ?? null,
          photoUrl: photoUrl ?? null,
        },
      });

      await recordImportedEntity("Product", product.id);

      if (photoUrl) {
        await tx.productImage.create({
          data: {
            organizationId: input.organizationId,
            productId: product.id,
            url: photoUrl,
            position: 0,
          },
        });
      }

      for (const value of barcodes) {
        const barcode = await tx.productBarcode.create({
          data: {
            organizationId: input.organizationId,
            productId: product.id,
            value,
          },
        });
        await recordImportedEntity("ProductBarcode", barcode.id);
      }

      await ensureBaseSnapshots(tx, input.organizationId, product.id, stores);
      if (basePriceKgs !== undefined) {
        await upsertStoreBasePrice(product.id, basePriceKgs);
      }
      if (resolvedBaseCost !== undefined) {
        await setBaseCost(product.id, resolvedBaseCost);
      }
      if (shouldApplyField("minStock")) {
        await upsertMinStock(product.id, minStock);
      }

      await writeAuditLog(tx, {
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: "PRODUCT_CREATE",
        entity: "Product",
        entityId: product.id,
        before: null,
        after: toJson(product),
        requestId: input.requestId,
      });

      results.push({ sku, action: "created" });
    }
  }

  return results;
};

export const importProducts = async (input: ImportProductsInput) =>
  prisma.$transaction(
    async (tx) => importProductsTx(tx, input),
    {
      maxWait: 10_000,
      timeout: resolveImportTransactionTimeout(),
    },
  );

export type ArchiveProductInput = {
  productId: string;
  organizationId: string;
  actorId: string;
  requestId: string;
};

export const archiveProduct = async (input: ArchiveProductInput) =>
  prisma.$transaction(async (tx) => {
    const before = await tx.product.findUnique({ where: { id: input.productId } });
    if (!before || before.organizationId !== input.organizationId) {
      throw new AppError("productNotFound", "NOT_FOUND", 404);
    }

    const product = await tx.product.update({
      where: { id: input.productId },
      data: { isDeleted: true },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "PRODUCT_ARCHIVE",
      entity: "Product",
      entityId: product.id,
      before: toJson(before),
      after: toJson(product),
      requestId: input.requestId,
    });

    return product;
  });

export type RestoreProductInput = {
  productId: string;
  organizationId: string;
  actorId: string;
  requestId: string;
};

export const restoreProduct = async (input: RestoreProductInput) =>
  prisma.$transaction(async (tx) => {
    const before = await tx.product.findUnique({ where: { id: input.productId } });
    if (!before || before.organizationId !== input.organizationId) {
      throw new AppError("productNotFound", "NOT_FOUND", 404);
    }

    const product = await tx.product.update({
      where: { id: input.productId },
      data: { isDeleted: false },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "PRODUCT_RESTORE",
      entity: "Product",
      entityId: product.id,
      before: toJson(before),
      after: toJson(product),
      requestId: input.requestId,
    });

    return product;
  });
