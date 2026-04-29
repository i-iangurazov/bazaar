import { adminProcedure, protectedProcedure, rateLimit, router } from "@/server/trpc/trpc";
import {
  archiveProductMutation,
  arrangeClothingCategoriesMutation,
  bulkGenerateProductBarcodesMutation,
  bulkGenerateProductDescriptionsMutation,
  bulkUpdateProductCategoryMutation,
  createProductMutation,
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
  bulkGenerateProductBarcodesInputSchema,
  bulkGenerateProductDescriptionsInputSchema,
  bulkUpdateProductCategoryInputSchema,
  createProductInputSchema,
  duplicateProductInputSchema,
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

export const productsRouter = router({
  suggestSku: adminProcedure.query(({ ctx }) =>
    getSuggestedProductSku(ctx.user.organizationId),
  ),

  lookupScan: protectedProcedure
    .input(lookupProductScanInputSchema)
    .query(({ ctx, input }) =>
      lookupProductScan({
        prisma: ctx.prisma,
        organizationId: ctx.user.organizationId,
        query: input.q,
      }),
    ),

  findByBarcode: protectedProcedure
    .input(findProductByBarcodeInputSchema)
    .mutation(({ ctx, input }) =>
      findProductByBarcode({
        prisma: ctx.prisma,
        organizationId: ctx.user.organizationId,
        value: input.value,
      }),
    ),

  searchQuick: protectedProcedure
    .input(searchQuickProductsInputSchema)
    .query(({ ctx, input }) =>
      searchQuickProducts({
        prisma: ctx.prisma,
        organizationId: ctx.user.organizationId,
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
        input,
      }),
    ),

  listIds: protectedProcedure
    .input(productListIdsInputSchema)
    .query(({ ctx, input }) =>
      listProductIds({
        prisma: ctx.prisma,
        organizationId: ctx.user.organizationId,
        input,
      }),
    ),

  duplicateDiagnostics: adminProcedure
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
        ids: input.ids,
      }),
    ),

  getById: protectedProcedure
    .input(productDetailInputSchema)
    .query(({ ctx, input }) =>
      getProductById({
        prisma: ctx.prisma,
        organizationId: ctx.user.organizationId,
        productId: input.productId,
      }),
    ),

  pricing: protectedProcedure
    .input(productPricingInputSchema)
    .query(({ ctx, input }) =>
      getProductPricing({
        prisma: ctx.prisma,
        organizationId: ctx.user.organizationId,
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
        productId: input.productId,
      }),
    ),

  create: adminProcedure
    .input(createProductInputSchema)
    .mutation(({ ctx, input }) =>
      createProductMutation({
        organizationId: ctx.user.organizationId,
        actorId: ctx.user.id,
        requestId: ctx.requestId,
        input,
      }),
    ),

  update: adminProcedure
    .input(updateProductInputSchema)
    .mutation(({ ctx, input }) =>
      updateProductMutation({
        organizationId: ctx.user.organizationId,
        actorId: ctx.user.id,
        requestId: ctx.requestId,
        input,
      }),
    ),

  inlineUpdate: adminProcedure
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

  duplicate: adminProcedure
    .input(duplicateProductInputSchema)
    .mutation(({ ctx, input }) =>
      duplicateProductMutation({
        organizationId: ctx.user.organizationId,
        actorId: ctx.user.id,
        requestId: ctx.requestId,
        input,
      }),
    ),

  generateBarcode: adminProcedure
    .input(generateProductBarcodeInputSchema)
    .mutation(({ ctx, input }) =>
      generateProductBarcodeMutation({
        organizationId: ctx.user.organizationId,
        actorId: ctx.user.id,
        requestId: ctx.requestId,
        input,
      }),
    ),

  generateDescription: adminProcedure
    .use(rateLimit({ windowMs: 60_000, max: 6, prefix: "products-description-generate" }))
    .input(generateProductDescriptionInputSchema)
    .mutation(({ ctx, input }) =>
      generateProductDescriptionMutation({
        input,
        logger: ctx.logger,
      }),
    ),

  bulkGenerateBarcodes: adminProcedure
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

  bulkGenerateDescriptions: adminProcedure
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

  bulkUpdateCategory: adminProcedure
    .input(bulkUpdateProductCategoryInputSchema)
    .mutation(({ ctx, input }) =>
      bulkUpdateProductCategoryMutation({
        organizationId: ctx.user.organizationId,
        actorId: ctx.user.id,
        requestId: ctx.requestId,
        input,
      }),
    ),

  arrangeClothingCategories: adminProcedure
    .use(rateLimit({ windowMs: 60_000, max: 6, prefix: "products-category-arrange" }))
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
    .mutation(({ ctx, input }) =>
      importProductsCsvMutation({
        organizationId: ctx.user.organizationId,
        actorId: ctx.user.id,
        requestId: ctx.requestId,
        input,
      }),
    ),

  previewImportCsv: adminProcedure
    .use(rateLimit({ windowMs: 60_000, max: 120, prefix: "products-import-preview" }))
    .input(previewProductsImportCsvInputSchema)
    .mutation(({ ctx, input }) =>
      previewProductsCsvImportMutation({
        prisma: ctx.prisma,
        organizationId: ctx.user.organizationId,
        input,
        logger: ctx.logger,
      }),
    ),

  exportCsv: protectedProcedure.query(({ ctx }) =>
    exportProductsCsv({
      prisma: ctx.prisma,
      organizationId: ctx.user.organizationId,
    }),
  ),

  archive: adminProcedure
    .input(archiveProductInputSchema)
    .mutation(({ ctx, input }) =>
      archiveProductMutation({
        organizationId: ctx.user.organizationId,
        actorId: ctx.user.id,
        requestId: ctx.requestId,
        productId: input.productId,
      }),
    ),

  restore: adminProcedure
    .input(archiveProductInputSchema)
    .mutation(({ ctx, input }) =>
      restoreProductMutation({
        organizationId: ctx.user.organizationId,
        actorId: ctx.user.id,
        requestId: ctx.requestId,
        productId: input.productId,
      }),
    ),
});
