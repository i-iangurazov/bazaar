import type { Prisma, PrismaClient } from "@prisma/client";
import type { Logger } from "pino";

import { logProfileSection } from "@/server/profiling/perf";
import { decimalToNumber } from "@/server/services/products/serializers";
import type { ProductDuplicateMatch } from "@/server/services/products/diagnostics";
import {
  productImportMatchIsBlocking,
  productImportMatchIsExisting,
  resolveProductImportMatch,
  type ProductImportMatch,
  type ProductImportMatchReason,
} from "@/server/services/products/importMatching";
import type {
  ImportCsvRowInput,
  ImportMode,
  ImportUpdateField,
  ProductExistingBehavior,
  ProductImportRowAction,
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
      code: "crossStoreSkuConflict";
      severity: "blocking";
      productId: string;
      productSku: string;
      productName: string;
      isDeleted: boolean;
    }
  | {
      code: "crossStoreBarcodeConflict";
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
  matchStatus:
    | "new"
    | "matched_barcode"
    | "matched_sku"
    | "matched_name_category"
    | "matched_name_price"
    | "possible_duplicate"
    | "cross_store_conflict"
    | "error";
  matchReason: ProductImportMatchReason;
  existingProduct: ProductDuplicateMatch | null;
  possibleDuplicate: ProductDuplicateMatch | null;
  changes: ImportPreviewChange[];
  warnings: ImportPreviewWarning[];
  hasBlockingWarnings: boolean;
};

const DEFAULT_IMPORT_PREVIEW_ROW_LIMIT = 200;

const existingPreviewProductSelect = {
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
} as const;

type ExistingPreviewProduct = Prisma.ProductGetPayload<{
  select: typeof existingPreviewProductSelect;
}>;

const normalizeBarcodes = (barcodes?: string[]) =>
  Array.from(
    new Set((barcodes ?? []).map((value) => value.trim()).filter((value) => value.length > 0)),
  ).sort((left, right) => left.localeCompare(right));

const normalizeCategories = (value?: string | null) =>
  (value ?? "")
    .split(/[|,]/)
    .map((item) => item.trim().replace(/\s+/g, " "))
    .filter((item) => item.length > 0)
    .filter((item, index, list) => list.indexOf(item) === index);

const normalizeRowCategories = (row: Pick<ImportCsvRowInput, "category" | "categories">) => {
  if (row.categories?.length) {
    return row.categories
      .flatMap((value) => normalizeCategories(value))
      .filter((item, index, list) => list.indexOf(item) === index);
  }
  return normalizeCategories(row.category);
};

const normalizeRowColor = (value?: string | null) => {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized ? normalized : null;
};

const extractVariantColorValues = (
  variants: Array<{ attributes?: Prisma.JsonValue | Record<string, unknown> | null }>,
) =>
  variants
    .map((variant) => {
      const attributes = variant.attributes;
      if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) {
        return null;
      }
      const color = (attributes as Record<string, unknown>).color;
      if (typeof color === "string") {
        return normalizeRowColor(color);
      }
      if (color === null || color === undefined) {
        return null;
      }
      return normalizeRowColor(String(color));
    })
    .filter((value): value is string => Boolean(value))
    .filter((value, index, list) => list.indexOf(value) === index);

