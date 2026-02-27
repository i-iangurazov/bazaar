import type { PriceTagLabel } from "@/server/services/priceTagsPdf";
import type { PriceTagsTemplate } from "@/lib/priceTags";
import type { PosKkmStatus, PosPaymentMethod } from "@prisma/client";

export type ReceiptPrintVariant = "PRECHECK" | "FISCAL";

export type ReceiptPrintJob = {
  saleId: string;
  storeId: string;
  locale: string;
  variant: ReceiptPrintVariant;
  number: string;
  createdAt: Date;
  storeName: string;
  legalName: string | null;
  inn: string | null;
  address: string | null;
  phone: string | null;
  registerName?: string | null;
  cashierName?: string | null;
  shiftLabel?: string | null;
  items: Array<{
    productId: string;
    name: string;
    sku: string;
    qty: number;
    unitPriceKgs: number;
    lineTotalKgs: number;
  }>;
  totals: {
    subtotalKgs: number;
    totalKgs: number;
    payments: Array<{
      method: PosPaymentMethod;
      methodLabel: string;
      amountKgs: number;
    }>;
  };
  fiscal: {
    modeStatus: PosKkmStatus;
    providerReceiptId: string | null;
    fiscalNumber: string | null;
    kkmFactoryNumber: string | null;
    kkmRegistrationNumber: string | null;
    upfdOrFiscalMemory: string | null;
    qrPayload: string | null;
    fiscalizedAt: Date | null;
    lastError: string | null;
  };
};

export type LabelPrintJob = {
  storeId: string;
  productIds: string[];
  template: PriceTagsTemplate;
  quantities: Record<string, number>;
  locale: string;
  labels: PriceTagLabel[];
  storeName: string | null;
  noPriceLabel: string;
  noBarcodeLabel: string;
  skuLabel: string;
};
