import type { ProductMovementDocumentType } from "@/server/services/productMovements";

// The journal, detail page and print endpoint must agree on print availability.
export const printableMovementTypes = [
  "STOCK_RECEIVING",
  "RECEIVE",
  "TRANSFER",
  "WRITE_OFF",
  "ADJUSTMENT",
] as const satisfies readonly ProductMovementDocumentType[];

export const canPrintMovementDocument = (type: ProductMovementDocumentType) =>
  printableMovementTypes.some((supported) => supported === type);
