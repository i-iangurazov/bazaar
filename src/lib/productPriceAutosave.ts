import { z } from "zod";
const money = z.number().finite().min(0).max(9_999_999_999.99).nullable();
export const productPricePatchSchema = z
  .object({
    variantId: z.string().min(1).max(191).nullable().optional(),
    retailPriceKgs: money.optional(),
    wholesalePriceKgs: money.optional(),
  })
  .strict()
  .refine(
    (p) => p.retailPriceKgs !== undefined || p.wholesalePriceKgs !== undefined,
    "invalidInput",
  );
export const productPriceAutosaveSchema = z
  .object({
    productId: z.string().min(1).max(191),
    storeId: z.string().min(1).max(191),
    unitId: z.string().min(1).max(191),
    currencyCode: z.enum(["KGS", "USD", "GBP"]),
    currencyRateKgsPerUnit: z.number().finite().positive(),
    expectedVersion: z.string().regex(/^[a-f0-9]{64}$/),
    idempotencyKey: z.string().min(8).max(128),
    prices: z.array(productPricePatchSchema).min(1).max(500),
  })
  .strict()
  .refine(
    (c) => new Set(c.prices.map((p) => p.variantId ?? "BASE")).size === c.prices.length,
    "invalidInput",
  );
export type ProductPricePatch = z.infer<typeof productPricePatchSchema>;
export type ProductPriceAutosaveRequest = z.infer<typeof productPriceAutosaveSchema>;
export const priceAutosavePendingKey = (
  org: string,
  user: string,
  product: string,
  store: string,
) => `bazaar:price-autosave:v1:${org}:${user}:${product}:${store}`;
export function readPriceAutosavePending(
  storage: Storage,
  key: string,
  productId: string,
  storeId: string,
): ProductPriceAutosaveRequest | null {
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    if (raw.length > 150_000) throw new Error("size");
    const data = JSON.parse(raw);
    const request = productPriceAutosaveSchema.parse(data.request);
    if (
      data.version !== 1 ||
      !Number.isFinite(data.at) ||
      data.at > Date.now() + 60_000 ||
      Date.now() - data.at > 8 * 60 * 60_000 ||
      request.productId !== productId ||
      request.storeId !== storeId
    )
      throw new Error("scope");
    return request;
  } catch {
    storage.removeItem(key);
    return null;
  }
}
export function savePriceAutosavePending(
  storage: Storage,
  key: string,
  request: ProductPriceAutosaveRequest,
) {
  const raw = JSON.stringify({
    version: 1,
    at: Date.now(),
    request: productPriceAutosaveSchema.parse(request),
  });
  if (raw.length > 150_000) throw new Error("productPreparationStorageUnavailable");
  storage.setItem(key, raw);
}
