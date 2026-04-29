import type { Prisma, PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import type { Logger } from "pino";

import type { Locale } from "@/lib/locales";
import {
  archiveProduct,
  arrangeClothingCategoriesWithAi,
  bulkGenerateProductBarcodes,
  bulkGenerateProductDescriptions,
  bulkUpdateProductCategory,
  createProduct,
  duplicateProduct,
  generateProductBarcode,
  restoreProduct,
  type ImportUpdateField,
  updateProduct,
} from "@/server/services/products";
import { generateProductDescriptionFromImages } from "@/server/services/productDescriptions";
import { runProductImport } from "@/server/services/imports";
import { previewProductImport } from "@/server/services/products/importPreview";
import { decimalToNumber } from "@/server/services/products/serializers";
import type {
  BulkGenerateProductBarcodesInput,
  BulkGenerateProductDescriptionsInput,
  BulkUpdateProductCategoryInput,
  ArrangeClothingCategoriesInput,
  CreateProductInput,
  ImportProductsCsvInput,
  PreviewProductsImportCsvInput,
  InlineUpdatePatchInput,
  UpdateProductInput,
} from "@/server/trpc/routers/products.schemas";
import { toTRPCError } from "@/server/trpc/errors";

type PrismaDbClient = PrismaClient | Prisma.TransactionClient;

type ProductMutationContext = {
  organizationId: string;
  actorId: string;
  requestId: string;
};

export const createProductMutation = async ({
  input,
  ...ctx
}: ProductMutationContext & { input: CreateProductInput }) => {
  try {
    return await createProduct({
      organizationId: ctx.organizationId,
      actorId: ctx.actorId,
      requestId: ctx.requestId,
      sku: input.sku,
      name: input.name,
      category: input.category,
      categories: input.categories,
      baseUnitId: input.baseUnitId,
      basePriceKgs: input.basePriceKgs,
      purchasePriceKgs: input.purchasePriceKgs,
      avgCostKgs: input.avgCostKgs,
      description: input.description,
      photoUrl: input.photoUrl,
      images: input.images,
      supplierId: input.supplierId,
      barcodes: input.barcodes,
      isBundle: input.isBundle,
      bundleComponents: input.bundleComponents,
      packs: input.packs,
      variants: input.variants,
    });
  } catch (error) {
    throw toTRPCError(error);
  }
};

export const updateProductMutation = async ({
  input,
  ...ctx
}: ProductMutationContext & { input: UpdateProductInput }) => {
  try {
    return await updateProduct({
      productId: input.productId,
      organizationId: ctx.organizationId,
      actorId: ctx.actorId,
      requestId: ctx.requestId,
      sku: input.sku,
      name: input.name,
      category: input.category,
      categories: input.categories,
      baseUnitId: input.baseUnitId,
      basePriceKgs: input.basePriceKgs,
      purchasePriceKgs: input.purchasePriceKgs,
      avgCostKgs: input.avgCostKgs,
      description: input.description,
      photoUrl: input.photoUrl,
      images: input.images,
      supplierId: input.supplierId ?? undefined,
      barcodes: input.barcodes,
      isBundle: input.isBundle,
      bundleComponents: input.bundleComponents,
      packs: input.packs,
      variants: input.variants,
    });
  } catch (error) {
    throw toTRPCError(error);
  }
};

export const arrangeClothingCategoriesMutation = async ({
  input,
  ...ctx
}: ProductMutationContext & { input: ArrangeClothingCategoriesInput }) => {
  try {
    return await arrangeClothingCategoriesWithAi({
      organizationId: ctx.organizationId,
      actorId: ctx.actorId,
      requestId: ctx.requestId,
      productIds: input.productIds,
    });
  } catch (error) {
    throw toTRPCError(error);
  }
};

export const inlineUpdateProductMutation = async ({
  prisma,
  organizationId,
  actorId,
  requestId,
  productId,
  patch,
}: ProductMutationContext & {
  prisma: PrismaDbClient;
  productId: string;
  patch: InlineUpdatePatchInput;
}) => {
  try {
    const existing = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        organizationId: true,
        sku: true,
        name: true,
        category: true,
        categories: true,
        baseUnitId: true,
        basePriceKgs: true,
        description: true,
        photoUrl: true,
        supplierId: true,
        barcodes: { select: { value: true } },
      },
    });

    if (!existing || existing.organizationId !== organizationId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "productNotFound" });
    }

    const existingCost = await prisma.productCost.findUnique({
      where: {
        organizationId_productId_variantKey: {
          organizationId,
          productId: existing.id,
          variantKey: "BASE",
        },
      },
      select: { avgCostKgs: true },
    });

    return await updateProduct({
      productId: existing.id,
      organizationId,
      actorId,
      requestId,
      sku: existing.sku,
      name: patch.name ?? existing.name,
      category: existing.category,
      categories: existing.categories,
      baseUnitId: patch.baseUnitId ?? existing.baseUnitId,
      basePriceKgs:
        patch.basePriceKgs !== undefined
          ? patch.basePriceKgs
          : decimalToNumber(existing.basePriceKgs),
      avgCostKgs:
        patch.avgCostKgs !== undefined
          ? patch.avgCostKgs
          : decimalToNumber(existingCost?.avgCostKgs),
      description: existing.description,
      photoUrl: existing.photoUrl,
      supplierId: existing.supplierId,
      barcodes: existing.barcodes.map((barcode) => barcode.value),
    });
  } catch (error) {
    throw toTRPCError(error);
  }
};

export const duplicateProductMutation = async ({
  input,
  ...ctx
}: ProductMutationContext & { input: { productId: string; sku?: string } }) => {
  try {
    return await duplicateProduct({
      organizationId: ctx.organizationId,
      actorId: ctx.actorId,
      requestId: ctx.requestId,
      productId: input.productId,
      sku: input.sku,
    });
  } catch (error) {
    throw toTRPCError(error);
  }
};

