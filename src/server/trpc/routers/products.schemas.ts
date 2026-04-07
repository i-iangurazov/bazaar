import { z } from "zod";

export const productTypeFilterEnum = z.enum(["all", "product", "bundle"]);
export const productSortKeyEnum = z.enum([
  "sku",
  "name",
  "category",
  "unit",
  "onHandQty",
  "salePrice",
  "avgCost",
  "barcodes",
  "stores",
]);
export const productSortDirectionEnum = z.enum(["asc", "desc"]);
export const barcodeGenerationModeEnum = z.enum(["EAN13", "CODE128"]);
export const productLocaleEnum = z.enum(["ru", "kg"]);
export const importSourceEnum = z.enum(["cloudshop", "onec", "csv"]);
export const importModeEnum = z.enum(["full", "update_selected"]);
export const bulkCategoryModeEnum = z.enum(["add", "setPrimary", "replace"]);

export const importUpdateFieldEnum = z.enum([
  "name",
  "unit",
  "category",
  "description",
  "photoUrl",
  "barcodes",
  "basePriceKgs",
  "purchasePriceKgs",
  "avgCostKgs",
  "minStock",
]);

export const productImageInputSchema = z.object({
  id: z.string().optional(),
  url: z.string().min(1),
  position: z.number().int().optional(),
});

export const productBundleComponentInputSchema = z.object({
  componentProductId: z.string().min(1),
  componentVariantId: z.string().optional().nullable(),
  qty: z.number().int().positive(),
});

export const productPackInputSchema = z.object({
  id: z.string().optional(),
  packName: z.string().min(1),
  packBarcode: z.string().optional().nullable(),
  multiplierToBase: z.number().int().positive(),
  allowInPurchasing: z.boolean().optional(),
  allowInReceiving: z.boolean().optional(),
});

export const productVariantInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  sku: z.string().optional(),
  attributes: z.record(z.unknown()).optional(),
});

export const productListInputSchema = z
  .object({
    search: z.string().optional(),
    category: z.string().optional(),
    type: productTypeFilterEnum.optional(),
    includeArchived: z.boolean().optional(),
    storeId: z.string().optional(),
    page: z.number().int().min(1).optional(),
    pageSize: z.number().int().min(1).max(200).optional(),
    sortKey: productSortKeyEnum.optional(),
    sortDirection: productSortDirectionEnum.optional(),
  })
  .optional();

export const productBootstrapInputSchema = productListInputSchema;

export const productListIdsInputSchema = z
  .object({
    search: z.string().optional(),
    category: z.string().optional(),
    type: productTypeFilterEnum.optional(),
    includeArchived: z.boolean().optional(),
    storeId: z.string().optional(),
  })
  .optional();

export const lookupProductScanInputSchema = z.object({
  q: z.string(),
});

export const findProductByBarcodeInputSchema = z.object({
  value: z.string(),
});

export const searchQuickProductsInputSchema = z.object({
  q: z.string(),
});

export const productsByIdsInputSchema = z.object({
  ids: z.array(z.string()).max(10_000),
});

export const productDetailInputSchema = z.object({
  productId: z.string(),
});

export const productPricingInputSchema = z.object({
  productId: z.string(),
  storeId: z.string().optional(),
});

export const productStorePricingInputSchema = z.object({
  productId: z.string(),
});

export const createProductInputSchema = z.object({
  sku: z.preprocess(
    (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
    z.string().min(2).optional(),
  ),
  name: z.string().min(2),
  category: z.string().optional(),
  categories: z.array(z.string()).optional(),
  baseUnitId: z.string().min(1),
  basePriceKgs: z.number().min(0).optional(),
  purchasePriceKgs: z.number().min(0).optional(),
  avgCostKgs: z.number().min(0).optional(),
  description: z.string().optional(),
  photoUrl: z.string().min(1).optional(),
  images: z.array(productImageInputSchema).optional(),
  supplierId: z.string().optional(),
  barcodes: z.array(z.string()).optional(),
  isBundle: z.boolean().optional(),
  bundleComponents: z.array(productBundleComponentInputSchema).optional(),
  packs: z.array(productPackInputSchema).optional(),
  variants: z.array(productVariantInputSchema).optional(),
});

export const updateProductInputSchema = z.object({
  productId: z.string(),
  sku: z.string().min(2),
  name: z.string().min(2),
  category: z.string().optional(),
  categories: z.array(z.string()).optional(),
  baseUnitId: z.string().min(1),
  basePriceKgs: z.number().min(0).optional(),
  purchasePriceKgs: z.number().min(0).optional(),
  avgCostKgs: z.number().min(0).optional(),
  description: z.string().optional(),
  photoUrl: z.string().min(1).optional(),
  images: z.array(productImageInputSchema).optional(),
  supplierId: z.string().nullable().optional(),
  barcodes: z.array(z.string()).optional(),
  isBundle: z.boolean().optional(),
  bundleComponents: z.array(productBundleComponentInputSchema).optional(),
  packs: z.array(productPackInputSchema).optional(),
  variants: z.array(productVariantInputSchema).optional(),
});

export const inlineUpdatePatchSchema = z
  .object({
    name: z.string().min(2).optional(),
    baseUnitId: z.string().min(1).optional(),
    basePriceKgs: z.number().min(0).nullable().optional(),
    avgCostKgs: z.number().min(0).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "invalidInput",
      });
    }
  });

