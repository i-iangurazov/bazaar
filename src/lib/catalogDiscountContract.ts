import { z } from "zod";

export const catalogDiscountVariantPolicySchema = z.enum(["ALL_VARIANTS", "SELECTED_VARIANTS"]);

const scopedCatalogDiscountSelectionShape = {
  storeId: z.string().min(1),
  productIds: z.array(z.string().min(1)).min(1).max(5_000),
  variantPolicy: catalogDiscountVariantPolicySchema,
  variantIds: z.array(z.string().min(1)).max(10_000).default([]),
};

const validateSelection = (
  input: { variantPolicy: CatalogDiscountVariantPolicy; variantIds: string[] },
  context: z.RefinementCtx,
) => {
  if (input.variantPolicy === "SELECTED_VARIANTS" && input.variantIds.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["variantIds"],
      message: "catalogDiscountVariantsRequired",
    });
  }
  if (input.variantPolicy === "ALL_VARIANTS" && input.variantIds.length > 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["variantIds"],
      message: "catalogDiscountUnexpectedVariants",
    });
  }
};

const percentageDiscountFields = {
  percentage: z.number().gt(0).lt(100),
  startsAt: z.date().nullable().default(null),
  endsAt: z.date().nullable().default(null),
};

const validateSchedule = (
  input: { startsAt: Date | null; endsAt: Date | null },
  context: z.RefinementCtx,
) => {
  if (input.startsAt && input.endsAt && input.endsAt.getTime() <= input.startsAt.getTime()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endsAt"],
      message: "catalogDiscountEndMustBeAfterStart",
    });
  }
};

export const previewCatalogDiscountInputSchema = z
  .discriminatedUnion("action", [
    z.object({
      action: z.literal("APPLY"),
      ...scopedCatalogDiscountSelectionShape,
      ...percentageDiscountFields,
    }),
    z.object({
      action: z.literal("REMOVE"),
      ...scopedCatalogDiscountSelectionShape,
    }),
  ])
  .superRefine((input, context) => {
    validateSelection(input, context);
    if (input.action === "APPLY") {
      validateSchedule(input, context);
    }
  });

export const applyCatalogDiscountInputSchema = z
  .object({
    idempotencyKey: z.string().min(8).max(200),
    ...scopedCatalogDiscountSelectionShape,
    ...percentageDiscountFields,
  })
  .superRefine((input, context) => {
    validateSelection(input, context);
    validateSchedule(input, context);
  });

export const removeCatalogDiscountInputSchema = z
  .object({
    idempotencyKey: z.string().min(8).max(200),
    ...scopedCatalogDiscountSelectionShape,
  })
  .superRefine((input, context) => {
    validateSelection(input, context);
  });

export const catalogDiscountPreviewSampleSchema = z.object({
  productId: z.string(),
  productName: z.string(),
  variantId: z.string().nullable(),
  variantName: z.string().nullable(),
  currency: z.string().length(3),
  basePrice: z.string(),
  currentPrice: z.string(),
  nextPrice: z.string(),
});

export const catalogDiscountPreviewSchema = z.object({
  selectedProductCount: z.number().int().nonnegative(),
  affectedProductCount: z.number().int().nonnegative(),
  affectedVariantCount: z.number().int().nonnegative(),
  affectedPriceRowCount: z.number().int().nonnegative(),
  productsWithoutPrice: z.array(z.string()),
  productsWithMissingPrices: z.array(z.string()),
  samples: z.array(catalogDiscountPreviewSampleSchema).max(10),
});

export const catalogDiscountOperationResultSchema = z.object({
  operationId: z.string(),
  status: z.enum(["COMPLETED", "QUEUED"]),
  replayed: z.boolean(),
  selectedProductCount: z.number().int().nonnegative(),
  affectedProductCount: z.number().int().nonnegative(),
  affectedPriceRowCount: z.number().int().nonnegative(),
  skippedProductIds: z.array(z.string()),
});

export type CatalogDiscountVariantPolicy = z.infer<typeof catalogDiscountVariantPolicySchema>;
export type PreviewCatalogDiscountInput = z.infer<typeof previewCatalogDiscountInputSchema>;
export type ApplyCatalogDiscountInput = z.infer<typeof applyCatalogDiscountInputSchema>;
export type RemoveCatalogDiscountInput = z.infer<typeof removeCatalogDiscountInputSchema>;
export type CatalogDiscountPreview = z.infer<typeof catalogDiscountPreviewSchema>;
export type CatalogDiscountOperationResult = z.infer<typeof catalogDiscountOperationResultSchema>;

/**
 * Client/server boundary for the Products bulk-discount workflow.
 *
 * The schema-backed router can implement this interface without changing the dialog. Keeping
 * persistence behind this adapter prevents the non-schema UI batch from inventing local state.
 */
export type CatalogDiscountRouterAdapter = {
  preview: (input: PreviewCatalogDiscountInput) => Promise<CatalogDiscountPreview>;
  apply: (input: ApplyCatalogDiscountInput) => Promise<CatalogDiscountOperationResult>;
  remove: (input: RemoveCatalogDiscountInput) => Promise<CatalogDiscountOperationResult>;
};
