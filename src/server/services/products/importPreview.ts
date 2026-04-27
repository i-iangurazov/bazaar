import type { Prisma, PrismaClient } from "@prisma/client";
import type { Logger } from "pino";

import { logProfileSection } from "@/server/profiling/perf";
import { decimalToNumber } from "@/server/services/products/serializers";
import {
  listProductsByNormalizedNames,
  normalizeProductNameForDiagnostics,
  type ProductDuplicateMatch,
} from "@/server/services/products/diagnostics";
import type {
  ImportCsvRowInput,
  ImportMode,
  ImportUpdateField,
} from "@/server/trpc/routers/products.schemas";

type PrismaDbClient = PrismaClient | Prisma.TransactionClient;

type ImportPreviewValue = string | number | string[] | null;

type ImportPreviewChange = {
  field: ImportUpdateField;
  before: ImportPreviewValue;
  after: ImportPreviewValue;
};

type ImportPreviewWarning =
  | {
      code: "barcodeConflict";
      severity: "blocking";
      barcode: string;
      productId: string;
      productSku: string;
      productName: string;
      isDeleted: boolean;
    }
  | {
      code: "likelyDuplicateName";
      severity: "warning";
      productId: string;
      productSku: string;
      productName: string;
      isDeleted: boolean;
    }
  | {
      code: "archivedProductWillBeRestored";
      severity: "warning";
      productId: string;
      productSku: string;
      productName: string;
    }
  | {
      code: "missingExistingProduct";
      severity: "warning";
    };

type ImportPreviewRow = {
  sourceRowNumber: number;
  sku: string;
  name: string | null;
  action: "create" | "update" | "skipped";
  existingProduct: ProductDuplicateMatch | null;
  changes: ImportPreviewChange[];
  warnings: ImportPreviewWarning[];
  hasBlockingWarnings: boolean;
};

