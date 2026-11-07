export const legalDocumentIds = ["offer", "refunds", "requisites", "payment"] as const;
export type LegalDocumentId = (typeof legalDocumentIds)[number];

export const sellerFields = [
  "legalName",
  "entrepreneurName",
  "taxId",
  "registrationNumber",
  "registrationDate",
  "registrationAuthority",
  "registeredAddress",
  "correspondenceAddress",
  "phone",
  "email",
  "bankName",
  "beneficiary",
  "accountNumber",
  "accountCurrency",
  "bankCode",
] as const;
export type SellerField = (typeof sellerFields)[number];
export type SellerDetails = Record<SellerField, string | null>;

export type LegalCopy = {
  back: string;
  navigation: string;
  contents: string;
  draft: string;
  published: string;
  paymentSystemsTitle: string;
  paymentSystemsNotice: string;
  draftNotice: string;
  missing: string;
  sellerTitle: string;
  sellerIntro: string;
  sellerLabels: Record<SellerField, string>;
  pricing: string;
  privacy: string;
  documents: Record<
    LegalDocumentId,
    {
      title: string;
      description: string;
      sections: { id: string; title: string; paragraphs: string[] }[];
    }
  >;
};
