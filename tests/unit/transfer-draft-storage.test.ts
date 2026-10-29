import { describe, expect, it } from "vitest";
import {
  readTransferDraft,
  writeTransferDraft,
  removeTransferDraft,
  TRANSFER_DRAFT_TTL_MS,
  type TransferDraft,
} from "@/components/inventory/transfer-draft-storage";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}
const identity = { organizationId: "org-1", userId: "user-1" };
const draft: TransferDraft = {
  fromStoreId: "warehouse",
  toStoreId: "store",
  note: "Keep note",
  search: "glove",
  operation: { signature: "lost-response-signature", key: "persisted-idempotency" },
  lines: [
    {
      key: "glove:BASE",
      productId: "glove",
      variantId: null,
      productName: "Glove",
      variantName: null,
      sku: "G-1",
      barcode: "12345",
      imageUrl: null,
      unitLabel: "each",
      sourceStock: 100,
      destinationStock: 0,
      unitCostKgs: 12,
      quantityInput: "7",
      quantityPrecision: 0,
    },
  ],
};

describe("transfer drafts", () => {
  it("restores repeated reloads, exact inputs and the same lost-response operation", () => {
    const storage = new MemoryStorage();
    expect(writeTransferDraft(identity, draft, storage, 1000)).toBe(true);
    expect(readTransferDraft(identity, storage, 2000)).toEqual(draft);
    expect(readTransferDraft(identity, storage, 3000)).toEqual(draft);
    removeTransferDraft(identity, storage);
    expect(readTransferDraft(identity, storage, 4000)).toBeNull();
  });
  it("isolates users and organizations without destroying someone else's work", () => {
    const storage = new MemoryStorage();
    writeTransferDraft(identity, draft, storage, 1000);
    expect(readTransferDraft({ ...identity, userId: "user-2" }, storage, 2000)).toBeNull();
    expect(readTransferDraft({ ...identity, organizationId: "org-2" }, storage, 2000)).toBeNull();
    expect(readTransferDraft(identity, storage, 2000)).toEqual(draft);
  });
  it("expires drafts and discards malformed, duplicate or incompatible records", () => {
    const storage = new MemoryStorage();
    writeTransferDraft(identity, draft, storage, 1000);
    expect(readTransferDraft(identity, storage, 1000 + TRANSFER_DRAFT_TTL_MS)).toBeNull();
    for (const corrupt of [
      "{",
      JSON.stringify({ version: 5 }),
      JSON.stringify({
        version: 1,
        identity,
        savedAt: 1000,
        draft: { ...draft, lines: [draft.lines[0], draft.lines[0]] },
      }),
    ]) {
      storage.setItem("bazaar:transfer-draft:org-1:user-1", corrupt);
      expect(readTransferDraft(identity, storage, 2000)).toBeNull();
      expect(storage.values.size).toBe(0);
    }
  });
  it("reports storage failure and retains incomplete user input for editing", () => {
    const storage = new MemoryStorage();
    const incomplete = { ...draft, lines: [{ ...draft.lines[0], quantityInput: "1," }] };
    expect(writeTransferDraft(identity, incomplete, storage, 1000)).toBe(true);
    expect(readTransferDraft(identity, storage, 2000)?.lines[0].quantityInput).toBe("1,");
    expect(
      writeTransferDraft(identity, draft, {
        ...storage,
        getItem: () => null,
        removeItem: () => {},
        setItem: () => {
          throw new Error("quota");
        },
      }),
    ).toBe(false);
  });
});
