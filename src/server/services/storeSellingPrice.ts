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
