import type { AttributeType, Prisma } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { writeAuditLog } from "@/server/services/audit";
import { toJson } from "@/server/services/json";
import { recordFirstEvent } from "@/server/services/productEvents";
import { assertWithinLimits } from "@/server/services/planLimits";

export type CreateProductInput = {
  organizationId: string;
  actorId: string;
  requestId: string;
  sku: string;
  name: string;
  category?: string | null;
  baseUnitId: string;
  basePriceKgs?: number | null;
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

export const createProduct = async (input: CreateProductInput) =>
  prisma.$transaction(async (tx) => {
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
    const normalizedImages = normalizeImages(input.images);

    const product = await tx.product.create({
      data: {
        organizationId: input.organizationId,
        sku: input.sku,
        name: input.name,
        category: input.category ?? null,
        unit: baseUnit.code,
        baseUnitId: baseUnit.id,
        basePriceKgs: input.basePriceKgs ?? null,
        description: input.description ?? null,
        photoUrl:
          input.photoUrl ??
          (normalizedImages.length ? normalizedImages[0].url : null),
        supplierId: input.supplierId,
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
    await ensureBaseSnapshots(tx, input.organizationId, product.id);

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
  description?: string | null;
  photoUrl?: string | null;
  images?: CreateProductInput["images"];
  supplierId?: string | null;
  barcodes?: string[];
  packs?: CreateProductInput["packs"];
  variants?: { id?: string; name?: string | null; sku?: string | null; attributes?: Record<string, unknown> }[];
};

export const updateProduct = async (input: UpdateProductInput) =>
  prisma.$transaction(async (tx) => {
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

    const normalizedImages = input.images ? normalizeImages(input.images) : undefined;
    const product = await tx.product.update({
      where: { id: input.productId },
      data: {
        sku: input.sku,
        name: input.name,
        category: input.category ?? null,
        unit: baseUnit.code,
        baseUnitId: baseUnit.id,
        basePriceKgs: input.basePriceKgs ?? null,
        description: input.description ?? null,
        photoUrl:
          input.photoUrl ?? (normalizedImages?.length ? normalizedImages[0].url : null),
        supplierId: input.supplierId ?? null,
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

    const nextCategory = input.category ?? null;
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
  name: string;
  category?: string | null;
  unit: string;
  description?: string | null;
  photoUrl?: string | null;
  barcodes?: string[];
};

export type ImportProductsInput = {
  organizationId: string;
  actorId: string;
  requestId: string;
  rows: ImportProductRow[];
  batchId?: string;
};

export const importProductsTx = async (
  tx: Prisma.TransactionClient,
  input: ImportProductsInput,
) => {
  const results: { sku: string; action: "created" | "updated" }[] = [];
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

  for (const row of input.rows) {
    const barcodes = normalizeBarcodes(row.barcodes);
    const baseUnit = await ensureUnitByCode(tx, input.organizationId, row.unit.trim());
    const existing = await tx.product.findUnique({
      where: { organizationId_sku: { organizationId: input.organizationId, sku: row.sku } },
    });

    await ensureBarcodesAvailable(
      tx,
      input.organizationId,
      barcodes,
      existing?.id,
    );

    if (existing) {
      await tx.product.update({
        where: { id: existing.id },
        data: {
          name: row.name,
          category: row.category ?? null,
          unit: baseUnit.code,
          baseUnitId: baseUnit.id,
          description: row.description ?? null,
          photoUrl: row.photoUrl ?? null,
        },
      });

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

      await ensureBaseSnapshots(tx, input.organizationId, existing.id, stores);

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

      results.push({ sku: row.sku, action: "updated" });
    } else {
      const product = await tx.product.create({
        data: {
          organizationId: input.organizationId,
          sku: row.sku,
          name: row.name,
          category: row.category ?? null,
          unit: baseUnit.code,
          baseUnitId: baseUnit.id,
          description: row.description ?? null,
          photoUrl: row.photoUrl ?? null,
        },
      });

      await recordImportedEntity("Product", product.id);

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

      results.push({ sku: row.sku, action: "created" });
    }
  }

  return results;
};

export const importProducts = async (input: ImportProductsInput) =>
  prisma.$transaction(async (tx) => importProductsTx(tx, input));

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
