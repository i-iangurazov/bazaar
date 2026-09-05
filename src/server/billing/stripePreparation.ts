/**
 * Pure, inactive preparation. This module is not connected to production plan
 * resolution, a database, a provider, a webhook, or any payment UI.
 */
export type EntitlementValue =
  | null
  | boolean
  | number
  | string
  | readonly EntitlementValue[]
  | { readonly [key: string]: EntitlementValue };

export type CapturedEntitlements = {
  readonly plan: string;
  readonly limits: Readonly<Record<string, number | null>>;
  readonly features: Readonly<Record<string, boolean>>;
  readonly access: Readonly<Record<string, EntitlementValue>>;
};

export type LegacyFreeSnapshot = {
  readonly schemaVersion: 1;
  readonly businessId: string;
  readonly cohort: "LEGACY_FREE";
  readonly capturedAt: string;
  readonly entitlements: CapturedEntitlements;
};

// Reject values that a future JSON store would silently discard or change.
// Every nested value is copied and frozen; no caller/catalog references survive.
const copyFrozen = <T>(value: T, ancestors = new Set<object>()): T => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || value === null) throw new Error("invalidEntitlementValue");
  if (ancestors.has(value)) throw new Error("cyclicEntitlementValue");
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  ) {
    throw new Error("invalidEntitlementObject");
  }
  const next = new Set(ancestors).add(value);
  const copy = Array.isArray(value)
    ? Array.from(value, (item) => copyFrozen(item, next))
    : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyFrozen(item, next)]));
  return Object.freeze(copy) as T;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isEntitlementShape = (value: unknown): value is CapturedEntitlements => {
  if (!isRecord(value) || typeof value.plan !== "string" || !value.plan.trim()) return false;
  return (
    isRecord(value.limits) &&
    Object.values(value.limits).every(
      (limit) => limit === null || (typeof limit === "number" && Number.isFinite(limit)),
    ) &&
    isRecord(value.features) &&
    Object.values(value.features).every((feature) => typeof feature === "boolean") &&
    isRecord(value.access)
  );
};

export const captureLegacyFreeSnapshot = (input: {
  businessId: string;
  capturedAt: string;
  entitlements: CapturedEntitlements;
}): LegacyFreeSnapshot => {
  if (
    !input.businessId.trim() ||
    !Number.isFinite(Date.parse(input.capturedAt)) ||
    !isEntitlementShape(input.entitlements)
  ) {
    throw new Error("invalidLegacySnapshotIdentity");
  }
  return copyFrozen({
    schemaVersion: 1,
    businessId: input.businessId,
    cohort: "LEGACY_FREE",
    capturedAt: input.capturedAt,
    entitlements: input.entitlements,
  });
};

export type StripePreparationInput = {
  readonly proposedAccountCountry: string | null;
  readonly legalEntityConfirmed: boolean;
  readonly accountApproved: boolean;
  readonly sandboxAuthorized: boolean;
  readonly approvedPrices:
    | readonly {
        readonly priceId: string;
        readonly currency: string;
        readonly interval: "month" | "year";
      }[]
    | null;
  readonly approvedCohortCutoff: string | null;
  readonly durableCohortStorageReady: boolean;
};

export const prospectiveUkStripePreparation: StripePreparationInput = Object.freeze({
  proposedAccountCountry: "GB",
  legalEntityConfirmed: false,
  accountApproved: false,
  sandboxAuthorized: false,
  approvedPrices: null,
  approvedCohortCutoff: null,
  durableCohortStorageReady: false,
});

export const assessStripePreparation = (input: StripePreparationInput) => {
  const blockers: string[] = [];
  if (!input.proposedAccountCountry) blockers.push("ACCOUNT_COUNTRY_UNCONFIRMED");
  if (!input.legalEntityConfirmed) blockers.push("LEGAL_SELLER_UNCONFIRMED");
  if (!input.accountApproved) blockers.push("ACCOUNT_NOT_APPROVED");
  if (!input.sandboxAuthorized) blockers.push("NO_AUTHORIZED_SANDBOX");
  if (!input.approvedPrices?.length) blockers.push("PRICING_NOT_APPROVED");
  if (!input.approvedCohortCutoff || !Number.isFinite(Date.parse(input.approvedCohortCutoff))) {
    blockers.push("COHORT_CUTOFF_NOT_APPROVED");
  }
  if (!input.durableCohortStorageReady) blockers.push("DURABLE_COHORT_STORAGE_NOT_READY");
  // Even a caller asserting every prerequisite cannot activate nonexistent
  // provider handlers or reinterpret this advisory preflight as authorization.
  blockers.push("INTEGRATION_NOT_IMPLEMENTED_OR_ACTIVATED");
  return Object.freeze({
    mode: "INACTIVE_PREPARATION" as const,
    canCreatePaymentObjects: false as const,
    requiresPaymentMethod: false as const,
    blockers: Object.freeze(blockers),
  });
};

export const resolvePreparedEntitlements = (input: {
  businessId: string;
  snapshot: LegacyFreeSnapshot | null;
  currentEntitlements: CapturedEntitlements;
  /** Observations are deliberately non-authoritative for legacy free access. */
  stripeObservation?: Readonly<{ eventType: string; eventId?: string; createdAt?: string }>;
}) => {
  const snapshot = input.snapshot;
  let validSnapshot =
    snapshot?.schemaVersion === 1 &&
    snapshot.cohort === "LEGACY_FREE" &&
    snapshot.businessId === input.businessId &&
    isEntitlementShape(snapshot.entitlements);
  if (validSnapshot) {
    try {
      copyFrozen(snapshot!.entitlements);
    } catch {
      validSnapshot = false;
    }
  }
  return copyFrozen({
    policyVersion: 1,
    mode: "INACTIVE_PREPARATION" as const,
    businessId: input.businessId,
    cohort: validSnapshot ? ("LEGACY_FREE" as const) : ("UNCLASSIFIED_PROTECTED" as const),
    needsCohortReview: !validSnapshot,
    effectiveEntitlements: validSnapshot ? snapshot!.entitlements : input.currentEntitlements,
    canCreatePaymentObjects: false as const,
    requiresPaymentMethod: false as const,
    canRestrictExistingAccessForStripe: false as const,
  });
};