export const inlineUpdateProductInputSchema = z.object({
  productId: z.string().min(1),
  patch: inlineUpdatePatchSchema,
});

export const duplicateProductInputSchema = z.object({
  productId: z.string(),
  sku: z.string().min(2).optional(),
});

export const generateProductBarcodeInputSchema = z.object({
  productId: z.string().min(1),
  mode: barcodeGenerationModeEnum,
  force: z.boolean().optional(),
});

export const generateProductDescriptionInputSchema = z.object({
  name: z.string().max(300).optional(),
  category: z.string().max(200).optional(),
  isBundle: z.boolean().optional(),
  locale: productLocaleEnum.optional(),
  imageUrls: z.array(z.string().min(1)).min(1).max(6),
});

export const bulkGenerateProductBarcodesFilterSchema = z
  .object({
    productIds: z.array(z.string().min(1)).max(5000).optional(),
    search: z.string().optional(),
    category: z.string().optional(),
    type: productTypeFilterEnum.optional(),
    includeArchived: z.boolean().optional(),
    storeId: z.string().optional(),
    limit: z.number().int().min(1).max(5000).optional(),
  })
  .optional();

export const bulkGenerateProductBarcodesInputSchema = z.object({
  mode: barcodeGenerationModeEnum,
  filter: bulkGenerateProductBarcodesFilterSchema,
});

export const bulkGenerateProductDescriptionsInputSchema = z.object({
  productIds: z.array(z.string().min(1)).min(1).max(25),
  locale: productLocaleEnum.optional(),
});

export const bulkUpdateProductCategoryInputSchema = z.object({
  productIds: z.array(z.string()).min(1),
  category: z.string().optional().nullable(),
  mode: bulkCategoryModeEnum.optional(),
});

export const importCsvRowSchema = z.object({
  sku: z.string().min(2),
  name: z.string().min(2).optional(),
  category: z.string().optional(),
  unit: z.string().min(1).optional(),
  description: z.string().optional(),
  photoUrl: z.string().optional(),
  barcodes: z.array(z.string()).optional(),
  basePriceKgs: z.number().min(0).optional(),
  purchasePriceKgs: z.number().min(0).optional(),
  avgCostKgs: z.number().min(0).optional(),
  minStock: z.number().int().min(0).optional(),
  sourceRowNumber: z.number().int().positive().optional(),
});

export const importProductsCsvInputSchema = z.object({
  rows: z.array(importCsvRowSchema).min(1),
  source: importSourceEnum.optional(),
  storeId: z.string().optional(),
  mode: importModeEnum.optional(),
  updateMask: z.array(importUpdateFieldEnum).optional(),
});

export const previewProductsImportCsvInputSchema = importProductsCsvInputSchema;

export const productDuplicateDiagnosticsInputSchema = z.object({
  productId: z.string().optional(),
  sku: z.string().optional(),
  name: z.string().optional(),
  barcodes: z.array(z.string()).max(100).optional(),
});

export const archiveProductInputSchema = z.object({
  productId: z.string(),
});

export type ProductSortKey = z.infer<typeof productSortKeyEnum>;
export type ProductSortDirection = z.infer<typeof productSortDirectionEnum>;
export type ProductListInput = z.infer<typeof productListInputSchema>;
export type ProductBootstrapInput = z.infer<typeof productBootstrapInputSchema>;
export type ProductListIdsInput = z.infer<typeof productListIdsInputSchema>;
export type CreateProductInput = z.infer<typeof createProductInputSchema>;
export type UpdateProductInput = z.infer<typeof updateProductInputSchema>;
export type InlineUpdatePatchInput = z.infer<typeof inlineUpdatePatchSchema>;
export type InlineUpdateProductInput = z.infer<typeof inlineUpdateProductInputSchema>;
export type BulkGenerateProductBarcodesInput = z.infer<typeof bulkGenerateProductBarcodesInputSchema>;
export type BulkGenerateProductDescriptionsInput = z.infer<
  typeof bulkGenerateProductDescriptionsInputSchema
>;
export type BulkUpdateProductCategoryInput = z.infer<
  typeof bulkUpdateProductCategoryInputSchema
>;
export type ImportProductsCsvInput = z.infer<typeof importProductsCsvInputSchema>;
export type ImportCsvRowInput = z.infer<typeof importCsvRowSchema>;
export type ImportMode = z.infer<typeof importModeEnum>;
export type ImportUpdateField = z.infer<typeof importUpdateFieldEnum>;
export type ProductDuplicateDiagnosticsInput = z.infer<
  typeof productDuplicateDiagnosticsInputSchema
>;
