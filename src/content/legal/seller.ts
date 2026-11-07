import type { SellerDetails } from "./types";

// Safe public defaults only. Verified registration and banking details are loaded
// on the server; committing a draft must never publish the owner's documents.
export const sellerDraft: SellerDetails = {
  legalName: null,
  entrepreneurName: null,
  taxId: null,
  registrationNumber: null,
  registrationDate: null,
  registrationAuthority: null,
  registeredAddress: null,
  correspondenceAddress: null,
  phone: "+996 709 911 300",
  email: "support@bazaar.kg",
  bankName: null,
  beneficiary: null,
  accountNumber: null,
  accountCurrency: "KGS",
  bankCode: null,
};
