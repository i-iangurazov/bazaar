import { loadSellerDetails } from "@/server/legal/seller";
import { sellerFields, type SellerDetails } from "@/content/legal/types";

export const LEGAL_TERMS_VERSION = "2026-11-10-v1";
type Environment = Record<string, string | undefined>;

// A real correspondence address may replace the private residential address
// only after review of the applicable requirements and provider acceptance.
// No address is invented, inferred from a certificate or silently published.
export function legalPublicationState(env: Environment = process.env) {
  const address = env.BILLING_PUBLIC_CONTACT_ADDRESS?.trim() ?? "";
  const seller: SellerDetails = {
    ...loadSellerDetails(env),
    registeredAddress: null,
    correspondenceAddress: address || null,
  };
  const missing: string[] = [];
  if (env.BILLING_LEGAL_RELEASE_APPROVED !== LEGAL_TERMS_VERSION) missing.push("legalApproval");
  if (env.BILLING_SUPPORT_EMAIL_VERIFIED !== "1") missing.push("supportMailbox");
  if (
    address.length < 12 ||
    address.length > 500 ||
    /[<>\r\n]|placeholder|example|заглуш|будет заполн|уточняется/i.test(address)
  )
    missing.push("publicCorrespondenceAddress");
  for (const field of sellerFields) {
    if (field !== "registeredAddress" && !seller[field]?.trim()) missing.push(field);
  }
  if (seller.accountCurrency !== "KGS") missing.push("kgsAccount");
  return { published: missing.length === 0, seller, missing, version: LEGAL_TERMS_VERSION };
}
