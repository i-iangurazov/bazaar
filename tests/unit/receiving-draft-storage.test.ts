import { describe, expect, it } from "vitest";

import {
  consumeReceivingDraft,
  getReceivingDraftStorageKey,
  RECEIVING_DRAFT_STORAGE_VERSION,
  RECEIVING_DRAFT_TTL_MS,
  removeReceivingDraft,
  writeReceivingDraft,
  hasReceivingPending,
  readReceivingPending,
  readReceivingPendingState,
  writeReceivingPending,
  removeReceivingPending,
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

describe("receiving pending operation storage", () => {
  const pending = {
    request: { receiving: { storeId: namespace.storeId, supplierName: draft.supplierName, referenceNumber: draft.referenceNumber, note: draft.note, lines: [{ productId: "product-one", variantId: null,
      quantity: 3, unitCost: 50, salePriceKgs: 0 }] }, token: "expired-but-signed-review-token", idempotencyKey: "receiving-operation-one" },
    draft: { ...draft, currencyCode: "KGS", currencyRateKgsPerUnit: 1, lines: draft.lines.map(line => ({ ...line, salePriceInput: "0" })) },
  };
  it("preserves one immutable attempt across repeated reads and a reload without expiring it", () => {
    const storage = new MemoryStorage();
    expect(writeReceivingPending(namespace, pending, { storage })).toBe(true);
    expect(hasReceivingPending(namespace, { storage })).toBe(true);
    expect(readReceivingPending(namespace, { storage })).toEqual(pending);
    expect(readReceivingPending(namespace, { storage })).toEqual(pending);
    expect(removeReceivingPending(namespace, pending.request.idempotencyKey, { storage })).toBe(true);
    expect(readReceivingPending(namespace, { storage })).toBeNull();
  });
  it("keeps the attempt scoped to the exact user, organization and store", () => {
    const storage = new MemoryStorage();
    writeReceivingPending(namespace, pending, { storage });
    for (const other of [
      { ...namespace, userId: "another-user" },
      { ...namespace, organizationId: "another-organization" },
      { ...namespace, storeId: "another-store" },
    ]) {
      expect(readReceivingPending(other, { storage })).toBeNull();
      expect(hasReceivingPending(other, { storage })).toBe(false);
    }
    expect(readReceivingPending(namespace, { storage })).toEqual(pending);
  });
  it("rejects a mismatched receipt store and an invalid financial payload", () => {
    const storage = new MemoryStorage();
    expect(writeReceivingPending(namespace, { ...pending,
      request: { ...pending.request, receiving: { ...pending.request.receiving, storeId: "another-store" } } }, { storage })).toBe(false);
    expect(writeReceivingPending(namespace, { ...pending,
      request: { ...pending.request, receiving: { ...pending.request.receiving, lines: [{ productId: "product-one", quantity: 0, unitCost: 50 }] } } }, { storage })).toBe(false);
    expect(hasReceivingPending(namespace, { storage })).toBe(false);
  });
  it("refuses to post without verifiably saved recovery data", () => {
    const storage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
    expect(writeReceivingPending(namespace, pending, { storage })).toBe(false);
    const unavailable = { ...storage, setItem: () => { throw new Error("storage disabled"); } };
    expect(writeReceivingPending(namespace, pending, { storage: unavailable })).toBe(false);
  });
  it("keeps corrupt unresolved records detectable instead of silently deleting them", () => {
    const storage = new MemoryStorage();
    const key = `bazaar:inventory-receiving-pending:${namespace.organizationId}:${namespace.userId}:${namespace.storeId}`;
    storage.setItem(key, "not-json");
    expect(hasReceivingPending(namespace, { storage })).toBe(true);
    expect(readReceivingPending(namespace, { storage })).toBeNull();
    expect(hasReceivingPending(namespace, { storage })).toBe(true);
  });
  it("fails closed after a transient read error and never overwrites an unresolved request", () => {
    const storage = new MemoryStorage();
    expect(writeReceivingPending(namespace, pending, { storage })).toBe(true);
    const unreliable = { getItem: () => { throw new Error("temporary read failure"); },
      setItem: (key: string, value: string) => storage.setItem(key, value), removeItem: (key: string) => storage.removeItem(key) };
    expect(readReceivingPendingState(namespace, { storage: unreliable }).status).toBe("UNAVAILABLE");
    expect(hasReceivingPending(namespace, { storage: unreliable })).toBe(true);
    expect(writeReceivingPending(namespace, { ...pending, request: { ...pending.request, idempotencyKey: "different-operation" } }, { storage })).toBe(false);
    expect(readReceivingPending(namespace, { storage })).toEqual(pending);
  });
  it("does not let a late response from an old page remove a newer operation", () => {
    const storage = new MemoryStorage();
    const newer = { ...pending, request: { ...pending.request, idempotencyKey: "newer-operation" } };
    expect(writeReceivingPending(namespace, newer, { storage })).toBe(true);
    expect(removeReceivingPending(namespace, pending.request.idempotencyKey, { storage })).toBe(false);
    expect(readReceivingPending(namespace, { storage })).toEqual(newer);
    expect(removeReceivingPending(namespace, newer.request.idempotencyKey, { storage })).toBe(true);
  });
  it("does not restore a schema-valid draft that disagrees with frozen financial values", () => {
    const storage = new MemoryStorage();
    const altered = { ...pending, draft: { ...pending.draft,
      lines: pending.draft.lines.map(line => ({ ...line, quantityInput: "5" })) } };
    expect(writeReceivingPending(namespace, altered, { storage })).toBe(false);
    const key = `bazaar:inventory-receiving-pending:${namespace.organizationId}:${namespace.userId}:${namespace.storeId}`;
    storage.setItem(key, JSON.stringify({ version: 1, identity: namespace, pending: altered }));
    expect(readReceivingPendingState(namespace, { storage }).status).toBe("INVALID");
    expect(hasReceivingPending(namespace, { storage })).toBe(true);
  });
  it("round-trips optional sale drafts without changing existing handoff compatibility", () => {
    const storage = new MemoryStorage();
    const withPrice = { ...pending.draft, focusedElement: { target: "lineInput" as const, key: "product-one:BASE", field: "salePrice" as const } };
    expect(writeReceivingDraft(draftKey, namespace, withPrice, { storage, nowMs: 1000 })).toBe(true);
    expect(consumeReceivingDraft(draftKey, namespace, { storage, nowMs: 2000 })).toEqual(withPrice);
  });
  it("retains exact receipt seconds across a product-card handoff and validates frozen currency amounts", () => {
    const storage = new MemoryStorage();
    const exactDateIso = "2026-08-07T14:00:45.125Z";
    const usd = { request: { ...pending.request, receiving: { ...pending.request.receiving, date: exactDateIso,
      lines: [{ productId: "product-one", variantId: null, quantity: 3, unitCost: 50, salePriceKgs: 435 }] } },
      draft: { ...pending.draft, exactDateIso, currencyCode: "USD", currencyRateKgsPerUnit: 87,
        lines: pending.draft.lines.map(line => ({ ...line, salePriceInput: "5,00" })) } };
    expect(writeReceivingDraft(draftKey, namespace, usd.draft, { storage, nowMs: 1000 })).toBe(true);
    expect(consumeReceivingDraft(draftKey, namespace, { storage, nowMs: 2000 })?.exactDateIso).toBe(exactDateIso);
    expect(writeReceivingPending(namespace, usd, { storage })).toBe(true);
    expect(readReceivingPending(namespace, { storage })).toEqual(usd);
    const key = `bazaar:inventory-receiving-pending:${namespace.organizationId}:${namespace.userId}:${namespace.storeId}`;
    storage.setItem(key, JSON.stringify({ version: 1, identity: namespace,
      pending: { ...usd, draft: { ...usd.draft, currencyRateKgsPerUnit: 88 } } }));
    expect(readReceivingPendingState(namespace, { storage }).status).toBe("INVALID");
  });
});
