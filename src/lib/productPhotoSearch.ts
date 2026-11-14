export const productPhotoSearchModel = "ppshitu-v2-pplcnetv2-v1-fp32-224";
export const productPhotoSearchDimension = 512;
export const productPhotoSearchMaxBytes = 3 * 1024 * 1024;
// Technical prototype bounds, identical on every plan.
export const productPhotoSearchMaxImages = 10_000;

export type ProductPhotoRegion = { x: number; y: number; width: number; height: number };
export function validProductPhotoRegion(value: unknown): value is ProductPhotoRegion {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const region = value as ProductPhotoRegion;
  return Object.keys(region).length === 4 && [region.x, region.y, region.width, region.height].every((part) => typeof part === "number" && Number.isFinite(part)) &&
    region.x >= 0 && region.x < 1 && region.y >= 0 && region.y < 1 && region.width > 0 && region.width <= 1 && region.height > 0 && region.height <= 1 && region.x + region.width <= 1.000001 && region.y + region.height <= 1.000001;
}
export type ProductPhotoTextLine = { text: string; confidence: number; box: ProductPhotoRegion };
export type ProductPhotoAnalysis = {
  regionSource: "auto" | "manual" | "full";
  region: ProductPhotoRegion | null;
  ocrStatus: "ready" | "unavailable";
  lines: ProductPhotoTextLine[];
};
export type ProductPhotoLabelStatus = "matched" | "ambiguous" | "unmatched" | "unreadable" | "unavailable";

export type ProductPhotoProgress = {
  total: number;
  ready: number;
  pending: number;
  failed: number;
  withoutPhoto: number;
};
export type ProductPhotoMatch = {
  id: string;
  name: string;
  sku: string | null;
  imageUrl: string | null;
  priceKgs: number | null;
  onHand: number;
  labelMatched?: boolean;
  matchSource?: "photo" | "text" | "photo-text";
};
export type ProductPhotoSearchResult = {
  storeId: string;
  currencyCode: string;
  currencyRateKgsPerUnit: number;
  items: ProductPhotoMatch[];
  progress: ProductPhotoProgress;
  partial: boolean;
  recognition?: {
    regionSource: ProductPhotoAnalysis["regionSource"];
    region: ProductPhotoRegion | null;
    labelStatus: ProductPhotoLabelStatus;
    text: string;
  };
};
