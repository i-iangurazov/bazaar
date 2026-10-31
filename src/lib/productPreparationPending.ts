import { productStorePreparationApplySchema } from "./productStorePreparation";
import type { z } from "zod";
export type PendingProductPreparation = z.infer<typeof productStorePreparationApplySchema>;
export const productPreparationPendingKey = (org: string, user: string, product: string) =>
  `bazaar:product-preparation:v1:${org}:${user}:${product}`;
export function readProductPreparationPending(
  storage: Storage,
  key: string,
  productId: string,
): PendingProductPreparation | null {
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    if (raw.length > 20_000) throw new Error("oversized");
    const value = JSON.parse(raw);
    if (
      value.version !== 1 ||
      !Number.isFinite(value.createdAt) ||
      value.createdAt > Date.now() + 60_000 ||
      Date.now() - value.createdAt > 8 * 60 * 60_000
    )
      throw new Error("expired");
    const request = productStorePreparationApplySchema.parse(value.request);
    if (request.change.productId !== productId) throw new Error("scope");
    return request;
  } catch {
    storage.removeItem(key);
    return null;
  }
}
export function saveProductPreparationPending(
  storage: Storage,
  key: string,
  request: PendingProductPreparation,
) {
  const value = JSON.stringify({
    version: 1,
    createdAt: Date.now(),
    request: productStorePreparationApplySchema.parse(request),
  });
  if (value.length > 20_000) throw new Error("productPreparationStorageUnavailable");
  storage.setItem(key, value);
}
