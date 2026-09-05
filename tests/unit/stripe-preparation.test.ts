import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assessStripePreparation,
  captureLegacyFreeSnapshot,
  prospectiveUkStripePreparation,
  resolvePreparedEntitlements,
  type CapturedEntitlements,
  type LegacyFreeSnapshot,
} from "@/server/billing/stripePreparation";

const original = (): CapturedEntitlements => ({
  plan: "ENTERPRISE",
  limits: { stores: 15, users: 20, products: 20000, customUnlimited: null },
  features: { analytics: true, emailMarketing: true, customFeature: false },
  access: {
    hasAccess: true,
    customGrant: { source: "owner-approved", tags: ["preserve", "free"] },
  },
});
const reducedCatalog = (): CapturedEntitlements => ({
  plan: "STARTER",
  limits: { stores: 1, users: 1, products: 50 },
  features: { analytics: false },
  access: { hasAccess: false },
});
const capture = () =>
  captureLegacyFreeSnapshot({
    businessId: "existing-a",
    capturedAt: "2026-01-02T03:04:05Z",
    entitlements: original(),
  });

describe("inactive Stripe preparation and protected legacy snapshots", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("records proposed UK setup without inventing a seller, sandbox, price, or rollout cutoff", () => {
    expect(prospectiveUkStripePreparation).toMatchObject({
      proposedAccountCountry: "GB",
      legalEntityConfirmed: false,
      accountApproved: false,
      sandboxAuthorized: false,
      approvedPrices: null,
      approvedCohortCutoff: null,
    });
    const report = assessStripePreparation(prospectiveUkStripePreparation);
    expect(report.blockers).toEqual(
      expect.arrayContaining([
        "LEGAL_SELLER_UNCONFIRMED",
        "NO_AUTHORIZED_SANDBOX",
        "PRICING_NOT_APPROVED",
        "COHORT_CUTOFF_NOT_APPROVED",
        "DURABLE_COHORT_STORAGE_NOT_READY",
      ]),
    );
    expect(report.canCreatePaymentObjects).toBe(false);
  });

  it("cannot be activated by environment flags or even claimed-ready prerequisites", () => {
    vi.stubEnv("STRIPE_ENABLED", "true");
    vi.stubEnv("STRIPE_SECRET_KEY", "synthetic-not-a-provider-key");
    const result = assessStripePreparation({
      proposedAccountCountry: "GB",
      legalEntityConfirmed: true,
      accountApproved: true,
      sandboxAuthorized: true,
      approvedPrices: [{ priceId: "price_synthetic", currency: "gbp", interval: "month" }],
      approvedCohortCutoff: "2099-01-01T00:00:00Z",
      durableCohortStorageReady: true,
    });
    expect(result).toMatchObject({
      mode: "INACTIVE_PREPARATION",
      canCreatePaymentObjects: false,
      requiresPaymentMethod: false,
      blockers: ["INTEGRATION_NOT_IMPLEMENTED_OR_ACTIVATED"],
    });
  });

  it("clones and freezes nested entitlements without changing captured values", () => {
    const input = original();
    const before = JSON.parse(JSON.stringify(input));
    const snapshot = captureLegacyFreeSnapshot({
      businessId: "existing-a",
      capturedAt: "2026-01-02T03:04:05Z",
      entitlements: input,
    });
    expect(snapshot.entitlements).toEqual(before);
    expect(snapshot.entitlements).not.toBe(input);
    expect(Object.isFrozen(snapshot.entitlements.access.customGrant)).toBe(true);
    (input.limits as Record<string, number | null>).stores = 1;
    expect(snapshot.entitlements).toEqual(before);
    expect(() => {
      (snapshot.entitlements.features as Record<string, boolean>).analytics = false;
    }).toThrow();
  });

  it("keeps exact legacy entitlements through catalog downgrade, provider outage, replay and out-of-order observations", () => {
    const snapshot = capture();
    const before = JSON.parse(JSON.stringify(snapshot.entitlements));
    for (const eventType of [
      "provider_outage",
      "invoice.payment_failed",
      "customer.subscription.deleted",
      "checkout.session.completed",
      "invoice.paid",
      "invoice.payment_failed",
      "out_of_order",
    ]) {
      const decision = resolvePreparedEntitlements({
        businessId: "existing-a",
        snapshot,
        currentEntitlements: reducedCatalog(),
        stripeObservation: {
          eventType,
          eventId: "replayed-event",
          createdAt: "2025-01-01T00:00:00Z",
        },
      });
      expect(decision).toMatchObject({
        cohort: "LEGACY_FREE",
        effectiveEntitlements: before,
        requiresPaymentMethod: false,
        canCreatePaymentObjects: false,
        canRestrictExistingAccessForStripe: false,
      });
    }
    expect(snapshot.entitlements).toEqual(before);
  });

  it("does not reclassify a business when staff, stores, devices or logins change", () => {
    const snapshot = capture();
    for (const eventType of [
      "staff_added",
      "store_added",
      "device_added",
      "owner_login",
      "new_staff_login",
    ]) {
      expect(
        resolvePreparedEntitlements({
          businessId: "existing-a",
          snapshot,
          currentEntitlements: reducedCatalog(),
          stripeObservation: { eventType, createdAt: "2099-01-01T00:00:00Z" },
        }).effectiveEntitlements,
      ).toEqual(original());
    }
  });

  it("preserves current access on missing, mismatched or unknown-version snapshots without borrowing another tenant's grants", () => {
    const own = reducedCatalog();
    for (const snapshot of [
      null,
      capture(),
      {
        ...capture(),
        businessId: "existing-b",
        entitlements: undefined,
      } as unknown as LegacyFreeSnapshot,
      { ...capture(), businessId: "existing-b", schemaVersion: 2 } as unknown as LegacyFreeSnapshot,
    ]) {
      const result = resolvePreparedEntitlements({
        businessId: "existing-b",
        snapshot,
        currentEntitlements: own,
      });
      expect(result).toMatchObject({
        cohort: "UNCLASSIFIED_PROTECTED",
        needsCohortReview: true,
        effectiveEntitlements: own,
        canCreatePaymentObjects: false,
        requiresPaymentMethod: false,
      });
      expect(result.effectiveEntitlements).not.toBe(own);
    }
  });

  it("rejects non-JSON or cyclic snapshots instead of silently dropping entitlement fields", () => {
    const values: unknown[] = [Number.POSITIVE_INFINITY, undefined, new Date()];
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    values.push(cyclic);
    for (const value of values) {
      const entitlements = { ...original(), access: { unsafe: value } } as CapturedEntitlements;
      expect(() =>
        captureLegacyFreeSnapshot({
          businessId: "existing-a",
          capturedAt: "2026-01-02T03:04:05Z",
          entitlements,
        }),
      ).toThrow();
    }
  });
});
