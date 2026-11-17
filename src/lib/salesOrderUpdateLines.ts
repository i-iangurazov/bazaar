export type SalesOrderUpdateSourceLine = {
  lineId?: string | null;
  productId: string;
  variantId?: string | null;
  qty: number;
  unitPriceKgs: number | null;
  initialPriceKgs?: number | null;
  priceEdited: boolean;
  priceTouched?: boolean;
  priceSource?: "RETAIL" | "WHOLESALE" | "STANDARD" | "MISSING" | "MANUAL" | null;
  repriced?: boolean;
};

export type SalesOrderUpdateLinePayload = {
  lineId?: string;
  productId: string;
  variantId: string | null;
  qty: number;
  unitPriceKgs?: number;
  priceSource?: "RETAIL" | "WHOLESALE" | "MANUAL";
};

/**
 * Serializes edit-form lines for `updateCustomerOrder`.
 *
 * Provenance is explicit so a saved document keeps the operator's intent:
 * - `priceEdited` wins even when the amount equals the catalogue or the initial
 *   snapshot value. A manual line that was changed 95 → 96 → 95 is still MANUAL.
 * - A bulk-repriced line (`repriced` without `priceEdited`) is sent as RETAIL or
 *   WHOLESALE even when the new amount happens to be unchanged.
 * - `MISSING` and incomplete manual values are omitted so the server keeps the
 *   stored snapshot instead of receiving a fake zero price.
 */
export const serializeSalesOrderUpdateLines = (
  lines: SalesOrderUpdateSourceLine[],
): SalesOrderUpdateLinePayload[] =>
  lines.map((line) => {
    const identity = {
      ...(line.lineId ? { lineId: line.lineId } : {}),
      productId: line.productId,
      variantId: line.variantId ?? null,
      qty: line.qty,
    };
    // A loaded manual/loyalty snapshot is not a new override until the
    // operator actually edits the price in this session. Qty-only edits must
    // let the server re-read restored prices after releasing loyalty.
    if (
      line.priceEdited &&
      line.priceTouched !== false &&
      line.unitPriceKgs !== null &&
      Number.isFinite(line.unitPriceKgs)
    ) {
      return { ...identity, unitPriceKgs: line.unitPriceKgs, priceSource: "MANUAL" as const };
    }
    if (
      line.repriced &&
      !line.priceEdited &&
      line.unitPriceKgs !== null &&
      Number.isFinite(line.unitPriceKgs) &&
      line.priceSource &&
      line.priceSource !== "MISSING" &&
      line.priceSource !== "MANUAL"
    ) {
      return {
        ...identity,
        unitPriceKgs: line.unitPriceKgs,
        priceSource: line.priceSource === "WHOLESALE" ? ("WHOLESALE" as const) : ("RETAIL" as const),
      };
    }
    return identity;
  });
