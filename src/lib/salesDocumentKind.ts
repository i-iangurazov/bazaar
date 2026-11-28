const salesDocumentKinds = ["invoice", "invoice_without_prices", "goods_receipt", "estimate"] as const;

export type SalesDocumentKind = (typeof salesDocumentKinds)[number];

export const isSalesDocumentKind = (value: string): value is SalesDocumentKind =>
  salesDocumentKinds.some((kind) => kind === value);
