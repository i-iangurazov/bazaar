import { describe, expect, it, vi } from "vitest";

import { updateSelectedProductArchiveState } from "@/lib/productBulkActions";

describe("product archive selection across pages", () => {
  it("archives all thirty selected records, including IDs outside the visible page", async () => {
    const ids = Array.from({ length: 30 }, (_, index) => `product-${index}`);
    const updateProduct = vi.fn().mockResolvedValue({});
    const result = await updateSelectedProductArchiveState({
      selectedIds: ids,
      archived: true,
      loadProducts: async (requested) => requested.map((id) => ({ id, isDeleted: false })),
      updateProduct,
    });
    expect(updateProduct.mock.calls.map(([id]) => id)).toEqual(ids);
    expect(result).toEqual({ succeededIds: ids, failedIds: [], skippedIds: [] });
  });

  it("keeps failures for retry and skips rows already in the requested state", async () => {
    const updateProduct = vi.fn(async (id: string) => {
      if (id === "denied") throw new Error("FORBIDDEN");
    });
    const result = await updateSelectedProductArchiveState({
      selectedIds: ["archived", "good", "denied", "revoked", "good"],
      archived: true,
      loadProducts: async () => [
        { id: "archived", isDeleted: true },
        { id: "good", isDeleted: false },
        { id: "denied", isDeleted: false },
        { id: "not-selected", isDeleted: false },
      ],
      updateProduct,
    });
    expect(updateProduct.mock.calls.map(([id]) => id)).toEqual(["good", "denied"]);
    expect(result).toEqual({ succeededIds: ["good"], failedIds: ["revoked", "denied"], skippedIds: ["archived"] });
  });

  it("restores archived rows while retaining active rows without duplicate audit writes", async () => {
    const updateProduct = vi.fn().mockResolvedValue({});
    const result = await updateSelectedProductArchiveState({
      selectedIds: ["active", "archived"], archived: false,
      loadProducts: async () => [{ id: "active", isDeleted: false }, { id: "archived", isDeleted: true }],
      updateProduct,
    });
    expect(updateProduct).toHaveBeenCalledTimes(1);
    expect(updateProduct).toHaveBeenCalledWith("archived");
    expect(result).toEqual({ succeededIds: ["archived"], failedIds: [], skippedIds: ["active"] });
  });

  it("performs no mutations when any selected-state read fails", async () => {
    const updateProduct = vi.fn();
    await expect(updateSelectedProductArchiveState({
      selectedIds: Array.from({ length: 101 }, (_, index) => `product-${index}`), archived: true,
      loadProducts: async (ids) => {
        if (ids.length === 1) throw new Error("read unavailable");
        return ids.map((id) => ({ id, isDeleted: false }));
      }, updateProduct,
    })).rejects.toThrow("read unavailable");
    expect(updateProduct).not.toHaveBeenCalled();
  });

  it("records a synchronous mutation rejection without losing other outcomes", async () => {
    const result = await updateSelectedProductArchiveState({
      selectedIds: ["good", "bad"], archived: true,
      loadProducts: async (ids) => ids.map((id) => ({ id, isDeleted: false })),
      updateProduct: (id) => { if (id === "bad") throw new Error("rejected"); return Promise.resolve(); },
    });
    expect(result).toEqual({ succeededIds: ["good"], failedIds: ["bad"], skippedIds: [] });
  });

  it("bounds read size and mutation concurrency for large selections", async () => {
    const ids = Array.from({ length: 205 }, (_, index) => `product-${index}`);
    const reads: number[] = [];
    let pending = 0;
    let peak = 0;
    const result = await updateSelectedProductArchiveState({
      selectedIds: ids, archived: true,
      loadProducts: async (requested) => {
        reads.push(requested.length);
        return requested.map((id) => ({ id, isDeleted: false }));
      },
      updateProduct: async () => {
        pending += 1; peak = Math.max(peak, pending);
        await Promise.resolve(); pending -= 1;
      },
    });
    expect(reads).toEqual([100, 100, 5]);
    expect(peak).toBeLessThanOrEqual(5);
    expect(result.succeededIds).toEqual(ids);
  });
});
