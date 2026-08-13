export type ProductMovementDocumentViewTargetInput = {
  id: string;
  documentType: string;
  documentReferenceType: string;
  documentReferenceId: string;
  isPosSale?: boolean | null;
  sourceExists?: boolean;
  linkedCustomerOrderId?: string | null;
  linkedCustomerOrderIsPosSale?: boolean | null;
};

export type ProductMovementDocumentViewTarget = {
  href: string;
  kind: "movement" | "posReceipt" | "customerOrder" | "purchaseOrder" | "stockCount";
  sourceMissing: boolean;
};

const movementDetailTarget = (
  input: Pick<ProductMovementDocumentViewTargetInput, "id">,
  sourceMissing = false,
): ProductMovementDocumentViewTarget => {
  const params = sourceMissing ? "?source=missing" : "";
  return {
    href: `/inventory/movements/${encodeURIComponent(input.id)}${params}`,
    kind: "movement",
    sourceMissing,
  };
};

const posReceiptTarget = (receiptId: string): ProductMovementDocumentViewTarget => ({
  href: `/pos/receipts?receiptId=${encodeURIComponent(receiptId)}`,
  kind: "posReceipt",
  sourceMissing: false,
});

const customerOrderTarget = (customerOrderId: string): ProductMovementDocumentViewTarget => ({
  href: `/sales/orders/${encodeURIComponent(customerOrderId)}`,
  kind: "customerOrder",
  sourceMissing: false,
});

/**
 * Resolves a movement to the native UI for the entity that actually created it.
 *
 * `documentReferenceType` and `documentReferenceId` come directly from StockMovement and are the
 * authoritative source identity. A POS receipt and a Sales Order are both CustomerOrder records;
 * `isPosSale` is therefore required to select the correct native workflow.
 */
export const resolveProductMovementDocumentViewTarget = (
  input: ProductMovementDocumentViewTargetInput,
): ProductMovementDocumentViewTarget => {
  const referenceId = input.documentReferenceId.trim();
  if (!referenceId) {
    return movementDetailTarget(input, true);
  }

  switch (input.documentReferenceType) {
    case "CustomerOrder":
      if (input.sourceExists === false) {
        return movementDetailTarget(input, true);
      }
      return input.isPosSale ? posReceiptTarget(referenceId) : customerOrderTarget(referenceId);
    case "SaleReturn":
      if (input.sourceExists === false) {
        return movementDetailTarget(input, true);
      }
      if (input.linkedCustomerOrderId) {
        return input.linkedCustomerOrderIsPosSale
          ? posReceiptTarget(input.linkedCustomerOrderId)
          : customerOrderTarget(input.linkedCustomerOrderId);
      }
      return movementDetailTarget(input);
    case "PURCHASE_ORDER":
      return input.sourceExists === false
        ? movementDetailTarget(input, true)
        : {
            href: `/purchase-orders/${encodeURIComponent(referenceId)}`,
            kind: "purchaseOrder",
            sourceMissing: false,
          };
    case "STOCK_COUNT":
      return input.sourceExists === false
        ? movementDetailTarget(input, true)
        : {
            href: `/inventory/counts/${encodeURIComponent(referenceId)}`,
            kind: "stockCount",
            sourceMissing: false,
          };
    default:
      // Receiving, transfers, write-offs and adjustments are ledger-native documents. Their
      // canonical read view is the movement document itself; only their edit flow has another URL.
      return movementDetailTarget(input);
  }
};
