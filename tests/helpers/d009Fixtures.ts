import {
  adjustStock as adjustStockService,
  type StockAdjustmentInput,
} from "@/server/services/inventory";
import {
  createProduct as createProductService,
  type CreateProductInput,
} from "@/server/services/products";

/**
 * Existing integration scenarios need deliberately valued positive-stock setup.
 * D-009 policy tests call the production services directly and do not use these helpers.
 */
export const adjustStockWithExplicitPositiveCost = (input: StockAdjustmentInput) =>
  adjustStockService({
    ...input,
    ...(input.qtyDelta > 0 && input.unitCostKgs == null ? { unitCostKgs: 10 } : {}),
  });

export const createProductWithExplicitOpeningCost = (input: CreateProductInput) => {
  const requestedOpeningStock =
    (input.initialOnHand ?? 0) +
    (input.variants ?? []).reduce((sum, variant) => sum + (variant.initialOnHand ?? 0), 0);
  return createProductService({
    ...input,
    ...(requestedOpeningStock > 0 && input.avgCostKgs == null && input.purchasePriceKgs == null
      ? { avgCostKgs: 10 }
      : {}),
  });
};
