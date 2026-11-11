// Produces a review artifact only. It cannot enable sales or provision products.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createContractTerms } from "../../src/server/billing/contractTerms";
import {
  listAppleSubscriptionOffers,
  listAppleWhatsAppOffers,
} from "../../src/server/billing/appleOfferCatalog";
import { APPLE_WHATSAPP_OFFER_VERSION } from "../../src/server/billing/appleConfig";

const subscriptions = (["2026-10", "2026-11"] as const).flatMap((version) =>
  listAppleSubscriptionOffers(createContractTerms(version)),
);
const products = [...subscriptions, ...listAppleWhatsAppOffers()].map((offer) => {
  const productId =
    offer.kind === "SUBSCRIPTION"
      ? `kg.bazaar.ios.${offer.selection.plan.toLowerCase()}.m${offer.selection.months}.s${offer.selection.extras.stores}.r${offer.selection.extras.productPacks}.c${offer.contractDigest.slice(0, 24)}`
      : `kg.bazaar.ios.whatsapp.202611.q${offer.quantity}`;
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(productId)) throw new Error("Invalid draft Apple product ID");
  return {
    ...offer,
    productId,
    proposedProductType: offer.kind === "SUBSCRIPTION" ? "NON_RENEWING" : "CONSUMABLE",
    ...(offer.kind === "WHATSAPP_PACK" ? { appleOfferVersion: APPLE_WHATSAPP_OFFER_VERSION } : {}),
    approved: false,
    applePricePoint: null,
    verifiedStorefronts: [],
  };
});
if (new Set(products.map((product) => product.productId)).size !== products.length)
  throw new Error("Duplicate draft SKU");
const target = resolve("docs/mobile/apple-catalog.draft.json");
await mkdir(resolve("docs/mobile"), { recursive: true });
await writeFile(
  target,
  JSON.stringify(
    {
      status: "DRAFT_NOT_FOR_ENVIRONMENT",
      bundleId: "kg.bazaar.app",
      purpose:
        "Owner review; Apple prices, availability and product registration remain unverified.",
      productCount: products.length,
      products,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Prepared ${products.length} unapproved product proposals at docs/mobile/apple-catalog.draft.json`,
);
