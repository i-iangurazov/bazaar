import { z } from "zod";

const money = z.number().finite().min(0).max(9_999_999_999.99).multipleOf(0.01);
export const stockReceivingCommerceSchema = z.object({
  storeId: z.string().min(1),
  date: z.string().datetime().optional(),
  supplierName: z.string().trim().max(160).optional(),
  referenceNumber: z.string().trim().max(80).optional(),
  note: z.string().trim().max(1_000).optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        variantId: z.string().min(1).nullable().optional(),
        quantity: z.number().finite().positive().multipleOf(0.001),
        // Purchase costs retain the existing KGS contract, including stored drafts.
        unitCost: money,
        // Absence means keep the current selected-store selling price. Zero is explicit.
        salePriceKgs: money.optional(),
      }),
    )
    .min(1)
    .max(500),
});
export const reviewedStockReceivingSchema = z.object({
  receiving: stockReceivingCommerceSchema,
  token: z.string().min(1).max(512),
  idempotencyKey: z.string().min(8).max(160),
});
export type StockReceivingCommerce = z.infer<typeof stockReceivingCommerceSchema>;
export type ReviewedStockReceiving = z.infer<typeof reviewedStockReceivingSchema>;

export type ReceivingCostState = {
  quantity: number;
  unitCostKgs: number | null;
  status: "KNOWN" | "UNKNOWN";
  reason: string | null;
};
export type ReceivingCommercePreview = {
  token: string;
  expiresAt: string;
  currencyCode: string;
  currencyRateKgsPerUnit: number;
  pricingAllowed: boolean;
  retailWholesaleEnabled: boolean;
  lines: Array<{
    productId: string;
    variantId: string | null;
    unitId: string;
    unitLabel: string;
    currentSalePriceKgs: number | null;
    sharedRetail: boolean;
    changesSalePrice: boolean;
    valuation: { current: ReceivingCostState; projected: ReceivingCostState };
  }>;
};
