export type InventoryProductPresentation = {
  productId: string;
  imageUrl: string | null;
  sku: string;
  barcode: string | null;
};

/** Document thumbnails use the same gallery-first order as inventory search.
 * Never send embedded images in a 500-line metadata response. */
export const inventoryProductImageUrl = (product: {
  images?: ReadonlyArray<{ url: string | null }>;
  photoUrl?: string | null;
}) => {
  for (const value of [...(product.images ?? []).map((image) => image.url), product.photoUrl]) {
    const url = value?.trim();
    if (url && (/^https?:\/\//i.test(url) || (url.startsWith("/") && !url.startsWith("//")))) {
      return url;
    }
  }
  return null;
};
