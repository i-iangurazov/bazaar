import { describe, expect, it } from "vitest";
import { TRIAL_DAYS, TRIAL_PREVIEW_PLAN } from "@/lib/billing/trial";
import { createContractTerms } from "@/server/billing/contractTerms";
import { createTrialOffer, readTrialOffer } from "@/server/billing/trialPolicy";

describe("one frozen seven-day product preview", () => {
  it("previews internal Enterprise functionality without creating a separate trial for each paid tier", () => {
    const offer = createTrialOffer(createContractTerms("2026-11"));
    expect(TRIAL_DAYS).toBe(7);
    expect(TRIAL_PREVIEW_PLAN).toBe("ENTERPRISE");
    expect(offer).toMatchObject({ version: 1, days: 7, previewPlan: "ENTERPRISE" });
    expect(offer.entitlements.features).toMatchObject({
      pos: true,
      imports: true,
      analytics: true,
      imageStudio: true,
      stockCounts: true,
      bundles: true,
      expiryLots: true,
      periodClose: true,
      replenishment: true,
      loyalty: true,
    });
  });

  it("keeps preview capacity and vendor costs bounded instead of gifting the paid Enterprise limits", () => {
    const offer = createTrialOffer(createContractTerms("2026-11"));
    expect(offer.entitlements.limits).toEqual({ maxStores: 1, maxProducts: 1000, maxActiveUsers: 2 });
    expect(offer.entitlements.usageLimits).toMatchObject({ ai: 100, images: 3, marketingEmails: 0 });
    expect(offer.entitlements.features).toMatchObject({
      emailMarketing: false,
      marketingAutomation: false,
      ownSender: false,
      marketplaces: false,
      bazaarApi: false,
    });
  });

  it("never rewrites the three paid offers when constructing a preview", () => {
    const terms = createContractTerms("2026-11");
    const original = JSON.stringify(terms);
    createTrialOffer(terms);
    expect(JSON.stringify(terms)).toBe(original);
    expect(terms.plans.STARTER.limits).toEqual({ maxStores: 1, maxProducts: 1000, maxActiveUsers: 2 });
    expect(terms.plans.ENTERPRISE.limits.maxProducts).toBe(15000);
    expect(terms.plans.ENTERPRISE.features.marketplaces).toBe(true);
  });

  it("freezes a complete independently copied grant so catalog changes cannot silently change an issued trial", () => {
    const terms = createContractTerms("2026-11");
    const offer = createTrialOffer(terms);
    const issued = JSON.stringify(offer);
    terms.plans.ENTERPRISE.features.analytics = false;
    terms.plans.STARTER.limits.maxProducts = 9999;
    terms.plans.ENTERPRISE.usageLimits.ai = 9999;
    expect(JSON.stringify(offer)).toBe(issued);
    expect(readTrialOffer(JSON.parse(issued))).toEqual(offer);
  });

  it("preserves absence of a preview on legacy, manually approved and lifetime contracts", () => {
    expect(readTrialOffer(null)).toBeNull();
    expect(readTrialOffer(undefined)).toBeNull();
  });

  it.each([
    {},
    { version: 1, days: 14, previewPlan: "ENTERPRISE" },
    { version: 2, days: 7, previewPlan: "ENTERPRISE" },
    { version: 1, days: 7, previewPlan: "STARTER", entitlements: {} },
  ])("fails closed for malformed stored grants rather than guessing access from %j", (invalid) => {
    expect(() => readTrialOffer(invalid)).toThrow("billingContractNeedsReview");
  });
});
