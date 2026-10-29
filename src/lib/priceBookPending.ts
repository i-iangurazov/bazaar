import { z } from "zod";
import { priceBookApplySchema } from "./priceBookContract";
const MAX_BYTES = 3_000_000;
const MAX_AGE_MS = 8 * 60 * 60_000;
const count = z.number().int().min(0).max(200_000);
const amount = z
  .string()
  .regex(/^\d{1,10}(?:\.\d{1,2})?$/)
  .nullable();
const sample = z.object({
  productId: z.string(),
  variantKey: z.string(),
  name: z.string().max(1000),
  beforeRetail: amount,
  beforeWholesale: amount,
  retail: amount,
  wholesale: amount,
});
const previewSchema = z.object({
  kind: z.enum(["PRICES", "CONNECT", "DISCONNECT", "SOURCE", "REMOVE", "ROLLBACK"]),
  token: z.string().max(2048),
  changedPositions: count,
  preservedKinds: count,
  listChangedPositions: count,
  listPositions: count,
  connectedStores: count,
  version: z.number().int().min(0),
  currencyCode: z.literal("KGS"),
  openDocumentsPreserved: z.literal(true),
  sample: z.array(sample.extend({ storeId: z.string() })).max(30),
  listSample: z.array(sample).max(30),
  stores: z
    .array(z.object({ id: z.string(), name: z.string().max(1000), changedPositions: count }))
    .max(100),
});

export function priceBookPendingKey(org: string, user: string) {
  return `bazaar:price-book-pending:v1:${org}:${user}`;
}
export function readPriceBookPending<
  T extends { bookId: string; change: unknown; preview: { token: string }; idempotencyKey: string },
>(storage: Storage, key: string): T | null {
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    if (raw.length > MAX_BYTES) throw new Error("oversized");
    const d = JSON.parse(raw);
    if (
      d.version !== 1 ||
      !Number.isFinite(d.createdAt) ||
      Date.now() - d.createdAt > MAX_AGE_MS ||
      d.createdAt > Date.now() + 60_000
    )
      throw new Error("expired");
    const a = d.approval;
    priceBookApplySchema.parse({
      bookId: a.bookId,
      change: a.change,
      token: a.preview.token,
      idempotencyKey: a.idempotencyKey,
    });
    previewSchema.parse(a.preview);
    return a as T;
  } catch {
    storage.removeItem(key);
    return null;
  }
}
export function savePriceBookPending(storage: Storage, key: string, approval: unknown) {
  const value = JSON.stringify({ version: 1, createdAt: Date.now(), approval });
  if (value.length > MAX_BYTES) throw new Error("priceBookStorageUnavailable");
  storage.setItem(key, value);
}
