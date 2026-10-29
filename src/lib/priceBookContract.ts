import { z } from "zod";

const money = z.number().finite().min(0).max(9_999_999_999.99).multipleOf(0.01);
const ids = z.array(z.string().min(1)).min(1).max(100);
export const priceBookEntrySchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1).nullable().optional(),
  retailPriceKgs: money,
  wholesalePriceKgs: money.nullable(),
});
export const priceBookChangeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("PRICES"),
    expectedVersion: z.number().int().min(0).optional(),
    entries: z.array(priceBookEntrySchema).min(1).max(10_000),
  }),
  z.object({ kind: z.literal("CONNECT"), storeIds: ids, preserveLocal: z.boolean() }),
  z.object({ kind: z.literal("DISCONNECT"), storeIds: ids }),
  z.object({
    kind: z.literal("REMOVE"),
    entries: z
      .array(
        z.object({ productId: z.string().min(1), variantId: z.string().nullable().optional() }),
      )
      .min(1)
      .max(10_000),
  }),
  z.object({
    kind: z.literal("SOURCE"),
    storeIds: ids,
    productId: z.string().min(1),
    variantId: z.string().min(1).nullable().optional(),
    retailShared: z.boolean(),
    wholesaleShared: z.boolean(),
  }),
  z.object({ kind: z.literal("ROLLBACK"), changeId: z.string().min(1) }),
]);
export const priceBookRequestSchema = z.object({
  bookId: z.string().min(1),
  change: priceBookChangeSchema,
});
export const priceBookApplySchema = priceBookRequestSchema.extend({
  token: z.string().min(1).max(2048),
  idempotencyKey: z.string().min(8).max(128),
});
export type PriceBookChangeInput = z.infer<typeof priceBookChangeSchema>;
