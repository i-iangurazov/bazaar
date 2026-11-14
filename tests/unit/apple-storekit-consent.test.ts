import { describe, expect, it } from "vitest";
import { appleStoreKitConsentSchema, appleStoreKitPriceConstraint, assertAppleStoreKitReceiptConsent,
  readAppleStoreKitConsent, sameAppleStoreKitConsent } from "@/server/billing/appleStoreKitConsent";

const consent = { storefrontId: "143586", currency: "USD", priceMillis: "24950", displayPrice: "$24.95" };
const snapshot = (value: unknown) => ({ appleProduct: { storeKitConsent: value } });

describe("immutable buyer-observed StoreKit price", () => {
  it("retains exact native milliunits and literal display text without parsing or conversion", () => {
    const value = { ...consent, displayPrice: "24,95 $" };
    expect(readAppleStoreKitConsent(snapshot(value))).toEqual(value);
    expect(appleStoreKitPriceConstraint(value)).toEqual({ storefrontId: "143586", currency: "USD", priceMillis: "24950" });
  });
  it.each(["0", "1", "26950", String(Number.MAX_SAFE_INTEGER)])("accepts canonical safe milliunits %s", (priceMillis) => {
    expect(appleStoreKitConsentSchema.safeParse({ ...consent, priceMillis }).success).toBe(true);
  });
  it.each(["", "01", "1.0", "1e3", "-1", "+1", " 24950", "24950 ", "9007199254740992", "9999999999999999999999999999999"])
    ("rejects malformed or unsafe milliunits %s without throwing", (priceMillis) => {
      expect(appleStoreKitConsentSchema.safeParse({ ...consent, priceMillis }).success).toBe(false);
    });
  it.each([{ currency: "usd" }, { currency: "US" }, { storefrontId: "KGZ" }, { storefrontId: "1".repeat(41) },
    { displayPrice: "" }, { displayPrice: "x".repeat(161) }, { exchangeRate: "87.45" }])("rejects invalid native metadata %j", (change) => {
      expect(appleStoreKitConsentSchema.safeParse({ ...consent, ...change }).success).toBe(false);
    });
  it("distinguishes absent historical consent from an invalid present marker", () => {
    expect(readAppleStoreKitConsent({ kind: "SUBSCRIPTION" })).toBeNull();
    expect(readAppleStoreKitConsent({ appleProduct: { subscriptionGroupId: "old" } })).toBeNull();
    for (const value of [null, {}, { ...consent, priceMillis: "01" }]) {
      expect(() => readAppleStoreKitConsent(snapshot(value))).toThrow("applePriceChanged");
    }
  });
  it("does not use a localized display string as receipt money", () => {
    expect(() => assertAppleStoreKitReceiptConsent({ ...consent, displayPrice: "$26.95" },
      { price: 24950, currency: "USD", storefrontId: "143586" })).not.toThrow();
  });
  it.each([{ price: 26950, currency: "USD", storefrontId: "143586" }, { price: 24950, currency: "EUR", storefrontId: "143586" },
    { price: 24950, currency: "USD", storefrontId: "143441" }, { price: undefined, currency: "USD", storefrontId: "143586" },
    { price: 24950, currency: undefined, storefrontId: "143586" }, { price: 24950, currency: "USD", storefrontId: undefined }])
    ("requires every exact signed receipt field %j", (receipt) => {
      expect(() => assertAppleStoreKitReceiptConsent(consent, receipt)).toThrow("applePriceChanged");
    });
  it("keeps historical markerless receipts recoverable and catches changed idempotent consent", () => {
    expect(() => assertAppleStoreKitReceiptConsent(null, { price: 26950, currency: "USD" })).not.toThrow();
    expect(sameAppleStoreKitConsent(consent, { ...consent })).toBe(true);
    expect(sameAppleStoreKitConsent(consent, { ...consent, priceMillis: "26950" })).toBe(false);
    expect(sameAppleStoreKitConsent(consent, { ...consent, displayPrice: "$26.95" })).toBe(false);
  });
});
