/** Shared price selection. Null means absent; zero is a real price. */
export type StorePriceMode = "RETAIL" | "WHOLESALE";
export function resolveStoreSellingPrice<T>(input: {
  enabled: boolean; mode: StorePriceMode; standard: T; retail?: T | null; wholesale?: T | null;
  // An inherited variant default (or synthetic POS zero) is only the last fallback.
  preferStandard?: boolean;
}): { price: T; source: "STANDARD" | "RETAIL" | "WHOLESALE" } {
  if (!input.enabled) return { price: input.standard, source: "STANDARD" };
  if (input.mode === "WHOLESALE") {
    if (input.wholesale != null) return { price: input.wholesale, source: "WHOLESALE" };
    if (input.retail != null) return { price: input.retail, source: "RETAIL" };
  } else {
    if (input.retail != null) return { price: input.retail, source: "RETAIL" };
    if (input.preferStandard ?? input.standard != null)
      return { price: input.standard, source: "STANDARD" };
    if (input.wholesale != null) return { price: input.wholesale, source: "WHOLESALE" };
  }
  return { price: input.standard, source: "STANDARD" };
}

/**
 * Document price modes must never mix retail into a wholesale document.
 * Unlike the POS resolver, a missing wholesale price is reported instead of
 * silently falling back to retail. A null standard means "no configured price".
 */
export function resolveStrictStoreSellingPrice<T>(input: {
  enabled: boolean;
  mode: StorePriceMode;
  standard: T | null;
  retail?: T | null;
  wholesale?: T | null;
}): { price: T | null; source: "STANDARD" | "RETAIL" | "WHOLESALE" | "MISSING"; hasPrice: boolean } {
  if (!input.enabled) {
    return input.standard != null
      ? { price: input.standard, source: "STANDARD", hasPrice: true }
      : { price: null, source: "MISSING", hasPrice: false };
  }
  if (input.mode === "WHOLESALE") {
    return input.wholesale != null
      ? { price: input.wholesale, source: "WHOLESALE", hasPrice: true }
      : { price: null, source: "MISSING", hasPrice: false };
  }
  const retail = input.retail ?? input.standard;
  return retail != null
    ? { price: retail, source: input.retail != null ? "RETAIL" : "STANDARD", hasPrice: true }
    : { price: null, source: "MISSING", hasPrice: false };
}
