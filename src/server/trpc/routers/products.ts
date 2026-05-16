import { TRPCError } from "@trpc/server";

import { adminProcedure, managerProcedure, protectedProcedure, rateLimit, router } from "@/server/trpc/trpc";
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
  productDetailInputSchema,
  productBootstrapInputSchema,
  productDuplicateDiagnosticsInputSchema,
  productListIdsInputSchema,
  productListInputSchema,
  productPricingInputSchema,
  productStorePricingInputSchema,
  productsByIdsInputSchema,
  searchQuickProductsInputSchema,
  updateProductInputSchema,
} from "@/server/trpc/routers/products.schemas";
import { assertUserCanAccessStore } from "@/server/services/storeAccess";

export const productsRouter = router({
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
    .query(({ ctx, input }) =>
      getProductDuplicateDiagnosticsQuery({
        prisma: ctx.prisma,
        organizationId: ctx.user.organizationId,
        input,
      }),
    ),

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
    .mutation(({ ctx, input }) => {
      if ((input.initialOnHand ?? 0) > 0 && ctx.user.role !== "ADMIN") {
        throw new TRPCError({ code: "FORBIDDEN", message: "inventoryAdminRequired" });
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
    .mutation(({ ctx, input }) =>
      updateProductMutation({
        organizationId: ctx.user.organizationId,
        actorId: ctx.user.id,
        requestId: ctx.requestId,
        input,
      }),
    ),

  inlineUpdate: managerProcedure
    .input(inlineUpdateProductInputSchema)
    .mutation(({ ctx, input }) =>
      inlineUpdateProductMutation({
        prisma: ctx.prisma,
        organizationId: ctx.user.organizationId,
        actorId: ctx.user.id,
        requestId: ctx.requestId,
        productId: input.productId,
        patch: input.patch,
      }),
    ),

  duplicate: managerProcedure
    .input(duplicateProductInputSchema)
    .mutation(async ({ ctx, input }) => {
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
      return assignProductsToStoreMutation({
        organizationId: ctx.user.organizationId,
        actorId: ctx.user.id,
        requestId: ctx.requestId,
        input,
      });
    }),

  generateBarcode: managerProcedure
    .input(generateProductBarcodeInputSchema)
    .mutation(({ ctx, input }) =>
      generateProductBarcodeMutation({
        organizationId: ctx.user.organizationId,
        actorId: ctx.user.id,
        requestId: ctx.requestId,
        input,
      }),
    ),

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
    .mutation(({ ctx, input }) =>
      bulkGenerateProductBarcodesMutation({
        organizationId: ctx.user.organizationId,
        actorId: ctx.user.id,
        requestId: ctx.requestId,
        input,
      }),
    ),

  bulkGenerateDescriptions: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 30, prefix: "products-descriptions-bulk" }))
    .input(bulkGenerateProductDescriptionsInputSchema)
    .mutation(({ ctx, input }) =>
      bulkGenerateProductDescriptionsMutation({
        organizationId: ctx.user.organizationId,
        actorId: ctx.user.id,
        requestId: ctx.requestId,
        input,
        logger: ctx.logger,
      }),
    ),

  bulkUpdateCategory: managerProcedure
    .input(bulkUpdateProductCategoryInputSchema)
    .mutation(({ ctx, input }) =>
      bulkUpdateProductCategoryMutation({
        organizationId: ctx.user.organizationId,
        actorId: ctx.user.id,
        requestId: ctx.requestId,
        input,
      }),
    ),

  arrangeClothingCategories: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 30, prefix: "products-category-arrange" }))
    .input(arrangeClothingCategoriesInputSchema)
    .mutation(({ ctx, input }) =>
      arrangeClothingCategoriesMutation({
        organizationId: ctx.user.organizationId,
        actorId: ctx.user.id,
        requestId: ctx.requestId,
        input,
      }),
    ),

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
    }),
  ),

  archive: managerProcedure
    .input(archiveProductInputSchema)
    .mutation(({ ctx, input }) =>
      archiveProductMutation({
        organizationId: ctx.user.organizationId,
        actorId: ctx.user.id,
        requestId: ctx.requestId,
        productId: input.productId,
      }),
    ),

  restore: managerProcedure
    .input(archiveProductInputSchema)
    .mutation(({ ctx, input }) =>
      restoreProductMutation({
        organizationId: ctx.user.organizationId,
        actorId: ctx.user.id,
        requestId: ctx.requestId,
        productId: input.productId,
      }),
    ),

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
