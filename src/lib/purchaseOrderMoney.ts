export const PURCHASE_ORDER_MAX_QUANTITY = 2_147_483_647;
export const PURCHASE_ORDER_MAX_UNIT_COST = 9_999_999_999.99;

export const roundPurchaseOrderMoney = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

export const normalizePurchaseOrderUnitCost = (value?: number | null) =>
  value === undefined || value === null ? value : roundPurchaseOrderMoney(value);

export const calculatePurchaseOrderLineTotal = (quantity: number, unitCost: number) =>
  roundPurchaseOrderMoney(quantity * roundPurchaseOrderMoney(unitCost));
