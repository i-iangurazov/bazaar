// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inventoryProductImageUrl } from "@/lib/inventoryProductPresentation";
import { InventoryProductThumbnail } from "@/components/inventory/inventory-line-presentation";

const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    inventory: {
      productPresentation: { useMutation: () => ({ mutateAsync: mocks.load }) },
    },
  },
}));
import { useInventoryLinePresentation } from "@/components/inventory/use-inventory-line-presentation";

const line = {
  productId: "hose",
  imageUrl: null,
  sku: "",
  barcode: null,
  quantityInput: "7,5",
  unitCostInput: "0",
};
const input = { storeId: "warehouse", productIds: [line.productId] };
const details = {
  productId: "hose",
  imageUrl: "/uploads/old.webp",
  sku: "HOSE-100",
  barcode: "123",
};
const tick = async () => {
  await act(async () => {
    vi.advanceTimersByTime(160);
  });
};
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  mocks.load.mockReset();
});

describe("inventory line presentation", () => {
  it("uses gallery order, legacy photos and safe fallback without embedded payloads", () => {
    expect(
      inventoryProductImageUrl({
        images: [{ url: "data:image/png;base64,large" }, { url: "/uploads/gallery.webp" }],
        photoUrl: "/uploads/legacy.webp",
      }),
    ).toBe("/uploads/gallery.webp");
    expect(
      inventoryProductImageUrl({
        images: [{ url: " " }],
        photoUrl: " https://example.test/legacy.webp ",
      }),
    ).toBe("https://example.test/legacy.webp");
    expect(inventoryProductImageUrl({ photoUrl: "javascript:alert(1)" })).toBeNull();
    expect(inventoryProductImageUrl({ photoUrl: "//other.test/photo.webp" })).toBeNull();
    expect(inventoryProductImageUrl({})).toBeNull();
  });
  it("hydrates edit/draft metadata and removes a deleted photo without changing user inputs", async () => {
    vi.useFakeTimers();
    mocks.load
      .mockResolvedValueOnce([details])
      .mockResolvedValueOnce([{ ...details, imageUrl: null }]);
    const original = structuredClone(line);
    const { result } = renderHook(() => useInventoryLinePresentation(input, true));
    await tick();
    expect(result.current.getPresentation(line)).toEqual(details);
    expect(line).toEqual(original);
    act(() => result.current.refetch());
    await tick();
    expect(
      result.current.getPresentation({ ...line, imageUrl: "/uploads/old.webp" }).imageUrl,
    ).toBeNull();
    expect(line).toEqual(original);
  });
  it("ignores late replies for a previous store/document and clears data while disabled", async () => {
    vi.useFakeTimers();
    let first!: (data: unknown) => void;
    mocks.load
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            first = resolve;
          }),
      )
      .mockResolvedValue([{ ...details, imageUrl: "/uploads/new.webp" }]);
    const { result, rerender } = renderHook(
      ({ value, enabled }) => useInventoryLinePresentation(value, enabled),
      {
        initialProps: { value: { ...input, documentKey: "TRANSFER:TRANSFER:old" }, enabled: true },
      },
    );
    await tick();
    rerender({
      value: { ...input, storeId: "new-store", documentKey: "TRANSFER:TRANSFER:new" },
      enabled: true,
    });
    expect(result.current.getPresentation(line)).toEqual(line);
    await tick();
    await act(async () => first([details]));
    expect(result.current.getPresentation(line).imageUrl).toBe("/uploads/new.webp");
    rerender({
      value: { ...input, storeId: "new-store", documentKey: "TRANSFER:TRANSFER:new" },
      enabled: false,
    });
    expect(result.current.getPresentation(line)).toEqual(line);
  });
  it("retains loaded metadata on a failed refresh and recovers through retry/focus", async () => {
    vi.useFakeTimers();
    mocks.load
      .mockResolvedValueOnce([details])
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue([{ ...details, imageUrl: "/uploads/new.webp" }]);
    const { result } = renderHook(() => useInventoryLinePresentation(input, true));
    await tick();
    act(() => result.current.refetch());
    await tick();
    expect(result.current.isError).toBe(true);
    expect(result.current.getPresentation(line)).toEqual(details);
    act(() => result.current.refetch());
    await tick();
    expect(result.current.isError).toBe(false);
    act(() => window.dispatchEvent(new Event("focus")));
    await tick();
    expect(mocks.load).toHaveBeenCalledTimes(4);
  });
  it("deduplicates 500 product IDs into a single POST metadata request", async () => {
    vi.useFakeTimers();
    mocks.load.mockResolvedValue([]);
    const productIds = Array.from({ length: 500 }, (_, i) => `product-${i}`);
    renderHook(() => useInventoryLinePresentation({ ...input, productIds }, true));
    await tick();
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(mocks.load.mock.calls[0][0].productIds).toHaveLength(500);
  });
  it("shows the established placeholder on image failure and loads a changed URL", () => {
    const { container, rerender } = render(
      <InventoryProductThumbnail imageUrl="/uploads/old.webp" className="bazaar-doc-line-thumb" />,
    );
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
    rerender(
      <InventoryProductThumbnail imageUrl="/uploads/new.webp" className="bazaar-doc-line-thumb" />,
    );
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/uploads/new.webp");
    rerender(
      <InventoryProductThumbnail imageUrl="/uploads/old.webp" className="bazaar-doc-line-thumb" />,
    );
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/uploads/old.webp");
  });
});
