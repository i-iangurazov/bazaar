import type { PriceTagLabel } from "@/server/services/priceTagsPdf";
import type { PriceTagsTemplate } from "@/lib/priceTags";
import type { PosKkmStatus, PosPaymentMethod } from "@prisma/client";

export type ReceiptPrintVariant = "PRECHECK" | "FISCAL";

export type ReceiptTemplateSettings = {
  receiptPaperSize: string;
  receiptCustomWidthMm: number;
  receiptCustomHeightMm: number;
  receiptMarginTopMm: number;
  receiptMarginRightMm: number;
  receiptMarginBottomMm: number;
  receiptMarginLeftMm: number;
  receiptFontSize: number;
  receiptShowStoreName: boolean;
  receiptShowStoreAddress: boolean;
  receiptShowStorePhone: boolean;
  receiptShowLogo: boolean;
  receiptShowCashierName: boolean;
  receiptShowSaleNumber: boolean;
  receiptShowDateTime: boolean;
  receiptShowProductName: boolean;
  receiptShowProductSku: boolean;
  receiptShowProductBarcode: boolean;
  receiptShowProductUnitPrice: boolean;
  receiptShowProductQuantity: boolean;
  receiptShowDiscount: boolean;
  receiptShowSubtotal: boolean;
  receiptShowPaymentMethod: boolean;
  receiptShowTotal: boolean;
  receiptShowChange: boolean;
  receiptFooterText: string;
};

export type BarcodeTemplateSettings = {
  labelLayoutOrder: string;
  labelShowProductName: boolean;
  labelShowPrice: boolean;
  labelShowSku: boolean;
  labelShowBarcodeText: boolean;
  labelShowCurrency: boolean;
  labelShowStoreName: boolean;
  labelBarcodeHeightMm: number;
  labelFontSize: number;
};

export type ReceiptPrintJob = {
  saleId: string;
  storeId: string;
  locale: string;
  variant: ReceiptPrintVariant;
  number: string;
  createdAt: Date;
  storeName: string;
  currencyCode: string | null;
  currencyRateKgsPerUnit: number | string | null;
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
    barcode?: string | null;
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
