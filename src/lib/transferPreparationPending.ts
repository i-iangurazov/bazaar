import { transferAssortmentPreparationApplySchema } from "./transferAssortmentPreparation";
import type { z } from "zod";
export type PendingTransferPreparation = z.infer<typeof transferAssortmentPreparationApplySchema>;
export const transferPreparationPendingKey = (
  org: string,
  user: string,
  from: string,
  to: string,
) => `bazaar:transfer-preparation:v1:${org}:${user}:${from}:${to}`;
export function readTransferPreparationPending(
  storage: Storage,
  key: string,
  from: string,
  to: string,
): PendingTransferPreparation | null {
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    if (raw.length > 250_000) throw new Error("oversized");
    const value = JSON.parse(raw);
    if (
      value.version !== 1 ||
      !Number.isFinite(value.createdAt) ||
      value.createdAt > Date.now() + 60_000 ||
      Date.now() - value.createdAt > 8 * 60 * 60_000
    )
      throw new Error("expired");
    const request = transferAssortmentPreparationApplySchema.parse(value.request);
    if (request.change.fromStoreId !== from || request.change.toStoreId !== to)
      throw new Error("scope");
    return request;
  } catch {
    storage.removeItem(key);
    return null;
  }
}
export function saveTransferPreparationPending(
  storage: Storage,
  key: string,
  request: PendingTransferPreparation,
) {
  const value = JSON.stringify({
    version: 1,
    createdAt: Date.now(),
    request: transferAssortmentPreparationApplySchema.parse(request),
  });
  if (value.length > 250_000) throw new Error("productPreparationStorageUnavailable");
  storage.setItem(key, value);
}
