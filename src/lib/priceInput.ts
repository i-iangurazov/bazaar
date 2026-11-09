import { z } from "zod";

/** Parse a price draft without rounding, guessing thousands separators or dropping characters. */
export const parsePriceInput = (value: unknown): number | null => {
  if (typeof value === "number") {
    // Loaded costs and currency conversions may legitimately have more precision.
    // Preserve existing numeric values; the cent-step check applies to typed drafts.
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(raw)) return null;
  const fraction = raw.split(/[.,]/)[1]?.replace(/0+$/, "") ?? "";
  if (fraction.length > 2) return null;
  const parsed = Number(raw.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
};

export const optionalPriceInputSchema = (invalidMessage: string, nonNegativeMessage: string) =>
  z.preprocess(
    (value) => {
      if (value == null || (typeof value === "string" && !value.trim())) return undefined;
      return parsePriceInput(value) ?? NaN;
    },
    z.number({ invalid_type_error: invalidMessage }).min(0, nonNegativeMessage).optional(),
  );
