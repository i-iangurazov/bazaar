import type { SellerDetails } from "./types";

// The owner has not supplied the seller's public details yet. Never infer these
// from a customer store, a developer account or FreedomPay's own requisites.
// Filling this record does NOT publish the drafts or enable payment collection.
export const sellerDraft: SellerDetails = {
  legalName: null,
  entrepreneurName: null,
  taxId: null,
  registrationNumber: null,
  registrationDate: null,
  registrationAuthority: null,
  registeredAddress: null,
  correspondenceAddress: null,
  phone: null,
  email: null,
  bankName: "KICB",
  beneficiary: null,
  accountNumber: null,
  bankCode: null,
};
