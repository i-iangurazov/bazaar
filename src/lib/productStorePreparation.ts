import { z } from "zod";

export const productStorePreparationSchema = z
  .object({
    productId: z.string().min(1),
    sourceStoreId: z.string().min(1).optional(),
    targetStoreIds: z.array(z.string().min(1)).min(1).max(50),
    addToAssortment: z.boolean().default(false),
    prices: z.enum(["NONE", "MISSING", "REPLACE"]).default("NONE"),
  })
  .superRefine((input, ctx) => {
    if (input.prices !== "NONE" && !input.sourceStoreId)
      ctx.addIssue({ code: "custom", path: ["sourceStoreId"], message: "storeRequired" });
    if (input.sourceStoreId && input.targetStoreIds.includes(input.sourceStoreId))
      ctx.addIssue({ code: "custom", path: ["targetStoreIds"], message: "transferSameStore" });
  });
export const productStorePreparationApplySchema = z.object({
  change: productStorePreparationSchema,
  token: z.string().min(1).max(2048),
  idempotencyKey: z.string().min(8).max(128),
});
export type ProductStorePreparation = z.infer<typeof productStorePreparationSchema>;
