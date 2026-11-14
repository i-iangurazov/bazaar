export const productPhotoSearchModel = "ppshitu-v2-pplcnetv2-v1-fp32-224";
export const productPhotoSearchDimension = 512;
export const productPhotoSearchMaxBytes = 3 * 1024 * 1024;
// Technical prototype bounds, identical on every plan.
export const productPhotoSearchMaxImages = 10_000;

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
};
export type ProductPhotoSearchResult = {
  storeId: string;
  currencyCode: string;
  currencyRateKgsPerUnit: number;
  items: ProductPhotoMatch[];
  progress: ProductPhotoProgress;
  partial: boolean;
};
