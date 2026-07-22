import { TRPCError } from "@trpc/server";

import { adminProcedure, managerProcedure, protectedProcedure, rateLimit, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import {
  archiveProductMutation,
  arrangeClothingCategoriesMutation,
  assignProductsToStoreMutation,
  bulkGenerateProductBarcodesMutation,
  bulkGenerateProductDescriptionsMutation,
  bulkUpdateProductCategoryMutation,
  createProductMutation,
  deleteProductMutation,
  duplicateProductMutation,
  generateProductBarcodeMutation,
  generateProductDescriptionMutation,
  importProductsCsvMutation,
  inlineUpdateProductMutation,
  previewProductsCsvImportMutation,
  restoreProductMutation,
  updateProductMutation,
} from "@/server/services/products/mutations";
import {
  exportProductsCsv,
  findProductByBarcode,
  getProductDuplicateDiagnosticsQuery,
  getProductById,
  getProductsBootstrap,
  getProductPricing,
  getProductsByIds,
  getProductStorePricing,
  getSuggestedProductSku,
  listProductIds,
  listProducts,
  lookupProductScan,
  searchQuickProducts,
} from "@/server/services/products/read";
import {
  archiveProductInputSchema,
  arrangeClothingCategoriesInputSchema,
  assignProductsToStoreInputSchema,
  bulkGenerateProductBarcodesInputSchema,
  bulkGenerateProductDescriptionsInputSchema,
  bulkUpdateProductCategoryInputSchema,
  createProductInputSchema,
  deleteProductInputSchema,
  duplicateProductInputSchema,
  exportProductsInputSchema,
  findProductByBarcodeInputSchema,
  generateProductBarcodeInputSchema,
  generateProductDescriptionInputSchema,
  importProductsCsvInputSchema,
  inlineUpdateProductInputSchema,
  lookupProductScanInputSchema,
  previewProductsImportCsvInputSchema,
  productDescriptionGenerationJobInputSchema,
  productDetailInputSchema,
  productBootstrapInputSchema,
  productDuplicateDiagnosticsInputSchema,
  productListIdsInputSchema,
  productListInputSchema,
  productPricingInputSchema,
  productStorePricingInputSchema,
  productsByIdsInputSchema,
  searchQuickProductsInputSchema,
  startProductDescriptionGenerationJobInputSchema,
  updateProductInputSchema,
} from "@/server/trpc/routers/products.schemas";
import {
  assertUserCanAccessStore,
  resolveAccessibleStoreIds,
  userHasAllStoreAccess,
} from "@/server/services/storeAccess";
import {
  assertUserCanAccessProduct,
  assertUserCanAccessProducts,
} from "@/server/services/productAccess";
import {
  getProductDescriptionGenerationJob,
  retryFailedProductDescriptionGenerationItems,
  startProductDescriptionGenerationJob,
} from "@/server/services/productDescriptionGenerationJobs";
import { isProductDescriptionGenerationConfigured } from "@/server/services/productDescriptions";
import { isAiDescriptionGenerationEnabled } from "@/lib/featureFlags";

const assertProductAccess = async (
  ...args: Parameters<typeof assertUserCanAccessProducts>
) => {
  try {
    await assertUserCanAccessProducts(...args);
  } catch (error) {
    throw toTRPCError(error);
  }
};

const assertSingleProductAccess = async (
  ...args: Parameters<typeof assertUserCanAccessProduct>
) => {
  try {
    await assertUserCanAccessProduct(...args);
  } catch (error) {
    throw toTRPCError(error);
  }
};

export const productsRouter = router({
  descriptionGenerationAvailability: protectedProcedure.query(() => ({
    enabled: isAiDescriptionGenerationEnabled(),
    configured: isProductDescriptionGenerationConfigured(),
  })),

  suggestSku: managerProcedure.query(({ ctx }) =>
    getSuggestedProductSku(ctx.user.organizationId),
  ),

  lookupScan: protectedProcedure
    .input(lookupProductScanInputSchema)
    .query(({ ctx, input }) =>
      lookupProductScan({
        prisma: ctx.prisma,
        organizationId: ctx.user.organizationId,
        user: ctx.user,
        query: input.q,
      }),
    ),

  findByBarcode: protectedProcedure
    .input(findProductByBarcodeInputSchema)
    .mutation(({ ctx, input }) =>
      findProductByBarcode({
        prisma: ctx.prisma,
        organizationId: ctx.user.organizationId,
        user: ctx.user,
        value: input.value,
      }),
    ),

  searchQuick: protectedProcedure
    .input(searchQuickProductsInputSchema)
    .query(({ ctx, input }) =>
      searchQuickProducts({
        prisma: ctx.prisma,
        organizationId: ctx.user.organizationId,
        user: ctx.user,
        query: input.q,
        storeId: input.storeId,
        limit: input.limit,
      }),
    ),

  bootstrap: protectedProcedure
    .input(productBootstrapInputSchema)
    .query(({ ctx, input }) =>
      getProductsBootstrap({
        prisma: ctx.prisma,
        logger: ctx.logger,
        organizationId: ctx.user.organizationId,
        user: ctx.user,
        input,
      }),
    ),

  list: protectedProcedure
    .input(productListInputSchema)
    .query(({ ctx, input }) =>
      listProducts({
        prisma: ctx.prisma,
        logger: ctx.logger,
        organizationId: ctx.user.organizationId,
        user: ctx.user,
        input,
      }),
    ),

  listIds: protectedProcedure
    .input(productListIdsInputSchema)
    .query(({ ctx, input }) =>
      listProductIds({
        prisma: ctx.prisma,
        organizationId: ctx.user.organizationId,
        user: ctx.user,
        input,
      }),
    ),

  duplicateDiagnostics: managerProcedure
    .input(productDuplicateDiagnosticsInputSchema)
    .query(async ({ ctx, input }) => {
      if (input.productId) {
        await assertSingleProductAccess(ctx.prisma, ctx.user, input.productId, {
          includeArchived: true,
        });
      }
      return getProductDuplicateDiagnosticsQuery({
        prisma: ctx.prisma,
        organizationId: ctx.user.organizationId,
        input,
      });
    }),

  byIds: protectedProcedure
    .input(productsByIdsInputSchema)
    .query(({ ctx, input }) =>
      getProductsByIds({
        prisma: ctx.prisma,
        organizationId: ctx.user.organizationId,
        user: ctx.user,
        ids: input.ids,
      }),
    ),

  getById: protectedProcedure
    .input(productDetailInputSchema)
    .query(({ ctx, input }) =>
      getProductById({
        prisma: ctx.prisma,
        organizationId: ctx.user.organizationId,
        user: ctx.user,
        productId: input.productId,
      }),
    ),

  pricing: protectedProcedure
    .input(productPricingInputSchema)
    .query(({ ctx, input }) =>
      getProductPricing({
        prisma: ctx.prisma,
        organizationId: ctx.user.organizationId,
        user: ctx.user,
        productId: input.productId,
        storeId: input.storeId,
      }),
    ),

  storePricing: protectedProcedure
    .input(productStorePricingInputSchema)
    .query(({ ctx, input }) =>
      getProductStorePricing({
        prisma: ctx.prisma,
        organizationId: ctx.user.organizationId,
        user: ctx.user,
        productId: input.productId,
      }),
    ),

  create: managerProcedure
    .input(createProductInputSchema)
    .mutation(async ({ ctx, input }) => {
      const requestsInitialInventory =
        (input.initialOnHand ?? 0) > 0 ||
        (input.variants ?? []).some((variant) => (variant.initialOnHand ?? 0) > 0);
      if (requestsInitialInventory && ctx.user.role !== "ADMIN") {
        throw new TRPCError({ code: "FORBIDDEN", message: "inventoryAdminRequired" });
      }
      if (input.storeId) {
        await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);
      }
      return createProductMutation({
        organizationId: ctx.user.organizationId,
        actorId: ctx.user.id,
        requestId: ctx.requestId,
        input,
      });
    }),

  update: managerProcedure
    .input(updateProductInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertSingleProductAccess(ctx.prisma, ctx.user, input.productId);
      if (input.storeId) {
        await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);
      }
      return updateProductMutation({
        organizationId: ctx.user.organizationId,
        actorId: ctx.user.id,
        requestId: ctx.requestId,
        input,
      });
    }),

  inlineUpdate: managerProcedure
    .input(inlineUpdateProductInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertSingleProductAccess(ctx.prisma, ctx.user, input.productId);
      return inlineUpdateProductMutation({
        prisma: ctx.prisma,
        organizationId: ctx.user.organizationId,
        actorId: ctx.user.id,
        requestId: ctx.requestId,
        productId: input.productId,
        patch: input.patch,
      });
    }),

  duplicate: managerProcedure
    .input(duplicateProductInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertSingleProductAccess(ctx.prisma, ctx.user, input.productId);
      if (input.storeId) {
        await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);
      }
      return duplicateProductMutation({
        organizationId: ctx.user.organizationId,
        actorId: ctx.user.id,
        requestId: ctx.requestId,
        input,
      });
    }),

  assignToStore: managerProcedure
    .input(assignProductsToStoreInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);
      await assertProductAccess(ctx.prisma, ctx.user, input.productIds);
      return assignProductsToStoreMutation({
        organizationId: ctx.user.organizationId,
        actorId: ctx.user.id,
        requestId: ctx.requestId,
        input,
      });
    }),

  generateBarcode: managerProcedure
    .input(generateProductBarcodeInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertSingleProductAccess(ctx.prisma, ctx.user, input.productId);
      return generateProductBarcodeMutation({
        organizationId: ctx.user.organizationId,
        actorId: ctx.user.id,
        requestId: ctx.requestId,
        input,
      });
    }),

  generateDescription: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 6, prefix: "products-description-generate" }))
    .input(generateProductDescriptionInputSchema)
    .mutation(({ ctx, input }) =>
      generateProductDescriptionMutation({
        input,
        logger: ctx.logger,
      }),
    ),

  bulkGenerateBarcodes: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 3, prefix: "products-barcodes-bulk" }))
    .input(bulkGenerateProductBarcodesInputSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.filter?.storeId) {
        await assertUserCanAccessStore(ctx.prisma, ctx.user, input.filter.storeId);
      }
      if (input.filter?.productIds?.length) {
        await assertProductAccess(ctx.prisma, ctx.user, input.filter.productIds, {
          includeArchived: input.filter.includeArchived,
        });
      }
      const accessibleStoreIds = userHasAllStoreAccess(ctx.user)
        ? undefined
        : await resolveAccessibleStoreIds(ctx.prisma, ctx.user);
      return bulkGenerateProductBarcodesMutation({
        organizationId: ctx.user.organizationId,
        actorId: ctx.user.id,
        requestId: ctx.requestId,
        input,
        accessibleStoreIds,
      });
    }),

  bulkGenerateDescriptions: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 30, prefix: "products-descriptions-bulk" }))
    .input(bulkGenerateProductDescriptionsInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertProductAccess(ctx.prisma, ctx.user, input.productIds);
      return bulkGenerateProductDescriptionsMutation({
        organizationId: ctx.user.organizationId,
        actorId: ctx.user.id,
        requestId: ctx.requestId,
        input,
        logger: ctx.logger,
      });
    }),

  startDescriptionGenerationJob: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 10, prefix: "products-descriptions-job-start" }))
    .input(startProductDescriptionGenerationJobInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertProductAccess(ctx.prisma, ctx.user, input.productIds);
      if (input.storeId) {
        await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);
      }
      return startProductDescriptionGenerationJob({
        organizationId: ctx.user.organizationId,
        actorId: ctx.user.id,
        requestId: ctx.requestId,
        source: input.source,
        storeId: input.storeId,
        productIds: input.productIds,
        locale: input.locale,
        overwriteExisting: input.overwriteExisting,
        logger: ctx.logger,
      });
    }),

  descriptionGenerationJob: protectedProcedure
    .input(productDescriptionGenerationJobInputSchema)
    .query(({ ctx, input }) =>
      getProductDescriptionGenerationJob(ctx.user.organizationId, input.jobId),
    ),

  retryDescriptionGenerationJobFailed: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 10, prefix: "products-descriptions-job-retry" }))
    .input(productDescriptionGenerationJobInputSchema)
    .mutation(({ ctx, input }) =>
      retryFailedProductDescriptionGenerationItems({
        organizationId: ctx.user.organizationId,
        actorId: ctx.user.id,
        requestId: ctx.requestId,
        jobId: input.jobId,
        logger: ctx.logger,
      }),
    ),

  bulkUpdateCategory: managerProcedure
    .input(bulkUpdateProductCategoryInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertProductAccess(ctx.prisma, ctx.user, input.productIds);
      return bulkUpdateProductCategoryMutation({
        organizationId: ctx.user.organizationId,
        actorId: ctx.user.id,
        requestId: ctx.requestId,
        input,
      });
    }),

  arrangeClothingCategories: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 30, prefix: "products-category-arrange" }))
    .input(arrangeClothingCategoriesInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertProductAccess(ctx.prisma, ctx.user, input.productIds);
      return arrangeClothingCategoriesMutation({
        organizationId: ctx.user.organizationId,
        actorId: ctx.user.id,
        requestId: ctx.requestId,
        input,
      });
    }),

  importCsv: adminProcedure
    .use(rateLimit({ windowMs: 60_000, max: 120, prefix: "products-import" }))
    .input(importProductsCsvInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);
      return importProductsCsvMutation({
        organizationId: ctx.user.organizationId,
        actorId: ctx.user.id,
        requestId: ctx.requestId,
        input,
      });
    }),

  previewImportCsv: adminProcedure
    .use(rateLimit({ windowMs: 60_000, max: 120, prefix: "products-import-preview" }))
    .input(previewProductsImportCsvInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);
      return previewProductsCsvImportMutation({
        prisma: ctx.prisma,
        organizationId: ctx.user.organizationId,
        input,
        logger: ctx.logger,
      });
    }),

  exportCsv: protectedProcedure.input(exportProductsInputSchema).query(({ ctx, input }) =>
    exportProductsCsv({
      prisma: ctx.prisma,
      organizationId: ctx.user.organizationId,
      user: ctx.user,
      storeId: input?.storeId,
      columns: input?.columns,
    }),
  ),

  archive: managerProcedure
    .input(archiveProductInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertSingleProductAccess(ctx.prisma, ctx.user, input.productId);
      return archiveProductMutation({
        organizationId: ctx.user.organizationId,
        actorId: ctx.user.id,
        requestId: ctx.requestId,
        productId: input.productId,
      });
    }),

  restore: managerProcedure
    .input(archiveProductInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertSingleProductAccess(ctx.prisma, ctx.user, input.productId, {
        includeArchived: true,
      });
      return restoreProductMutation({
        organizationId: ctx.user.organizationId,
        actorId: ctx.user.id,
        requestId: ctx.requestId,
        productId: input.productId,
      });
    }),

  deletePermanent: adminProcedure
    .input(deleteProductInputSchema)
    .mutation(({ ctx, input }) =>
      deleteProductMutation({
        organizationId: ctx.user.organizationId,
        actorId: ctx.user.id,
        requestId: ctx.requestId,
        productId: input.productId,
      }),
    ),
});
