import type { ProductMovementDocumentDetail } from "@/server/services/productMovements";

type MovementValueLine = Pick<
  ProductMovementDocumentDetail["lines"][number],
  "qtyDelta" | "unitCostKgs" | "lineTotalKgs"
>;

type MovementValueDocument = Pick<ProductMovementDocumentDetail, "documentType" | "totalAmount"> & {
  lines: MovementValueLine[];
};

const roundMoney = (value: number) => Math.round(value * 100) / 100;

export const hasMovementDocumentLineValues = (lines: MovementValueLine[]) =>
  lines.some((line) => line.unitCostKgs !== null || line.lineTotalKgs !== null);

export const getMovementDocumentLineValueKgs = (
  documentType: ProductMovementDocumentDetail["documentType"],
  line: MovementValueLine,
) => {
  if (line.lineTotalKgs === null) {
    return null;
  }
  if (documentType !== "TRANSFER") {
    return line.lineTotalKgs;
  }
  return Math.sign(line.qtyDelta) * Math.abs(line.lineTotalKgs);
};

export const getMovementDocumentAmountKgs = (document: MovementValueDocument) => {
  if (document.totalAmount !== null) {
    return document.totalAmount;
  }
  const values = document.lines
    .map((line) => getMovementDocumentLineValueKgs(document.documentType, line))
    .filter((value): value is number => value !== null);
  return values.length ? roundMoney(values.reduce((sum, value) => sum + value, 0)) : null;
};
