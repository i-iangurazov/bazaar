import type { CurrencySource } from "@/lib/currencyDisplay";
import { parseQuantity } from "@/lib/quantity";
import { parseSalesOrderPriceInput } from "@/lib/salesOrderPriceInput";

/**
 * Raw, visible correction drafts. The page keeps exactly what the user typed so
 * an invalid value stays visible instead of being clamped, cleared or dropped.
 */
export type CorrectionReturnDraft = {
  lineId: string;
  qtyInput: string;
  availableQty: number;
  restock: boolean;
};

export type CorrectionAdditionDraft = {
  key: string;
  productId: string;
  variantId: string | null;
  qtyInput: string;
  priceInput: string;
  priceEdited: boolean;
};

export type CorrectionReturnError = "qtyInvalid" | "qtyPositive" | "qtyExceedsAvailable";
export type CorrectionAdditionQtyError = "qtyRequired" | "qtyInvalid" | "qtyPositive";
export type CorrectionAdditionPriceError = "priceRequired" | "priceInvalid";

export type CorrectionAdditionErrors = {
  qty?: CorrectionAdditionQtyError;
  price?: CorrectionAdditionPriceError;
};

export type CorrectionReturnLine = {
  lineId: string;
  qty: number;
  restock: boolean;
};

export type CorrectionAdditionLine = {
  key: string;
  productId: string;
  variantId: string | null;
  qty: number;
  unitPriceKgs?: number;
};

export type CorrectionDraftValidation = {
  returnLines: CorrectionReturnLine[];
  additionLines: CorrectionAdditionLine[];
  returnErrors: Record<string, CorrectionReturnError>;
  additionErrors: Record<string, CorrectionAdditionErrors>;
  hasErrors: boolean;
  hasComposition: boolean;
};

/**
 * Validates the whole visible correction draft. Return rows with an empty
 * quantity are simply not selected; every other invalid row is reported per
 * field. Only rows that pass validation are sent to the quote/confirm request.
 */
export const validateCorrectionDraft = (input: {
  returns: CorrectionReturnDraft[];
  additions: CorrectionAdditionDraft[];
  currency: CurrencySource;
}): CorrectionDraftValidation => {
  const returnLines: CorrectionReturnLine[] = [];
  const returnErrors: Record<string, CorrectionReturnError> = {};

  for (const row of input.returns) {
    if (row.qtyInput.trim() === "") continue;
    const qty = parseQuantity(row.qtyInput);
    if (qty === null) {
      returnErrors[row.lineId] = "qtyInvalid";
      continue;
    }
    if (qty <= 0) {
      returnErrors[row.lineId] = "qtyPositive";
      continue;
    }
    if (qty > row.availableQty) {
      returnErrors[row.lineId] = "qtyExceedsAvailable";
      continue;
    }
    returnLines.push({ lineId: row.lineId, qty, restock: row.restock });
  }

  const additionLines: CorrectionAdditionLine[] = [];
  const additionErrors: Record<string, CorrectionAdditionErrors> = {};

  for (const row of input.additions) {
    const qtyText = row.qtyInput.trim();
    const qty = qtyText === "" ? null : parseQuantity(qtyText);
    let qtyError: CorrectionAdditionQtyError | undefined;
    if (qtyText === "") {
      qtyError = "qtyRequired";
    } else if (qty === null) {
      qtyError = "qtyInvalid";
    } else if (qty <= 0) {
      qtyError = "qtyPositive";
    }

    let priceError: CorrectionAdditionPriceError | undefined;
    let unitPriceKgs: number | undefined;
    if (row.priceEdited) {
      if (row.priceInput.trim() === "") {
        priceError = "priceRequired";
      } else {
        const parsedPrice = parseSalesOrderPriceInput(row.priceInput, input.currency);
        if (parsedPrice === null) {
          priceError = "priceInvalid";
        } else {
          unitPriceKgs = parsedPrice;
        }
      }
    }

    if (qtyError || priceError) {
      additionErrors[row.key] = {
        ...(qtyError ? { qty: qtyError } : {}),
        ...(priceError ? { price: priceError } : {}),
      };
      continue;
    }

    additionLines.push({
      key: row.key,
      productId: row.productId,
      variantId: row.variantId,
      qty: qty as number,
      ...(row.priceEdited ? { unitPriceKgs: unitPriceKgs as number } : {}),
    });
  }

  return {
    returnLines,
    additionLines,
    returnErrors,
    additionErrors,
    hasErrors: Object.keys(returnErrors).length > 0 || Object.keys(additionErrors).length > 0,
    hasComposition: returnLines.length > 0 || additionLines.length > 0,
  };
};
