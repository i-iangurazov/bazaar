import { z } from "zod";
import { AppError } from "@/server/services/errors";

/** Money comes from StoreKit's decimal price, never a formatted string or FX calculation. */
export const appleStoreKitConsentSchema = z.object({
  storefrontId: z.string().regex(/^[0-9]{1,40}$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  priceMillis: z.string().regex(/^(0|[1-9][0-9]{0,15})$/)
    .refine((value) => /^[0-9]{1,16}$/.test(value) && BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER)),
  displayPrice: z.string().min(1).max(160).optional(),
}).strict();
export type AppleStoreKitConsent = z.infer<typeof appleStoreKitConsentSchema>;

/** A missing marker is historical data; a present invalid marker must fail closed. */
export function readAppleStoreKitConsent(snapshot: unknown): AppleStoreKitConsent | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const product = (snapshot as Record<string, unknown>).appleProduct;
  if (!product || typeof product !== "object" || Array.isArray(product)) return null;
  if (!Object.prototype.hasOwnProperty.call(product, "storeKitConsent")) return null;
  const result = appleStoreKitConsentSchema.safeParse((product as Record<string, unknown>).storeKitConsent);
  if (!result.success) throw new AppError("applePriceChanged", "CONFLICT", 409);
  return result.data;
}

export function appleStoreKitPriceConstraint(consent: AppleStoreKitConsent | null) {
  return consent ? { storefrontId: consent.storefrontId, currency: consent.currency, priceMillis: consent.priceMillis } : null;
}

export function sameAppleStoreKitConsent(left: AppleStoreKitConsent, right: AppleStoreKitConsent) {
  return left.storefrontId === right.storefrontId && left.currency === right.currency && left.priceMillis === right.priceMillis &&
    left.displayPrice === right.displayPrice;
}

/** Call only after retaining the verified payment. A discrepancy needs recovery, never a second charge. */
export function assertAppleStoreKitReceiptConsent(consent: AppleStoreKitConsent | null,
  receipt: { price?: number; currency?: string; storefrontId?: string }) {
  if (consent && (receipt.price === undefined || !Number.isSafeInteger(receipt.price) || receipt.price < 0 ||
    String(receipt.price) !== consent.priceMillis || receipt.currency !== consent.currency || receipt.storefrontId !== consent.storefrontId))
    throw new AppError("applePriceChanged", "CONFLICT", 409);
}
