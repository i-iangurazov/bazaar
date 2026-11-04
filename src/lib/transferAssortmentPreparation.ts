import { z } from "zod";

export const transferAssortmentPreparationSchema = z
  .object({
    fromStoreId: z.string().min(1),
    toStoreId: z.string().min(1),
    selections: z
      .array(
        z
          .object({
            productId: z.string().min(1),
            sourceKey: z.string().min(1).max(200),
          })
          .strict(),
      )
      .min(1)
      .max(500),
    lines: z
      .array(
        z
          .object({
            productId: z.string().min(1),
            variantId: z.string().min(1).nullable().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(500),
    prices: z.enum(["NONE", "MISSING"]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.fromStoreId === value.toStoreId)
      ctx.addIssue({ code: "custom", message: "transferSameStore" });
    const selected = new Set(value.selections.map((s) => s.productId));
    if (
      selected.size !== value.selections.length ||
      value.lines.some((line) => !selected.has(line.productId)) ||
      [...selected].some((id) => !value.lines.some((line) => line.productId === id))
    )
      ctx.addIssue({ code: "custom", message: "invalidInput" });
  });
export const transferAssortmentPreparationApplySchema = z
  .object({
    change: transferAssortmentPreparationSchema,
    token: z.string().min(1).max(300),
    idempotencyKey: z.string().min(8).max(100),
  })
  .strict();

export type TransferAssortmentPreparation = z.infer<typeof transferAssortmentPreparationSchema>;
