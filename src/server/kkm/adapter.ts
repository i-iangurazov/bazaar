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
  kkmFactoryNumber?: string | null;
  kkmRegistrationNumber?: string | null;
  fiscalModeStatus?: "NOT_SENT" | "SENT" | "FAILED" | null;
  upfdOrFiscalMemory?: string | null;
  qrPayload?: string | null;
  fiscalizedAt?: Date | null;
  printedAt: Date;
  rawJson?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | null;
};

export type KkmHealth = {
  ok: boolean;
  message?: string;
};

export type FiscalReceiptCommandContext = {
  /** Durable identity that the provider must deduplicate across every retry. */
  providerCommandId: string;
};

export interface KkmAdapter {
  /**
   * True only when repeated providerCommandId values are guaranteed to return
   * the original fiscal result without producing another fiscal effect.
   */
  supportsIdempotentFiscalization: boolean;
  health(): Promise<KkmHealth>;
  fiscalizeReceipt(
    draft: FiscalReceiptDraft,
    context: FiscalReceiptCommandContext,
  ): Promise<FiscalReceiptResult>;
}
