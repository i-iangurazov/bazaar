// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ validate: vi.fn() }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    inventory: { transferLineContext: { useMutation: () => ({ mutateAsync: mocks.validate }) } },
  },
}));
import { useTransferLineContext } from "@/components/inventory/use-transfer-line-context";

const input = {
  fromStoreId: "warehouse",
  toStoreId: "shop-one",
  lines: [{ productId: "glove", variantId: null }],
};
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  mocks.validate.mockReset();
});
const tick = async () => {
  await act(async () => {
    vi.advanceTimersByTime(160);
  });
};

describe("transfer validation recovery", () => {
  it("ignores a late response for the previous destination", async () => {
    vi.useFakeTimers();
    let first!: (value: unknown) => void, second!: (value: unknown) => void;
    mocks.validate
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            first = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            second = resolve;
          }),
      );
    const { result, rerender } = renderHook((props) => useTransferLineContext(props, true), {
      initialProps: input,
    });
    await tick();
    rerender({ ...input, toStoreId: "shop-two" });
    expect(result.current.data).toBeUndefined();
    expect(result.current.isFetching).toBe(true);
    await tick();
    await act(async () => second([{ key: "glove:BASE", available: true, destinationStock: 20 }]));
    expect(result.current.data?.[0]).toMatchObject({ destinationStock: 20 });
    await act(async () => first([{ key: "glove:BASE", available: true, destinationStock: 99 }]));
    expect(result.current.data?.[0]).toMatchObject({ destinationStock: 20 });
  });
  it("retries a failed check and revalidates when the user returns to the window", async () => {
    vi.useFakeTimers();
    mocks.validate
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue([{ key: "glove:BASE", available: false }]);
    const { result } = renderHook(() => useTransferLineContext(input, true));
    await tick();
    expect(result.current.isError).toBe(true);
    act(() => result.current.refetch());
    await tick();
    expect(result.current.isError).toBe(false);
    expect(result.current.data?.[0].available).toBe(false);
    act(() => window.dispatchEvent(new Event("focus")));
    await tick();
    expect(mocks.validate).toHaveBeenCalledTimes(3);
  });
  it("keeps all 500 selected lines in a single validation payload", async () => {
    vi.useFakeTimers();
    mocks.validate.mockResolvedValue([]);
    const lines = Array.from({ length: 500 }, (_, index) => ({
      productId: `product-${index}`,
      variantId: null,
    }));
    renderHook(() => useTransferLineContext({ ...input, lines }, true));
    await tick();
    expect(mocks.validate.mock.calls[0][0].lines).toEqual(lines);
  });
});
