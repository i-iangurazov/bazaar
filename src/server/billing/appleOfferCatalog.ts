import { createHash } from "node:crypto";

import { PLAN_CODES } from "@/lib/billing/plans";
import {
  ADDITIONAL_STORE_CAPS,
  LEGACY_CATALOG_VERSION,
  SUBSCRIPTION_MONTHS,
  subscriptionPrice,
  subscriptionSelectionSchema,
  type SubscriptionSelection,
} from "@/lib/billing/subscriptionPricing";
import {
  WHATSAPP_OFFER_VERSION,
  whatsappOffer,
  whatsappPackSelectionSchema,
} from "@/lib/whatsapp-ai";
import { AppError } from "@/server/services/errors";

import { contractPlan, contractTermsSchema, type ContractTerms } from "./contractTerms";
import { kgsToMinor } from "./paymentMath";
import type { PlanDefinition } from "./planCatalog";

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => [key, canonicalValue(entry)]),
  );
}

function parseTerms(value: unknown): ContractTerms {
  const parsed = contractTermsSchema.safeParse(value);
  if (!parsed.success) throw new AppError("billingContractNeedsReview", "CONFLICT", 409);
  return parsed.data;
}

export function appleContractDigest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalValue(parseTerms(value))))
    .digest("hex");
}

export type AppleSubscriptionOffer = {
  kind: "SUBSCRIPTION";
  offerKey: string;
  contractDigest: string;
  catalogVersion: ContractTerms["catalogVersion"];
  selection: SubscriptionSelection;
  entitlements: PlanDefinition;
  serviceValue: {
    currency: "KGS";
    amountMinor: number;
    monthlyMinor: number;
    fullAmountMinor: number;
    discountBps: number;
  };
};

/**
 * A versioned business offer, not an App Store product or storefront price.
 * Apple bindings must be reviewed separately; never convert this service value
 * into an amount that the client claims Apple charged.
 */
export function appleSubscriptionOffer(
  contract: unknown,
  rawSelection: unknown,
): AppleSubscriptionOffer {
  const terms = parseTerms(contract);
  const selection = subscriptionSelectionSchema.parse(rawSelection);
  // This also rejects additions to immutable legacy contracts. Do not infer
  // that every combination permitted by the new public catalog existed before.
  const entitlements = contractPlan(terms, selection.plan, selection.extras);
  const price = subscriptionPrice(
    kgsToMinor(entitlements.monthlyPriceKgs),
    selection.months,
    selection.extras,
  );
  const contractDigest = appleContractDigest(terms);
  return {
    kind: "SUBSCRIPTION",
    offerKey: [
      "subscription",
      terms.catalogVersion,
      contractDigest,
      selection.plan.toLowerCase(),
      `m${selection.months}`,
      `s${selection.extras.stores}`,
      `r${selection.extras.productPacks}`,
    ].join("."),
    contractDigest,
    catalogVersion: terms.catalogVersion,
    selection,
    entitlements,
    serviceValue: {
      currency: "KGS",
      amountMinor: price.amountMinor,
      monthlyMinor: price.monthlyMinor,
      fullAmountMinor: price.fullAmountMinor,
      discountBps: price.discountBps,
    },
  };
}

/** Enumerate every permitted base/term/addition combination of this contract. */
export function listAppleSubscriptionOffers(contract: unknown): AppleSubscriptionOffer[] {
  const terms = parseTerms(contract);
  const legacy = terms.catalogVersion === LEGACY_CATALOG_VERSION;
  return PLAN_CODES.flatMap((plan) =>
    SUBSCRIPTION_MONTHS.flatMap((months) =>
      Array.from({ length: legacy ? 1 : ADDITIONAL_STORE_CAPS[plan] + 1 }, (_, stores) =>
        Array.from({ length: legacy ? 1 : 2 }, (_, productPacks) =>
          appleSubscriptionOffer(terms, {
            plan,
            months,
            extras: { stores, productPacks, userPacks: 0 },
          }),
        ),
      ).flat(),
    ),
  );
}

export type AppleWhatsAppOffer = {
  kind: "WHATSAPP_PACK";
  offerKey: string;
  offerVersion: string;
  quantity: number;
  messages: number;
  serviceValue: { currency: "KGS"; amountMinor: number };
};

/** Availability still requires the existing verified connection/worker gates. */
export function appleWhatsAppOffer(
  quantity: number,
  offerVersion = WHATSAPP_OFFER_VERSION,
): AppleWhatsAppOffer {
  const count = whatsappPackSelectionSchema.shape.quantity.parse(quantity);
  const offer = whatsappOffer(offerVersion);
  if (!offer) throw new AppError("billingQuoteChanged", "CONFLICT", 409);
  return {
    kind: "WHATSAPP_PACK",
    offerKey: `whatsapp.${offerVersion}.q${count}`,
    offerVersion,
    quantity: count,
    messages: count * offer.messages,
    serviceValue: { currency: "KGS", amountMinor: count * offer.priceMinor },
  };
}

export function listAppleWhatsAppOffers(): AppleWhatsAppOffer[] {
  return Array.from({ length: 10 }, (_, index) => appleWhatsAppOffer(index + 1));
}
