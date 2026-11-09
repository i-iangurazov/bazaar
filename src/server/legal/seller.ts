import { sellerDraft } from "@/content/legal/seller";
import type { SellerDetails } from "@/content/legal/types";

// A separate explicit public value permits publishing the platform owner's name
// without releasing the private seller record or enabling the legal documents.
export function loadPublicSellerLegalName(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const name = env.BAZAAR_PUBLIC_LEGAL_NAME?.trim() ?? "";
  return name.length >= 2 && name.length <= 240 && !/[<>\r\n]/.test(name) ? name : null;
}

// Server/Edge environment allowlist. These names must never have NEXT_PUBLIC_
// equivalents or be passed to a client component before deliberate publication.
export const SELLER_ENV_FIELDS = {
  legalName: "BILLING_SELLER_LEGAL_NAME",
  entrepreneurName: "BILLING_SELLER_ENTREPRENEUR_NAME",
  taxId: "BILLING_SELLER_TAX_ID",
  registrationNumber: "BILLING_SELLER_REGISTRATION_NUMBER",
  registrationDate: "BILLING_SELLER_REGISTRATION_DATE",
  registrationAuthority: "BILLING_SELLER_REGISTRATION_AUTHORITY",
  phone: "BILLING_SELLER_PHONE",
  email: "BILLING_SELLER_EMAIL",
  bankName: "BILLING_SELLER_BANK_NAME",
  beneficiary: "BILLING_SELLER_BENEFICIARY",
  accountNumber: "BILLING_SELLER_ACCOUNT_NUMBER",
  accountCurrency: "BILLING_SELLER_ACCOUNT_CURRENCY",
  bankCode: "BILLING_SELLER_BANK_CODE",
} as const;

export function loadSellerDetails(
  env: Record<string, string | undefined> = process.env,
): SellerDetails {
  const seller = { ...sellerDraft };
  for (const [field, key] of Object.entries(SELLER_ENV_FIELDS)) {
    const value = env[key]?.trim();
    if (value) seller[field as keyof typeof SELLER_ENV_FIELDS] = value;
  }
  // No private residential-address loader exists. Public correspondence has a
  // separate approval gate and is never inferred from registration documents.
  return seller;
}