const areStringArraysEqual = (left: string[], right: string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const normalizePreviewImages = (row: Pick<ImportCsvRowInput, "photoUrl" | "images">) => {
  const images =
    row.images?.length || !row.photoUrl ? (row.images ?? []) : [{ url: row.photoUrl, position: 0 }];
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
    variant.attributes &&
    typeof variant.attributes === "object" &&
    !Array.isArray(variant.attributes)
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

const previewRowKey = (row: ImportPreviewRow) => `${row.sourceRowNumber}:${row.sku}`;

const selectPreviewRows = (rows: ImportPreviewRow[], limit: number) => {
  if (limit >= rows.length) {
    return rows;
  }
  if (limit <= 0) {
    return [];
  }

  const selected = new Map<string, ImportPreviewRow>();
  const addRows = (candidates: ImportPreviewRow[]) => {
    for (const row of candidates) {
      if (selected.size >= limit) {
        return;
      }
      selected.set(previewRowKey(row), row);
    }
  };

  addRows(rows.filter((row) => row.hasBlockingWarnings));
  addRows(rows.filter((row) => row.warnings.length > 0));
  addRows(rows);

  return Array.from(selected.values()).sort(
    (left, right) => left.sourceRowNumber - right.sourceRowNumber,
  );
};

const matchProductSummary = (match: ProductImportMatch): ProductDuplicateMatch | null =>
  match.product
    ? {
        id: match.product.id,
        sku: match.product.sku,
        name: match.product.name,
        isDeleted: match.product.isDeleted,
      }
    : null;

const resolveMatchStatus = (match: ProductImportMatch): ImportPreviewRow["matchStatus"] => {
  switch (match.reason) {
    case "barcode":
      return "matched_barcode";
    case "sku":
      return "matched_sku";
    case "name_category":
      return "matched_name_category";
    case "name_price":
      return "matched_name_price";
    case "possible_duplicate":
      return "possible_duplicate";
    case "cross_store_barcode":
    case "cross_store_sku":
      return "cross_store_conflict";
    case "none":
      return "new";
  }
};

const resolveRowAction = (match: ProductImportMatch, existingBehavior: ProductExistingBehavior) => {
  if (productImportMatchIsBlocking(match) || match.reason === "possible_duplicate") {
    return "skipped" as const;
  }
  if (productImportMatchIsExisting(match)) {
    return existingBehavior === "skip" ? ("skipped" as const) : ("update" as const);
  }
  return "create" as const;
};

export const previewProductImport = async ({
  prisma,
  organizationId,
  rows,
  storeId,
  mode,
  updateMask: updateMaskInput,
  existingBehavior: existingBehaviorInput,
  previewLimit: previewLimitInput,
  rowActions,
  logger,
}: {
  prisma: PrismaDbClient;
  organizationId: string;
  rows: ImportCsvRowInput[];
  storeId?: string;
  mode?: ImportMode;
  updateMask?: ImportUpdateField[];
  existingBehavior?: ProductExistingBehavior;
  previewLimit?: number;
  rowActions?: Array<{
    sourceRowNumber: number;
    action: ProductImportRowAction;
    existingProductId?: string;
  }>;
  logger?: Logger;
}) => {
  const updateMask = new Set<ImportUpdateField>(updateMaskInput ?? []);
  const existingBehavior = existingBehaviorInput ?? "update";
  const rowDecisionByNumber = new Map(
    (rowActions ?? []).map((decision) => [decision.sourceRowNumber, decision]),
  );
  const productDetailsById = new Map<string, ExistingPreviewProduct | null>();
  const existingBarcodesByProductId = new Map<string, string[]>();
  const existingBaseCostByProductId = new Map<string, number | null>();
  const existingMinStockByProductId = new Map<string, number | null>();

  const loadExistingProductDetails = async (productId: string) => {
    if (productDetailsById.has(productId)) {
      return productDetailsById.get(productId) ?? null;
    }
    const product = await prisma.product.findFirst({
      where: { id: productId, organizationId },
      select: existingPreviewProductSelect,
    });
    productDetailsById.set(productId, product);
    return product;
  };

  const loadAuxiliaryExistingData = async (productId: string) => {
    if (!existingBarcodesByProductId.has(productId)) {
      const barcodes = await prisma.productBarcode.findMany({
        where: { organizationId, productId },
        select: { value: true },
      });
      existingBarcodesByProductId.set(
        productId,
        barcodes.map((barcode) => barcode.value),
      );
    }
    if (!existingBaseCostByProductId.has(productId)) {
      const cost = await prisma.productCost.findUnique({
        where: {
          organizationId_productId_variantKey: {
            organizationId,
            productId,
            variantKey: "BASE",
          },
        },
        select: { avgCostKgs: true },
      });
      existingBaseCostByProductId.set(productId, cost ? decimalToNumber(cost.avgCostKgs) : null);
    }
    if (storeId && !existingMinStockByProductId.has(productId)) {
      const policy = await prisma.reorderPolicy.findUnique({
        where: { storeId_productId: { storeId, productId } },
        select: { minStock: true },
      });
      existingMinStockByProductId.set(productId, policy?.minStock ?? null);
    }
  };

  const buildPreviewRowsStartedAt = Date.now();
  const previewRows: ImportPreviewRow[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const sourceRowNumber = row.sourceRowNumber ?? index + 1;
    const sku = row.sku.trim();
    const name = row.name?.trim() ?? null;
    const normalizedRowBarcodes = shouldApplyImportField(mode, updateMask, "barcodes")
      ? normalizeBarcodes(row.barcodes)
      : [];
    const normalizedRowCategories = shouldApplyImportField(mode, updateMask, "category")
      ? normalizeRowCategories(row)
      : [];
    const normalizedRowColor = shouldApplyImportField(mode, updateMask, "color")
      ? normalizeRowColor(row.color)
      : null;
    const match = storeId
      ? await resolveProductImportMatch({
          prisma,
          organizationId,
          storeId,
          sku,
          barcodes: normalizedRowBarcodes,
          name,
          categories: normalizedRowCategories,
          basePriceKgs: row.basePriceKgs,
        })
      : ({ reason: "none", product: null } as ProductImportMatch);
    const rowDecision = rowDecisionByNumber.get(sourceRowNumber);
    const matchedExistingSummary = productImportMatchIsExisting(match)
      ? matchProductSummary(match)
      : null;
    const possibleDuplicate =
      match.reason === "possible_duplicate" ? matchProductSummary(match) : null;
    const existingSummary =
      rowDecision?.action === "update" && possibleDuplicate
        ? possibleDuplicate
        : rowDecision?.action === "create"
          ? null
          : matchedExistingSummary;
    const existing = existingSummary ? await loadExistingProductDetails(existingSummary.id) : null;
    if (existing) {
      await loadAuxiliaryExistingData(existing.id);
    }
    const action =
      mode === "update_selected" && !existing
        ? "skipped"
        : productImportMatchIsBlocking(match)
          ? "skipped"
          : rowDecision?.action === "skip"
            ? "skipped"
            : rowDecision?.action === "create" && match.reason === "possible_duplicate"
              ? "create"
              : rowDecision?.action === "update" && existing
                ? "update"
                : resolveRowAction(match, existingBehavior);

    if (!existing && mode === "update_selected") {
      previewRows.push({
        sourceRowNumber,
        sku,
        name,
        action: "skipped",
        matchStatus: resolveMatchStatus(match),
        matchReason: match.reason,
        existingProduct: null,
        possibleDuplicate,
        changes: [],
        warnings: [{ code: "missingExistingProduct", severity: "warning" }],
        hasBlockingWarnings: false,
      });
      continue;
    }

    const warnings: ImportPreviewWarning[] = [];
    const changes: ImportPreviewChange[] = [];

    if (match.reason === "cross_store_barcode" && match.product) {
      warnings.push({
        code: "crossStoreBarcodeConflict",
        severity: "blocking",
        barcode: match.barcode ?? normalizedRowBarcodes[0] ?? "",
        productId: match.product.id,
        productSku: match.product.sku,
        productName: match.product.name,
        isDeleted: match.product.isDeleted,
      });
    } else if (match.reason === "cross_store_sku" && match.product) {
      warnings.push({
        code: "crossStoreSkuConflict",
        severity: "blocking",
        productId: match.product.id,
        productSku: match.product.sku,
        productName: match.product.name,
        isDeleted: match.product.isDeleted,
      });
    } else if (match.reason === "possible_duplicate" && match.product) {
      warnings.push({
        code: "likelyDuplicateName",
        severity: "warning",
        productId: match.product.id,
        productSku: match.product.sku,
        productName: match.product.name,
        isDeleted: match.product.isDeleted,
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
          existing.categories.length
            ? existing.categories
            : existing.category
              ? [existing.category]
              : [],
          normalizedRowCategories,
        );
      }

      if (shouldApplyImportField(mode, updateMask, "color") && normalizedRowColor) {
        addChange(
          changes,
          "color",
          extractVariantColorValues(existing.variants),
          normalizedRowColor,
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

      if (
        shouldApplyImportField(mode, updateMask, "basePriceKgs") &&
        row.basePriceKgs !== undefined
      ) {
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
      if (shouldApplyImportField(mode, updateMask, "stockQty") && row.stockQty !== undefined) {
        addChange(changes, "stockQty", null, row.stockQty);
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
      if (normalizedRowColor) {
        changes.push({ field: "color", before: null, after: normalizedRowColor });
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
      if (row.stockQty !== undefined) {
        changes.push({ field: "stockQty", before: null, after: row.stockQty });
      }
    }

    previewRows.push({
      sourceRowNumber,
      sku,
      name,
      action,
      matchStatus: resolveMatchStatus(match),
      matchReason: match.reason,
      existingProduct: existingSummary,
      possibleDuplicate,
      changes,
      warnings,
      hasBlockingWarnings: warnings.some((warning) => warning.severity === "blocking"),
    });
  }

  const summaryCounts = previewRows.reduce(
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
      if (row.matchStatus === "possible_duplicate") {
        acc.possibleDuplicateCount += 1;
      }
      return acc;
    },
    {
      creates: 0,
      updates: 0,
      skipped: 0,
      warningCount: 0,
      blockingWarningCount: 0,
      possibleDuplicateCount: 0,
    },
  );
  const previewLimit = Math.max(
    0,
    Math.trunc(previewLimitInput ?? DEFAULT_IMPORT_PREVIEW_ROW_LIMIT),
  );
  const responseRows = selectPreviewRows(previewRows, previewLimit);
  const summary = {
    ...summaryCounts,
    totalRows: previewRows.length,
    returnedRows: responseRows.length,
    truncated: responseRows.length < previewRows.length,
  };
  if (logger) {
    logProfileSection({
      logger,
      scope: "products.previewImportCsv",
      section: "buildPreviewRows",
      startedAt: buildPreviewRowsStartedAt,
      details: {
        rows: previewRows.length,
        returnedRows: responseRows.length,
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
    rows: responseRows,
    summary,
  };
};
