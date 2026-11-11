import { describe, expect, it } from "vitest";

import {
  appleContractDigest,
  appleSubscriptionOffer,
  appleWhatsAppOffer,
  listAppleSubscriptionOffers,
  listAppleWhatsAppOffers,
} from "@/server/billing/appleOfferCatalog";
import { createContractTerms } from "@/server/billing/contractTerms";

describe("Apple business offer catalog", () => {
  it("covers the complete current catalog, including every store/reserve combination and term", () => {
    const offers = listAppleSubscriptionOffers(createContractTerms("2026-11"));
    expect(offers).toHaveLength(126);
    expect(new Set(offers.map((offer) => offer.offerKey)).size).toBe(126);
    expect(offers.filter((offer) => offer.selection.plan === "STARTER")).toHaveLength(6);
    expect(offers.filter((offer) => offer.selection.plan === "BUSINESS")).toHaveLength(30);
    expect(offers.filter((offer) => offer.selection.plan === "ENTERPRISE")).toHaveLength(90);

    const maximum = offers.find(
      ({ selection }) =>
        selection.plan === "ENTERPRISE" &&
        selection.months === 12 &&
        selection.extras.stores === 14 &&
        selection.extras.productPacks === 1,
    );
    expect(maximum?.serviceValue).toEqual({
      currency: "KGS",
      amountMinor: 20_400_000,
      monthlyMinor: 2_000_000,
      fullAmountMinor: 24_000_000,
      discountBps: 1500,
    });
    expect(maximum?.entitlements.limits).toEqual({
      maxStores: 15,
      maxProducts: 16000,
      maxActiveUsers: 17,
    });
    expect(maximum?.entitlements.usageLimits.ai).toBe(500);
  });

  it("keeps legacy included stores, people and products without introducing legacy additions", () => {
    const offers = listAppleSubscriptionOffers(createContractTerms("2026-10"));
    expect(offers).toHaveLength(9);
    const monthly = offers.find(
      ({ selection }) => selection.plan === "ENTERPRISE" && selection.months === 1,
    );
    expect(monthly?.entitlements.limits).toEqual({
      maxStores: 15,
      maxProducts: 20000,
      maxActiveUsers: 20,
    });
    expect(monthly?.entitlements.usageLimits.ai).toBeNull();
    expect(() =>
      appleSubscriptionOffer(createContractTerms("2026-10"), {
        plan: "ENTERPRISE",
        months: 1,
        extras: { stores: 0, productPacks: 1, userPacks: 0 },
      }),
    ).toThrow("billingInvalidExtras");
  });

  it.each([
    ["STARTER", 1, 0, 0],
    ["BUSINESS", 5, 0, 0],
    ["ENTERPRISE", 15, 0, 0],
    ["ENTERPRISE", 0, 2, 0],
    ["ENTERPRISE", 0, 0, 1],
  ])(
    "rejects forbidden additions for %s (%s stores, %s reserve, %s old user packs)",
    (plan, stores, productPacks, userPacks) => {
      expect(() =>
        appleSubscriptionOffer(createContractTerms("2026-11"), {
          plan,
          months: 1,
          extras: { stores, productPacks, userPacks },
        }),
      ).toThrow();
    },
  );

  it("does not fall back to Starter for unknown plans or accept unsupported terms", () => {
    const contract = createContractTerms("2026-11");
    expect(() => appleSubscriptionOffer(contract, { plan: "UNKNOWN", months: 1 })).toThrow();
    expect(() => appleSubscriptionOffer(contract, { plan: "BUSINESS", months: 3 })).toThrow();
    expect(() => listAppleSubscriptionOffers({ ...contract, catalogVersion: "future" })).toThrow(
      "billingContractNeedsReview",
    );
  });

  it("binds offers to frozen agreed terms, including custom prices and entitlements", () => {
    const original = createContractTerms("2026-11");
    const negotiated = structuredClone(original);
    negotiated.plans.BUSINESS.monthlyPriceKgs = 3200;
    negotiated.plans.BUSINESS.limits.maxActiveUsers = 7;
    const ordinary = appleSubscriptionOffer(original, { plan: "BUSINESS", months: 1 });
    const custom = appleSubscriptionOffer(negotiated, { plan: "BUSINESS", months: 1 });
    expect(custom.offerKey).not.toBe(ordinary.offerKey);
    expect(custom.entitlements.limits.maxActiveUsers).toBe(7);
    expect(custom.serviceValue.amountMinor).toBe(320_000);
    expect(original.plans.BUSINESS.monthlyPriceKgs).toBe(3500);

    // A published candidate must not change after a caller edits the source.
    negotiated.plans.BUSINESS.limits.maxActiveUsers = 20;
    expect(custom.entitlements.limits.maxActiveUsers).toBe(7);
  });

  it("keeps the same identity when persisted JSON object keys are reordered", () => {
    const terms = createContractTerms("2026-11");
    const reversed = Object.fromEntries(Object.entries(terms).reverse());
    expect(appleContractDigest(reversed)).toBe(appleContractDigest(terms));
  });

  it("includes every existing WhatsApp pack quantity without multiplying subscription quotas", () => {
    const packs = listAppleWhatsAppOffers();
    expect(packs).toHaveLength(10);
    expect(new Set(packs.map((pack) => pack.offerKey)).size).toBe(10);
    expect(packs[0]).toMatchObject({
      quantity: 1,
      messages: 1000,
      serviceValue: { currency: "KGS", amountMinor: 349_000 },
    });
    expect(packs[9]).toMatchObject({
      quantity: 10,
      messages: 10000,
      serviceValue: { currency: "KGS", amountMinor: 3_490_000 },
    });
    expect(() => appleWhatsAppOffer(0)).toThrow();
    expect(() => appleWhatsAppOffer(11)).toThrow();
    expect(() => appleWhatsAppOffer(1, "unrecognized-offer")).toThrow("billingQuoteChanged");
  });
});