export const generateProductBarcodeMutation = async ({
  input,
  ...ctx
}: ProductMutationContext & {
  input: { productId: string; mode: "EAN13" | "CODE128"; force?: boolean };
}) => {
  try {
    return await generateProductBarcode({
      organizationId: ctx.organizationId,
      actorId: ctx.actorId,
      requestId: ctx.requestId,
      productId: input.productId,
      mode: input.mode,
      force: input.force,
    });
  } catch (error) {
    throw toTRPCError(error);
  }
};

export const generateProductDescriptionMutation = async ({
  input,
  logger,
}: {
  input: {
    name?: string;
    category?: string;
    isBundle?: boolean;
    locale?: Locale;
    imageUrls: string[];
  };
  logger: Logger;
}) => {
  try {
    return await generateProductDescriptionFromImages({
      name: input.name,
      category: input.category,
      isBundle: input.isBundle,
      locale: input.locale,
      imageUrls: input.imageUrls,
      logger,
    });
  } catch (error) {
    throw toTRPCError(error);
  }
};

export const bulkGenerateProductBarcodesMutation = async ({
  input,
  ...ctx
}: ProductMutationContext & { input: BulkGenerateProductBarcodesInput }) => {
  try {
    return await bulkGenerateProductBarcodes({
      organizationId: ctx.organizationId,
      actorId: ctx.actorId,
      requestId: ctx.requestId,
      mode: input.mode,
      filter: input.filter,
    });
  } catch (error) {
    throw toTRPCError(error);
  }
};

export const bulkGenerateProductDescriptionsMutation = async ({
  input,
  logger,
  ...ctx
}: ProductMutationContext & {
  input: BulkGenerateProductDescriptionsInput;
  logger: Logger;
}) => {
  try {
    return await bulkGenerateProductDescriptions({
      organizationId: ctx.organizationId,
      actorId: ctx.actorId,
      requestId: ctx.requestId,
      productIds: input.productIds,
      locale: input.locale,
      logger,
    });
  } catch (error) {
    throw toTRPCError(error);
  }
};

export const bulkUpdateProductCategoryMutation = async ({
  input,
  ...ctx
}: ProductMutationContext & { input: BulkUpdateProductCategoryInput }) => {
  try {
    return await bulkUpdateProductCategory({
      organizationId: ctx.organizationId,
      actorId: ctx.actorId,
      requestId: ctx.requestId,
      productIds: input.productIds,
      category: input.category ?? null,
      mode: input.mode ?? "add",
    });
  } catch (error) {
    throw toTRPCError(error);
  }
};

export const importProductsCsvMutation = async ({
  input,
  ...ctx
}: ProductMutationContext & { input: ImportProductsCsvInput }) => {
  try {
    if (input.rows.length > 1000) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "importTooLarge" });
    }

    const mode = input.mode ?? "full";
    if (mode === "update_selected" && (!input.updateMask || input.updateMask.length === 0)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "invalidInput" });
    }

    if (mode === "full") {
      const invalidFullRows = input.rows.some((row) => !row.name || !row.unit);
      if (invalidFullRows) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "invalidInput" });
      }
    }

    if (
      input.rows.some((row) => row.minStock !== undefined) &&
      (mode === "full" || input.updateMask?.includes("minStock")) &&
      !input.storeId
    ) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "storeRequired" });
    }

    const result = await runProductImport({
      organizationId: ctx.organizationId,
      actorId: ctx.actorId,
      requestId: ctx.requestId,
      rows: input.rows,
      source: input.source,
      storeId: input.storeId,
      mode,
      updateMask: input.updateMask as ImportUpdateField[] | undefined,
    });

    return {
      batchId: result.batch.id,
      results: result.results,
      summary: result.summary,
    };
  } catch (error) {
    throw toTRPCError(error);
  }
};

export const previewProductsCsvImportMutation = async ({
  prisma,
  organizationId,
  input,
  logger,
}: {
  prisma: PrismaDbClient;
  organizationId: string;
  input: PreviewProductsImportCsvInput;
  logger?: Logger;
}) => {
  try {
    if (input.rows.length > 1000) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "importTooLarge" });
    }

    const mode = input.mode ?? "full";
    if (mode === "update_selected" && (!input.updateMask || input.updateMask.length === 0)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "invalidInput" });
    }

    if (
      input.rows.some((row) => row.minStock !== undefined) &&
      (mode === "full" || input.updateMask?.includes("minStock")) &&
      !input.storeId
    ) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "storeRequired" });
    }

    return await previewProductImport({
      prisma,
      organizationId,
      rows: input.rows,
      storeId: input.storeId,
      mode,
      updateMask: input.updateMask as ImportUpdateField[] | undefined,
      previewLimit: input.previewLimit,
      logger,
    });
  } catch (error) {
    throw toTRPCError(error);
  }
};

export const archiveProductMutation = async ({
  productId,
  ...ctx
}: ProductMutationContext & { productId: string }) => {
  try {
    return await archiveProduct({
      productId,
      organizationId: ctx.organizationId,
      actorId: ctx.actorId,
      requestId: ctx.requestId,
    });
  } catch (error) {
    throw toTRPCError(error);
  }
};

export const restoreProductMutation = async ({
  productId,
  ...ctx
}: ProductMutationContext & { productId: string }) => {
  try {
    return await restoreProduct({
      productId,
      organizationId: ctx.organizationId,
      actorId: ctx.actorId,
      requestId: ctx.requestId,
    });
  } catch (error) {
    throw toTRPCError(error);
  }
};
