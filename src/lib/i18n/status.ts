import type { CustomerOrderStatus, PurchaseOrderStatus, StockMovementType } from "@prisma/client";

export type Translator = (key: string) => string;
export type GenericStatus = "success" | "warning" | "pending" | "danger";

export const getPurchaseOrderStatusLabel = (
  tPurchaseOrders: Translator,
  status?: PurchaseOrderStatus | string | null,
) => {
  switch (status) {
    case "DRAFT":
      return tPurchaseOrders("status.draft");
    case "SUBMITTED":
      return tPurchaseOrders("status.submitted");
    case "APPROVED":
      return tPurchaseOrders("status.approved");
    case "PARTIALLY_RECEIVED":
      return tPurchaseOrders("status.partiallyReceived");
    case "RECEIVED":
      return tPurchaseOrders("status.received");
    case "CANCELLED":
      return tPurchaseOrders("status.cancelled");
    default:
      return status ?? "";
  }
};

export const getCustomerOrderStatusLabel = (
  tSalesOrders: Translator,
  status?: CustomerOrderStatus | string | null,
) => {
  switch (status) {
    case "DRAFT":
      return tSalesOrders("status.draft");
    case "CONFIRMED":
      return tSalesOrders("status.confirmed");
    case "READY":
      return tSalesOrders("status.ready");
    case "COMPLETED":
      return tSalesOrders("status.completed");
    case "CANCELED":
      return tSalesOrders("status.canceled");
    default:
      return status ?? "";
  }
};

export const getStockMovementLabel = (
  tInventory: Translator,
  type?: StockMovementType | string | null,
) => {
  switch (type) {
    case "RECEIVE":
      return tInventory("movementType.receive");
    case "SALE":
      return tInventory("movementType.sale");
    case "ADJUSTMENT":
      return tInventory("movementType.adjustment");
    case "TRANSFER_IN":
      return tInventory("movementType.transferIn");
    case "TRANSFER_OUT":
      return tInventory("movementType.transferOut");
    default:
      return type ?? "";
  }
};

export const getGenericStatusLabel = (
  tCommon: Translator,
  status?: GenericStatus | string | null,
) => {
  switch (status) {
    case "success":
      return tCommon("statuses.success");
    case "warning":
      return tCommon("statuses.warning");
    case "pending":
      return tCommon("statuses.pending");
    case "danger":
      return tCommon("statuses.danger");
    default:
      return status ?? "";
  }
};
