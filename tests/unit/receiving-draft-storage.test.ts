import { describe, expect, it } from "vitest";

import {
  consumeReceivingDraft,
  getReceivingDraftStorageKey,
  RECEIVING_DRAFT_STORAGE_VERSION,
  RECEIVING_DRAFT_TTL_MS,
  removeReceivingDraft,
  writeReceivingDraft,
  type ReceivingDraft,
  type ReceivingDraftIdentity,
} from "@/components/inventory/receiving-draft-storage";

class MemoryStorage {
  private readonly values = new Map<string, string>();

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

const draftKey = "receiving-roundtrip-1";
const namespace: ReceivingDraftIdentity = {
  organizationId: "org-one",
  userId: "user-one",
  storeId: "store-one",
};
const draft: ReceivingDraft = {
  storeId: namespace.storeId,
  dateTime: "2026-08-07T20:00",
  supplierName: "Supplier",
  referenceNumber: "REF-1",
  note: "Keep this receiving state",
  search: "milk",
  lines: [
    {
      key: "product-one:BASE",
      productId: "product-one",
      variantId: null,
      productName: "Milk",
      variantName: null,
      sku: "MILK-1",
      barcode: "12345678",
      imageUrl: null,
      currentStock: 4,
      unitCostInput: "50",
      quantityInput: "3",
    },
  ],
  pageScrollY: 240,
  searchResultsScrollTop: 80,
  focusedElement: { target: "lineInput", key: "product-one:BASE", field: "quantity" },
};

describe("receiving draft storage", () => {
  it("round-trips once for the same authenticated user, organization, and store", () => {
    const storage = new MemoryStorage();
    expect(writeReceivingDraft(draftKey, namespace, draft, { storage, nowMs: 1_000 })).toBe(true);

    expect(consumeReceivingDraft(draftKey, namespace, { storage, nowMs: 2_000 })).toEqual(draft);
    expect(storage.getItem(getReceivingDraftStorageKey(draftKey))).toBeNull();
    expect(consumeReceivingDraft(draftKey, namespace, { storage, nowMs: 2_000 })).toBeNull();
  });

  it("rejects and removes another user draft in the same organization", () => {
    const storage = new MemoryStorage();
    writeReceivingDraft(draftKey, namespace, draft, { storage, nowMs: 1_000 });

    expect(
      consumeReceivingDraft(
        draftKey,
        { ...namespace, userId: "user-two" },
        { storage, nowMs: 2_000 },
      ),
    ).toBeNull();
    expect(storage.getItem(getReceivingDraftStorageKey(draftKey))).toBeNull();
  });

  it("rejects and removes another organization draft", () => {
    const storage = new MemoryStorage();
    writeReceivingDraft(draftKey, namespace, draft, { storage, nowMs: 1_000 });

    expect(
      consumeReceivingDraft(
        draftKey,
        { ...namespace, organizationId: "org-two" },
        { storage, nowMs: 2_000 },
      ),
    ).toBeNull();
    expect(storage.getItem(getReceivingDraftStorageKey(draftKey))).toBeNull();
  });

  it("rejects and removes a draft for another store", () => {
    const storage = new MemoryStorage();
    writeReceivingDraft(draftKey, namespace, draft, { storage, nowMs: 1_000 });

    expect(
      consumeReceivingDraft(
        draftKey,
        { ...namespace, storeId: "store-two" },
        { storage, nowMs: 2_000 },
      ),
    ).toBeNull();
    expect(storage.getItem(getReceivingDraftStorageKey(draftKey))).toBeNull();
  });

  it("rejects and removes an expired draft", () => {
    const storage = new MemoryStorage();
    writeReceivingDraft(draftKey, namespace, draft, { storage, nowMs: 1_000 });

    expect(
      consumeReceivingDraft(draftKey, namespace, {
        storage,
        nowMs: 1_000 + RECEIVING_DRAFT_TTL_MS,
      }),
    ).toBeNull();
    expect(storage.getItem(getReceivingDraftStorageKey(draftKey))).toBeNull();
  });

  it("rejects and removes corrupt JSON and unsupported versions", () => {
    const corruptStorage = new MemoryStorage();
    corruptStorage.setItem(getReceivingDraftStorageKey(draftKey), "{not-json");
    expect(
      consumeReceivingDraft(draftKey, namespace, { storage: corruptStorage, nowMs: 2_000 }),
    ).toBeNull();
    expect(corruptStorage.getItem(getReceivingDraftStorageKey(draftKey))).toBeNull();

    const staleStorage = new MemoryStorage();
    staleStorage.setItem(
      getReceivingDraftStorageKey(draftKey),
      JSON.stringify({
        version: RECEIVING_DRAFT_STORAGE_VERSION - 1,
        namespace,
        createdAtMs: 1_000,
        expiresAtMs: 1_000 + RECEIVING_DRAFT_TTL_MS,
        draft,
      }),
    );
    expect(
      consumeReceivingDraft(draftKey, namespace, { storage: staleStorage, nowMs: 2_000 }),
    ).toBeNull();
    expect(staleStorage.getItem(getReceivingDraftStorageKey(draftKey))).toBeNull();
  });

  it("supports explicit submit/cancel cleanup and refuses a mismatched store at write time", () => {
    const storage = new MemoryStorage();
    expect(writeReceivingDraft(draftKey, namespace, draft, { storage, nowMs: 1_000 })).toBe(true);
    expect(removeReceivingDraft(draftKey, { storage })).toBe(true);
    expect(storage.getItem(getReceivingDraftStorageKey(draftKey))).toBeNull();

    expect(
      writeReceivingDraft(
        draftKey,
        namespace,
        { ...draft, storeId: "store-two" },
        { storage, nowMs: 1_000 },
      ),
    ).toBe(false);
    expect(storage.getItem(getReceivingDraftStorageKey(draftKey))).toBeNull();
  });
});
