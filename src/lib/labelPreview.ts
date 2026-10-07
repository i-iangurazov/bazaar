import { z } from "zod";
import { labelTextStylesSchema, labelMarginsSchema } from "./labelTextStyles";
import { PRICE_TAG_TEMPLATES } from "./priceTags";

export const labelPreviewSchema = z.object({
  storeId: z.string().min(1),
  template: z.enum(PRICE_TAG_TEMPLATES),
  widthMm: z.number().min(20).max(82),
  heightMm: z.number().min(20).max(100),
  xOffsetMm: z.number().min(-3).max(3),
  yOffsetMm: z.number().min(-3).max(3),
  barcodeHeightMm: z.number().min(6).max(40),
  barcodeType: z.enum(["auto", "ean13", "code128"]),
  labelLayoutOrder: z.enum([
    "PRICE_NAME_BARCODE",
    "NAME_BARCODE_PRICE",
    "BARCODE_ONLY",
    "NAME_BARCODE",
    "PRICE_BARCODE",
  ]),
  labelTextStyles: labelTextStylesSchema,
  labelMargins: labelMarginsSchema,
  showProductName: z.boolean(),
  showPrice: z.boolean(),
  showSku: z.boolean(),
  showBarcodeText: z.boolean(),
  showCurrency: z.boolean(),
  showStoreName: z.boolean(),
  sample: z
    .object({
      name: z.string().max(300),
      price: z.number().nonnegative().max(1e9).nullable(),
      sku: z.string().max(100),
      barcode: z.string().max(100),
    })
    .optional(),
});
export type LabelPreviewInput = z.infer<typeof labelPreviewSchema>;

const labelFitResultSchema = z.object({
  labelTextStyles: labelTextStylesSchema,
  barcodeHeightMm: z.number().min(6).max(40),
});
export type LabelFitResult = z.infer<typeof labelFitResultSchema>;

export async function fetchLabelFit(input: LabelPreviewInput) {
  const response = await fetch("/api/price-tags/fit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message ?? "genericMessage");
  return labelFitResultSchema.parse(result);
}

export async function fetchLabelPreview(input: LabelPreviewInput, signal?: AbortSignal) {
  const response = await fetch("/api/price-tags/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok) throw new Error((await response.json()).message ?? "genericMessage");
  return {
    blob: await response.blob(),
    warnings: (response.headers.get("X-Label-Warnings") ?? "").split(",").filter(Boolean),
  };
}
