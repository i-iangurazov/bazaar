import type { Prisma } from "@prisma/client";

export type FiscalReceiptLine = {
  sku: string;
  name: string;
  qty: number;
  priceKgs?: number | null;
};

export type FiscalReceiptPayment = {
  type: string;
  amountKgs: number;
};

export type FiscalReceiptDraft = {
  storeId: string;
  receiptId?: string;
  lines: FiscalReceiptLine[];
  payments?: FiscalReceiptPayment[];
  cashierName?: string;
  customerName?: string;
  metadata?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | null;
};

export type FiscalReceiptResult = {
  providerReceiptId: string;
  fiscalNumber?: string | null;
  printedAt: Date;
  rawJson?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | null;
};

export type KkmHealth = {
  ok: boolean;
  message?: string;
};

export interface KkmAdapter {
  health(): Promise<KkmHealth>;
  fiscalizeReceipt(draft: FiscalReceiptDraft): Promise<FiscalReceiptResult>;
}
