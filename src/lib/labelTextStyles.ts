import { z } from "zod";

export const LABEL_TEXT_FIELDS = ["name", "price", "currency", "sku", "barcodeText", "storeName"] as const;
export type LabelTextField = typeof LABEL_TEXT_FIELDS[number];
export const LABEL_SPACING_FIELDS = ["name", "barcode", "barcodeText", "price", "sku", "storeName"] as const;
export const DEFAULT_LABEL_SPACING = { name: 0.2, barcode: 0.35, barcodeText: 0.2, price: 0.2, sku: 0.2, storeName: 0.2 };
const labelSpacingSchema = z.object({
  name: z.number().min(0).max(20), barcode: z.number().min(0).max(20),
  barcodeText: z.number().min(0).max(20), price: z.number().min(0).max(20),
  sku: z.number().min(0).max(20), storeName: z.number().min(0).max(20),
});
export const labelTextStyleSchema = z.object({
  fontSize: z.number().min(4).max(72),
  weight: z.enum(["normal", "bold"]),
  align: z.enum(["left", "center", "right"]),
  maxLines: z.number().int().min(1).max(8),
  overflow: z.enum(["wrap", "truncate", "shrink"]),
  minFontSize: z.number().min(4).max(72),
  paddingMm: z.number().min(0).max(10),
  widthPercent: z.number().min(10).max(100),
}).refine((v) => v.minFontSize <= v.fontSize, { message: "invalidInput", path: ["minFontSize"] });
export const labelTextStylesSchema = z.object({
  name: labelTextStyleSchema, price: labelTextStyleSchema, currency: labelTextStyleSchema,
  sku: labelTextStyleSchema, barcodeText: labelTextStyleSchema, storeName: labelTextStyleSchema,
  spacing: labelSpacingSchema.default(DEFAULT_LABEL_SPACING),
});
export type LabelTextStyle = z.infer<typeof labelTextStyleSchema>;
export type LabelTextStyles = z.infer<typeof labelTextStylesSchema>;

/** Legacy profiles inherit their original text size; new fields are opt-in per store. */
export function resolveLabelTextStyles(input: unknown, fontSize = 8): LabelTextStyles {
  const parsed = labelTextStylesSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  const style = (size: number): LabelTextStyle => ({ fontSize: size, weight: "normal", align: "center", maxLines: 1, overflow: "truncate", minFontSize: Math.min(6, size), paddingMm: 0, widthPercent: 100 });
  return {
    name: { ...style(fontSize), maxLines: 2 },
    price: { ...style(fontSize + 5), weight: "bold", overflow: "wrap" },
    currency: style(Math.max(6, fontSize - 2)),
    sku: style(Math.max(6, fontSize - 2)),
    barcodeText: { ...style(Math.max(6, fontSize - 2)), overflow: "wrap" },
    storeName: style(Math.max(6, fontSize - 2)),
    spacing: { ...DEFAULT_LABEL_SPACING },
  };
}

export const labelMarginsSchema = z.object({ top: z.number().min(0).max(10), right: z.number().min(0).max(10), bottom: z.number().min(0).max(10), left: z.number().min(0).max(10) });
export type LabelMargins = z.infer<typeof labelMarginsSchema>;
