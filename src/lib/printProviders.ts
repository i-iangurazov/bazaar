export type PrintProvider =
  | "DISABLED"
  | "QZ_TRAY"
  | "KIOSK_SILENT_PRINT"
  | "NETWORK_ESC_POS"
  | "MANUAL_BROWSER_PRINT";

type StoredPrintProvider =
  | PrintProvider
  | "LOCAL_PRINT_AGENT";

export const normalizePrintProvider = (value: string | null | undefined): PrintProvider => {
  const provider: StoredPrintProvider | null =
    value === "QZ_TRAY" ||
    value === "KIOSK_SILENT_PRINT" ||
    value === "NETWORK_ESC_POS" ||
    value === "MANUAL_BROWSER_PRINT" ||
    value === "LOCAL_PRINT_AGENT"
      ? value
      : value === "DISABLED"
        ? value
        : null;
  return provider === "LOCAL_PRINT_AGENT" || provider === null ? "DISABLED" : provider;
};

export const isProductionAutoPrintProvider = (provider: PrintProvider) =>
  provider === "QZ_TRAY" || provider === "KIOSK_SILENT_PRINT";
