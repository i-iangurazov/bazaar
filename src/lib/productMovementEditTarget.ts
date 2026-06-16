type MovementEditDocumentType =
  | "SALE"
  | "RETURN"
  | "STOCK_RECEIVING"
  | "PURCHASE_ORDER"
  | "STOCK_COUNT"
  | "TRANSFER"
  | "WRITE_OFF"
  | "ADJUSTMENT"
  | "RECEIVE"
  | "IMPORT"
  | "BUNDLE_ASSEMBLY"
  | "STORE_CLONE"
  | "PRODUCT"
  | "OTHER"
  | string;

export type ProductMovementEditTargetInput = {
  id: string;
  documentId: string;
  documentType: MovementEditDocumentType;
  isPosSale?: boolean | null;
  returnTo?: string | null;
};

export type ProductMovementEditTarget =
  | {
      href: string;
      disabledReason: null;
    }
  | {
      href: null;
      disabledReason:
        | "missingReference"
        | "returnUnsupported"
        | "adjustmentUnsupported"
        | "unsupported";
    };

const decodeMovementDocumentKey = (key: string) => {
  const [documentType, documentReferenceType, ...referenceParts] = key.split(":");
  const documentReferenceId = referenceParts.join(":");
  if (!documentType || !documentReferenceType || !documentReferenceId) {
    return null;
  }
  return { documentType, documentReferenceType, documentReferenceId };
};

const withEditParams = (
  pathname: string,
  input: ProductMovementEditTargetInput,
  includeDocumentKey = true,
) => {
  const params = new URLSearchParams({ from: "movements" });
  if (includeDocumentKey) {
    params.set("documentKey", input.id);
  }
  if (input.returnTo) {
    params.set("returnTo", input.returnTo);
  }
  return `${pathname}?${params.toString()}`;
};

export const getProductMovementEditTarget = (
  input: ProductMovementEditTargetInput,
): ProductMovementEditTarget => {
  const decoded = decodeMovementDocumentKey(input.id);
  const referenceType = decoded?.documentReferenceType;
  const referenceId = decoded?.documentReferenceId || input.documentId;

  if (!referenceId) {
    return { href: null, disabledReason: "missingReference" };
  }

  switch (input.documentType) {
    case "STOCK_RECEIVING":
    case "RECEIVE":
      if (referenceType && referenceType !== "STOCK_RECEIVING") {
        return { href: null, disabledReason: "unsupported" };
      }
      return {
        href: withEditParams(`/inventory/receiving/${encodeURIComponent(referenceId)}/edit`, input),
        disabledReason: null,
      };
    case "TRANSFER":
      if (referenceType && referenceType !== "TRANSFER") {
        return { href: null, disabledReason: "unsupported" };
      }
      return {
        href: withEditParams(`/inventory/transfers/${encodeURIComponent(referenceId)}/edit`, input),
        disabledReason: null,
      };
    case "WRITE_OFF":
      if (referenceType && referenceType !== "WRITE_OFF") {
        return { href: null, disabledReason: "unsupported" };
      }
      return {
        href: withEditParams(`/inventory/write-offs/${encodeURIComponent(referenceId)}/edit`, input),
        disabledReason: null,
      };
    case "STOCK_COUNT":
      return {
        href: withEditParams(`/inventory/counts/${encodeURIComponent(referenceId)}`, input, false),
        disabledReason: null,
      };
    case "PURCHASE_ORDER":
      return {
        href: withEditParams(`/purchase-orders/${encodeURIComponent(referenceId)}`, input, false),
        disabledReason: null,
      };
    case "SALE":
      if (referenceType !== "CustomerOrder") {
        return { href: null, disabledReason: "unsupported" };
      }
      if (input.isPosSale) {
        const params = new URLSearchParams({
          receiptId: referenceId,
          mode: "edit",
          from: "movements",
        });
        if (input.returnTo) {
          params.set("returnTo", input.returnTo);
        }
        return { href: `/pos/sell?${params.toString()}`, disabledReason: null };
      }
      return {
        href: withEditParams(`/sales/orders/${encodeURIComponent(referenceId)}`, input, false),
        disabledReason: null,
      };
    case "RETURN":
      return { href: null, disabledReason: "returnUnsupported" };
    case "ADJUSTMENT":
    case "PRODUCT":
      return { href: null, disabledReason: "adjustmentUnsupported" };
    default:
      return { href: null, disabledReason: "unsupported" };
  }
};
