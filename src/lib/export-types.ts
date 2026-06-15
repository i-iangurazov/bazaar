import type { ExportType } from "@prisma/client";

export type ExportTypeCategory = "inventory" | "sales" | "compliance";

export type ExportTypeMetadata = {
  category: ExportTypeCategory;
  titleKey: string;
  descriptionKey: string;
  recommendedFormat: "csv" | "xlsx";
  periodRequired: boolean;
};

export const EXPORT_TYPE_METADATA = {
  INVENTORY_MOVEMENTS_LEDGER: {
    category: "inventory",
    titleKey: "inventoryMovementsLedger",
    descriptionKey: "inventoryMovementsLedger",
    recommendedFormat: "csv",
    periodRequired: true,
  },
  INVENTORY_BALANCES_AT_DATE: {
    category: "inventory",
    titleKey: "inventoryBalancesAtDate",
    descriptionKey: "inventoryBalancesAtDate",
    recommendedFormat: "xlsx",
    periodRequired: false,
  },
  PURCHASES_RECEIPTS: {
    category: "inventory",
    titleKey: "purchasesReceipts",
    descriptionKey: "purchasesReceipts",
    recommendedFormat: "csv",
    periodRequired: true,
  },
  PRICE_LIST: {
    category: "inventory",
    titleKey: "priceList",
    descriptionKey: "priceList",
    recommendedFormat: "xlsx",
    periodRequired: false,
  },
  SALES_SUMMARY: {
    category: "sales",
    titleKey: "salesSummary",
    descriptionKey: "salesSummary",
    recommendedFormat: "csv",
    periodRequired: true,
  },
  STOCK_MOVEMENTS: {
    category: "inventory",
    titleKey: "stockMovements",
    descriptionKey: "stockMovements",
    recommendedFormat: "csv",
    periodRequired: true,
  },
  PURCHASES: {
    category: "inventory",
    titleKey: "purchases",
    descriptionKey: "purchases",
    recommendedFormat: "xlsx",
    periodRequired: true,
  },
  INVENTORY_ON_HAND: {
    category: "inventory",
    titleKey: "inventoryOnHand",
    descriptionKey: "inventoryOnHand",
    recommendedFormat: "xlsx",
    periodRequired: false,
  },
  PERIOD_CLOSE_REPORT: {
    category: "inventory",
    titleKey: "periodClose",
    descriptionKey: "periodClose",
    recommendedFormat: "xlsx",
    periodRequired: true,
  },
  RECEIPTS_FOR_KKM: {
    category: "sales",
    titleKey: "kkmReceipts",
    descriptionKey: "kkmReceipts",
    recommendedFormat: "csv",
    periodRequired: true,
  },
  RECEIPTS_REGISTRY: {
    category: "sales",
    titleKey: "receiptsRegistry",
    descriptionKey: "receiptsRegistry",
    recommendedFormat: "xlsx",
    periodRequired: true,
  },
  SHIFT_X_REPORT: {
    category: "sales",
    titleKey: "shiftXReport",
    descriptionKey: "shiftXReport",
    recommendedFormat: "xlsx",
    periodRequired: true,
  },
  SHIFT_Z_REPORT: {
    category: "sales",
    titleKey: "shiftZReport",
    descriptionKey: "shiftZReport",
    recommendedFormat: "xlsx",
    periodRequired: true,
  },
  SALES_BY_DAY: {
    category: "sales",
    titleKey: "salesByDay",
    descriptionKey: "salesByDay",
    recommendedFormat: "xlsx",
    periodRequired: true,
  },
  SALES_BY_ITEM: {
    category: "sales",
    titleKey: "salesByItem",
    descriptionKey: "salesByItem",
    recommendedFormat: "xlsx",
    periodRequired: true,
  },
  RETURNS_BY_DAY: {
    category: "sales",
    titleKey: "returnsByDay",
    descriptionKey: "returnsByDay",
    recommendedFormat: "xlsx",
    periodRequired: true,
  },
  RETURNS_BY_ITEM: {
    category: "sales",
    titleKey: "returnsByItem",
    descriptionKey: "returnsByItem",
    recommendedFormat: "xlsx",
    periodRequired: true,
  },
  CASH_DRAWER_MOVEMENTS: {
    category: "sales",
    titleKey: "cashDrawerMovements",
    descriptionKey: "cashDrawerMovements",
    recommendedFormat: "csv",
    periodRequired: true,
  },
  MARKING_SALES_REGISTRY: {
    category: "compliance",
    titleKey: "markingSalesRegistry",
    descriptionKey: "markingSalesRegistry",
    recommendedFormat: "csv",
    periodRequired: true,
  },
  ETTN_REFERENCES: {
    category: "compliance",
    titleKey: "ettnReferences",
    descriptionKey: "ettnReferences",
    recommendedFormat: "xlsx",
    periodRequired: true,
  },
  ESF_REFERENCES: {
    category: "compliance",
    titleKey: "esfReferences",
    descriptionKey: "esfReferences",
    recommendedFormat: "xlsx",
    periodRequired: true,
  },
} as const satisfies Record<ExportType, ExportTypeMetadata>;

export const EXPORT_TYPES = Object.keys(EXPORT_TYPE_METADATA) as ExportType[];

export const EXPORT_TYPE_CATEGORIES: ExportTypeCategory[] = ["inventory", "sales", "compliance"];
