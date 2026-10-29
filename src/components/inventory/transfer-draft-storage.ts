import { z } from "zod";

export const TRANSFER_DRAFT_TTL_MS = 8 * 60 * 60 * 1000;
const text = z.string().max(20_000);
const id = z.string().min(1).max(191);
export const transferDraftLineSchema = z.object({
  key: text,
  productId: id,
  variantId: id.nullable(),
  productName: text,
  variantName: text.nullable(),
  sku: text,
  barcode: text.nullable(),
  imageUrl: text.nullable(),
  unitLabel: text,
  sourceStock: z.number().finite(),
  destinationStock: z.number().finite(),
  unitCostKgs: z.number().finite().nullable(),
  quantityInput: text,
  quantityPrecision: z.number().int().min(0).max(3).optional(),
});
export type TransferDraftLine = z.infer<typeof transferDraftLineSchema>;
const draftSchema = z.object({
  fromStoreId: id,
  toStoreId: id,
  note: text,
  search: text,
  lines: z.array(transferDraftLineSchema).max(500),
  operation: z
    .object({ signature: z.string().max(200_000), key: id, pending: z.boolean().optional() })
    .nullable(),
});
export type TransferDraft = z.infer<typeof draftSchema>;
export type TransferDraftIdentity = { organizationId: string; userId: string };
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const identitySchema = z.object({ organizationId: id, userId: id });
const keyFor = (identity: TransferDraftIdentity) =>
  `bazaar:transfer-draft:${encodeURIComponent(identity.organizationId)}:${encodeURIComponent(identity.userId)}`;
const resolveStorage = (storage?: StorageLike) => {
  try {
    return storage ?? (typeof window === "undefined" ? null : window.sessionStorage);
  } catch {
    return null;
  }
};

export function removeTransferDraft(identity: TransferDraftIdentity, storage?: StorageLike) {
  try {
    resolveStorage(storage)?.removeItem(keyFor(identity));
  } catch {
    /* Storage may be disabled. */
  }
}

export function writeTransferDraft(
  identity: TransferDraftIdentity,
  draft: TransferDraft,
  storage?: StorageLike,
  now = Date.now(),
): boolean {
  try {
    if (!identitySchema.safeParse(identity).success || !draftSchema.safeParse(draft).success)
      return false;
    const target = resolveStorage(storage);
    if (!target) return false;
    const serialized = JSON.stringify({ version: 1, identity, savedAt: now, draft });
    if (serialized.length > 1_000_000) return false;
    target.setItem(keyFor(identity), serialized);
    return true;
  } catch {
    return false;
  }
}

export function readTransferDraft(
  identity: TransferDraftIdentity,
  storage?: StorageLike,
  now = Date.now(),
): TransferDraft | null {
  try {
    if (!identitySchema.safeParse(identity).success) return null;
    const raw = resolveStorage(storage)?.getItem(keyFor(identity));
    if (!raw) return null;
    if (raw.length > 1_000_000) throw new Error("oversized draft");
    const record = JSON.parse(raw);
    if (
      record.version !== 1 ||
      record.identity?.organizationId !== identity.organizationId ||
      record.identity?.userId !== identity.userId ||
      !Number.isFinite(record.savedAt) ||
      record.savedAt > now ||
      now - record.savedAt >= TRANSFER_DRAFT_TTL_MS
    )
      throw new Error("expired draft");
    const draft = draftSchema.parse(record.draft);
    const keys = draft.lines.map((line) => `${line.productId}:${line.variantId ?? "BASE"}`);
    if (
      new Set(keys).size !== keys.length ||
      draft.lines.some((line, index) => line.key !== keys[index])
    )
      throw new Error("invalid lines");
    return draft;
  } catch {
    removeTransferDraft(identity, storage);
    return null;
  }
}