const normalizeBarcodes = (barcodes?: string[]) =>
  Array.from(
    new Set(
      (barcodes ?? [])
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  ).sort((left, right) => left.localeCompare(right));

const normalizeCategories = (value?: string | null) =>
  (value ?? "")
    .split("|")
    .map((item) => item.trim().replace(/\s+/g, " "))
    .filter((item) => item.length > 0)
    .filter((item, index, list) => list.indexOf(item) === index);

const areStringArraysEqual = (left: string[], right: string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const normalizePreviewImages = (row: Pick<ImportCsvRowInput, "photoUrl" | "images">) => {
  const images =
    row.images?.length || !row.photoUrl
      ? row.images ?? []
      : [{ url: row.photoUrl, position: 0 }];
  const seen = new Set<string>();
  return images
    .map((image, index) => ({
      url: image.url.trim(),
      position:
        typeof image.position === "number" && Number.isFinite(image.position)
          ? Math.trunc(image.position)
          : index,
    }))
    .filter((image) => {
      if (!image.url || seen.has(image.url)) {
        return false;
      }
      seen.add(image.url);
      return true;
    })
    .sort((left, right) => left.position - right.position)
    .map((image) => image.url);
};

const formatPreviewAttributeValue = (value: unknown): string => {
  if (Array.isArray(value)) {
    return value.map((item) => formatPreviewAttributeValue(item)).join("/");
  }
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
};

const formatPreviewVariantLabel = (variant: {
  name?: string | null;
  sku?: string | null;
  attributes?: Prisma.JsonValue | Record<string, unknown> | null;
}) => {
  const name = variant.name?.trim() || variant.sku?.trim() || "Variant";
  const attributes =
    variant.attributes && typeof variant.attributes === "object" && !Array.isArray(variant.attributes)
      ? Object.entries(variant.attributes)
          .map(([key, value]) => [key, formatPreviewAttributeValue(value)] as const)
          .filter(([, value]) => value.length > 0)
          .map(([key, value]) => `${key}: ${value}`)
      : [];
  return attributes.length ? `${name} (${attributes.join(", ")})` : name;
};

const normalizePreviewVariants = (variants?: ImportCsvRowInput["variants"]) => {
  if (!variants?.length) {
    return [];
  }
  const seenNames = new Set<string>();
  return variants
    .map((variant) => ({
      ...variant,
      name: variant.name?.trim() ?? "",
      sku: variant.sku?.trim() ?? "",
    }))
    .filter((variant) => {
      if (!variant.name) {
        return false;
      }
      const key = variant.name.toLocaleLowerCase();
      if (seenNames.has(key)) {
        return false;
      }
      seenNames.add(key);
      return true;
    })
    .map((variant) => formatPreviewVariantLabel(variant));
};

const mergePreviewVariants = (
  existingVariants: {
    name: string | null;
    sku: string | null;
    attributes: Prisma.JsonValue;
  }[],
  incomingVariants?: ImportCsvRowInput["variants"],
) => {
  const byName = new Map(
    existingVariants
      .map((variant) => [variant.name?.trim().toLocaleLowerCase() ?? "", variant] as const)
      .filter(([name]) => name.length > 0),
  );
  const output = existingVariants.map((variant) => formatPreviewVariantLabel(variant));
  const outputIndexByName = new Map(
    existingVariants
      .map((variant, index) => [variant.name?.trim().toLocaleLowerCase() ?? "", index] as const)
      .filter(([name]) => name.length > 0),
  );

  (incomingVariants ?? []).forEach((variant) => {
    const name = variant.name?.trim() ?? "";
    if (!name) {
      return;
    }
    const key = name.toLocaleLowerCase();
    const label = formatPreviewVariantLabel({ ...variant, name });
    if (byName.has(key)) {
      const index = outputIndexByName.get(key);
      if (index !== undefined) {
        output[index] = label;
      }
      return;
    }
    byName.set(key, {
      name,
      sku: variant.sku ?? null,
      attributes: (variant.attributes ?? {}) as Prisma.JsonValue,
    });
    outputIndexByName.set(key, output.length);
    output.push(label);
  });

  return output;
};

const shouldApplyImportField = (
  mode: ImportMode | undefined,
  updateMask: Set<ImportUpdateField>,
  field: ImportUpdateField,
) => mode !== "update_selected" || updateMask.has(field);

const addChange = (
  changes: ImportPreviewChange[],
  field: ImportUpdateField,
  before: ImportPreviewValue,
  after: ImportPreviewValue,
) => {
  if (Array.isArray(before) && Array.isArray(after) && areStringArraysEqual(before, after)) {
    return;
  }
  if (!Array.isArray(before) && !Array.isArray(after) && before === after) {
    return;
  }
  changes.push({ field, before, after });
};

export const previewProductImport = async ({
  prisma,
  organizationId,
  rows,
  storeId,
  mode,
  updateMask: updateMaskInput,
  logger,
}: {
  prisma: PrismaDbClient;
  organizationId: string;
  rows: ImportCsvRowInput[];
  storeId?: string;
  mode?: ImportMode;
  updateMask?: ImportUpdateField[];
  logger?: Logger;
}) => {
  const updateMask = new Set<ImportUpdateField>(updateMaskInput ?? []);
  const uniqueSkus = Array.from(
    new Set(
      rows
        .map((row) => row.sku.trim())
        .filter((value) => value.length > 0),
    ),
  );
  const incomingBarcodes = Array.from(
    new Set(
      rows.flatMap((row) =>
        shouldApplyImportField(mode, updateMask, "barcodes") ? normalizeBarcodes(row.barcodes) : [],
      ),
    ),
  );
  const normalizedNames = Array.from(
    new Set(
      rows
        .map((row) => normalizeProductNameForDiagnostics(row.name))
        .filter((value) => value.length >= 4),
    ),
  );

  const existingProductsStartedAt = Date.now();
  const existingProducts = uniqueSkus.length
    ? await prisma.product.findMany({
        where: {
          organizationId,
          sku: { in: uniqueSkus },
        },
        select: {
          id: true,
          sku: true,
          name: true,
          isDeleted: true,
          category: true,
          categories: true,
          unit: true,
          description: true,
          photoUrl: true,
          basePriceKgs: true,
          images: {
            select: { url: true, position: true },
            orderBy: { position: "asc" },
          },
          variants: {
            where: { isActive: true },
            select: { name: true, sku: true, attributes: true },
            orderBy: { createdAt: "asc" },
          },
        },
      })
    : [];
  if (logger) {
    logProfileSection({
      logger,
      scope: "products.previewImportCsv",
      section: "existingProductsLookup",
      startedAt: existingProductsStartedAt,
      details: {
        rows: rows.length,
        uniqueSkus: uniqueSkus.length,
      },
      slowThresholdMs: 120,
    });
  }

  const existingProductIds = existingProducts.map((product) => product.id);

  const auxiliaryReadsStartedAt = Date.now();
  const [existingBarcodeRows, existingCostRows, existingMinStockRows, conflictingBarcodeRows, likelyNameRows] =
    await Promise.all([
      existingProductIds.length
        ? prisma.productBarcode.findMany({
            where: {
              organizationId,
              productId: { in: existingProductIds },
            },
            select: {
              productId: true,
              value: true,
            },
          })
        : Promise.resolve([]),
      existingProductIds.length
        ? prisma.productCost.findMany({
            where: {
              organizationId,
              productId: { in: existingProductIds },
              variantKey: "BASE",
            },
            select: {
              productId: true,
              avgCostKgs: true,
            },
          })
        : Promise.resolve([]),
      storeId && existingProductIds.length
        ? prisma.reorderPolicy.findMany({
            where: {
              storeId,
              productId: { in: existingProductIds },
            },
            select: {
              productId: true,
              minStock: true,
            },
          })
        : Promise.resolve([]),
      incomingBarcodes.length
        ? prisma.productBarcode.findMany({
            where: {
              organizationId,
              value: { in: incomingBarcodes },
            },
            select: {
              value: true,
              product: {
                select: {
                  id: true,
                  sku: true,
                  name: true,
                  isDeleted: true,
                },
              },
            },
            orderBy: [{ value: "asc" }, { product: { name: "asc" } }],
          })
        : Promise.resolve([]),
      normalizedNames.length
        ? listProductsByNormalizedNames({
            prisma,
            organizationId,
            normalizedNames,
          })
        : Promise.resolve([]),
    ]);
  if (logger) {
    logProfileSection({
      logger,
      scope: "products.previewImportCsv",
      section: "auxiliaryReads",
      startedAt: auxiliaryReadsStartedAt,
      details: {
        existingBarcodeRows: existingBarcodeRows.length,
        existingCostRows: existingCostRows.length,
        existingMinStockRows: existingMinStockRows.length,
        conflictingBarcodeRows: conflictingBarcodeRows.length,
        likelyNameRows: likelyNameRows.length,
      },
      slowThresholdMs: 120,
    });
  }

  const existingBySku = new Map(existingProducts.map((product) => [product.sku, product]));
  const existingBarcodesByProductId = new Map<string, string[]>();
  existingBarcodeRows.forEach((row) => {
    const list = existingBarcodesByProductId.get(row.productId) ?? [];
    list.push(row.value);
    existingBarcodesByProductId.set(row.productId, list);
  });
  const existingBaseCostByProductId = new Map(
    existingCostRows.map((row) => [row.productId, decimalToNumber(row.avgCostKgs)]),
  );
  const existingMinStockByProductId = new Map(
    existingMinStockRows.map((row) => [row.productId, row.minStock]),
  );
  const conflictingBarcodesByValue = new Map<string, ProductDuplicateMatch[]>();
  conflictingBarcodeRows.forEach((row) => {
    const list = conflictingBarcodesByValue.get(row.value) ?? [];
    list.push(row.product);
    conflictingBarcodesByValue.set(row.value, list);
  });
  const likelyNameMatchesByNormalized = new Map<string, ProductDuplicateMatch[]>();
  likelyNameRows.forEach(({ normalizedName, ...match }) => {
    const list = likelyNameMatchesByNormalized.get(normalizedName) ?? [];
    list.push(match);
    likelyNameMatchesByNormalized.set(normalizedName, list);
  });

  const buildPreviewRowsStartedAt = Date.now();
  const previewRows: ImportPreviewRow[] = rows.map((row, index) => {
    const sourceRowNumber = row.sourceRowNumber ?? index + 1;
    const sku = row.sku.trim();
    const name = row.name?.trim() ?? null;
    const existing = existingBySku.get(sku) ?? null;

    if (!existing && mode === "update_selected") {
      return {
        sourceRowNumber,
        sku,
        name,
        action: "skipped",
        existingProduct: null,
        changes: [],
        warnings: [{ code: "missingExistingProduct", severity: "warning" }],
        hasBlockingWarnings: false,
      };
    }

    const warnings: ImportPreviewWarning[] = [];
    const changes: ImportPreviewChange[] = [];
    const normalizedRowBarcodes = shouldApplyImportField(mode, updateMask, "barcodes")
      ? normalizeBarcodes(row.barcodes)
      : [];
    const normalizedRowCategories = shouldApplyImportField(mode, updateMask, "category")
      ? normalizeCategories(row.category)
      : [];
    const normalizedName = normalizeProductNameForDiagnostics(name);

    normalizedRowBarcodes.forEach((barcode) => {
      const conflicts = (conflictingBarcodesByValue.get(barcode) ?? []).filter(
        (match) => match.id !== existing?.id,
      );
      conflicts.forEach((match) => {
        warnings.push({
          code: "barcodeConflict",
          severity: "blocking",
          barcode,
          productId: match.id,
          productSku: match.sku,
          productName: match.name,
          isDeleted: match.isDeleted,
        });
      });
    });

    if (normalizedName.length >= 4) {
      const duplicateMatches = (likelyNameMatchesByNormalized.get(normalizedName) ?? []).filter(
        (match) => match.id !== existing?.id,
      );
      duplicateMatches.forEach((match) => {
        warnings.push({
          code: "likelyDuplicateName",
          severity: "warning",
          productId: match.id,
          productSku: match.sku,
          productName: match.name,
          isDeleted: match.isDeleted,
        });
      });
    }

    if (existing) {
      if (existing.isDeleted && mode !== "update_selected") {
        warnings.push({
          code: "archivedProductWillBeRestored",
          severity: "warning",
          productId: existing.id,
          productSku: existing.sku,
          productName: existing.name,
        });
      }

      if (shouldApplyImportField(mode, updateMask, "name") && name) {
        addChange(changes, "name", existing.name, name);
      }

      if (shouldApplyImportField(mode, updateMask, "unit") && row.unit?.trim()) {
        addChange(changes, "unit", existing.unit, row.unit.trim());
      }

      if (shouldApplyImportField(mode, updateMask, "category")) {
        addChange(
          changes,
          "category",
          existing.categories.length ? existing.categories : existing.category ? [existing.category] : [],
          normalizedRowCategories,
        );
      }

      if (shouldApplyImportField(mode, updateMask, "description")) {
        addChange(changes, "description", existing.description, row.description ?? null);
      }

      if (shouldApplyImportField(mode, updateMask, "photoUrl")) {
        const existingImages = existing.images.length
          ? existing.images.map((image) => image.url)
          : existing.photoUrl
            ? [existing.photoUrl]
            : [];
        const nextImages = normalizePreviewImages(row);
        addChange(
          changes,
          "photoUrl",
          existingImages,
          nextImages.length ? nextImages : existingImages,
        );
      }

      if (shouldApplyImportField(mode, updateMask, "variants")) {
        const nextVariants = normalizePreviewVariants(row.variants);
        if (nextVariants.length) {
          addChange(
            changes,
            "variants",
            existing.variants.map((variant) => formatPreviewVariantLabel(variant)),
            mergePreviewVariants(existing.variants, row.variants),
          );
        }
      }

      if (shouldApplyImportField(mode, updateMask, "barcodes")) {
        addChange(
          changes,
          "barcodes",
          normalizeBarcodes(existingBarcodesByProductId.get(existing.id)),
          normalizedRowBarcodes,
        );
      }

      if (shouldApplyImportField(mode, updateMask, "basePriceKgs") && row.basePriceKgs !== undefined) {
        addChange(
          changes,
          "basePriceKgs",
          decimalToNumber(existing.basePriceKgs),
          row.basePriceKgs,
        );
      }

      if (
        (shouldApplyImportField(mode, updateMask, "avgCostKgs") ||
          shouldApplyImportField(mode, updateMask, "purchasePriceKgs")) &&
        (row.avgCostKgs !== undefined || row.purchasePriceKgs !== undefined)
      ) {
        const nextBaseCost = row.avgCostKgs ?? row.purchasePriceKgs ?? null;
        addChange(
          changes,
          row.avgCostKgs !== undefined ? "avgCostKgs" : "purchasePriceKgs",
          existingBaseCostByProductId.get(existing.id) ?? null,
          nextBaseCost,
        );
      }

      if (shouldApplyImportField(mode, updateMask, "minStock") && row.minStock !== undefined) {
        addChange(
          changes,
          "minStock",
          existingMinStockByProductId.get(existing.id) ?? null,
          row.minStock,
        );
      }
    } else {
      if (name) {
        changes.push({ field: "name", before: null, after: name });
      }
      if (row.unit?.trim()) {
        changes.push({ field: "unit", before: null, after: row.unit.trim() });
      }
      if (normalizedRowCategories.length) {
        changes.push({ field: "category", before: null, after: normalizedRowCategories });
      }
      if (row.description) {
        changes.push({ field: "description", before: null, after: row.description });
      }
      const nextImages = normalizePreviewImages(row);
      if (nextImages.length) {
        changes.push({ field: "photoUrl", before: null, after: nextImages });
      }
      const nextVariants = normalizePreviewVariants(row.variants);
      if (nextVariants.length) {
        changes.push({ field: "variants", before: null, after: nextVariants });
      }
      if (normalizedRowBarcodes.length) {
        changes.push({ field: "barcodes", before: null, after: normalizedRowBarcodes });
      }
      if (row.basePriceKgs !== undefined) {
        changes.push({ field: "basePriceKgs", before: null, after: row.basePriceKgs });
      }
      if (row.avgCostKgs !== undefined || row.purchasePriceKgs !== undefined) {
        changes.push({
          field: row.avgCostKgs !== undefined ? "avgCostKgs" : "purchasePriceKgs",
          before: null,
          after: row.avgCostKgs ?? row.purchasePriceKgs ?? null,
        });
      }
      if (row.minStock !== undefined) {
        changes.push({ field: "minStock", before: null, after: row.minStock });
      }
    }

    return {
      sourceRowNumber,
      sku,
      name,
      action: existing ? "update" : "create",
      existingProduct: existing
        ? {
            id: existing.id,
            sku: existing.sku,
            name: existing.name,
            isDeleted: existing.isDeleted,
          }
        : null,
      changes,
      warnings,
      hasBlockingWarnings: warnings.some((warning) => warning.severity === "blocking"),
    };
  });

  const summary = previewRows.reduce(
    (acc, row) => {
      if (row.action === "create") {
        acc.creates += 1;
      } else if (row.action === "update") {
        acc.updates += 1;
      } else {
        acc.skipped += 1;
      }
      acc.warningCount += row.warnings.filter((warning) => warning.severity === "warning").length;
      acc.blockingWarningCount += row.warnings.filter(
        (warning) => warning.severity === "blocking",
      ).length;
      return acc;
    },
    {
      creates: 0,
      updates: 0,
      skipped: 0,
      warningCount: 0,
      blockingWarningCount: 0,
    },
  );
  if (logger) {
    logProfileSection({
      logger,
      scope: "products.previewImportCsv",
      section: "buildPreviewRows",
      startedAt: buildPreviewRowsStartedAt,
      details: {
        rows: previewRows.length,
        creates: summary.creates,
        updates: summary.updates,
        skipped: summary.skipped,
        warningCount: summary.warningCount,
        blockingWarningCount: summary.blockingWarningCount,
      },
      slowThresholdMs: 80,
    });
  }

  return {
    rows: previewRows,
    summary,
  };
};
