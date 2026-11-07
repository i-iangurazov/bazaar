import { loadSellerDetails } from "@/server/legal/seller";

// Explicit synthetic fixtures only. Never copy owner documents into tests.
export const syntheticSellerEnvironment = {
  BILLING_SELLER_LEGAL_NAME: "ИП Тестовый Поставщик",
  BILLING_SELLER_ENTREPRENEUR_NAME: "Тестовый Поставщик",
  BILLING_SELLER_TAX_ID: "00000000000001",
  BILLING_SELLER_REGISTRATION_NUMBER: "TEST-IP-001",
  BILLING_SELLER_REGISTRATION_DATE: "01.01.2026",
  BILLING_SELLER_REGISTRATION_AUTHORITY: "Synthetic registration authority",
  BILLING_SELLER_PHONE: "+996 555 010 203",
  BILLING_SELLER_EMAIL: "seller@example.invalid",
  BILLING_SELLER_BANK_NAME: "Synthetic bank",
  BILLING_SELLER_BENEFICIARY: "Synthetic beneficiary",
  BILLING_SELLER_ACCOUNT_NUMBER: "0000000000000011",
  BILLING_SELLER_ACCOUNT_CURRENCY: "KGS",
  BILLING_SELLER_BANK_CODE: "000001",
};
export const syntheticSeller = loadSellerDetails(syntheticSellerEnvironment);
