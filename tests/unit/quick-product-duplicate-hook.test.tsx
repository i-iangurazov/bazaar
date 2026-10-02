// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), push: vi.fn(), toast: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({}),
    products: { duplicate: { useMutation: () => ({ mutate: mocks.mutate, isLoading: false }) } },
  },
}));
import { useQuickProductDuplicate } from "@/components/products/use-quick-product-duplicate";

describe("quick product duplicate action", () => {
  beforeEach(() => vi.clearAllMocks());
  it("sends the selected store and ignores a second click while the first request is in flight", () => {
    const { result } = renderHook(() => useQuickProductDuplicate());
    act(() => {
      result.current.duplicateProduct("product-1", "store-2");
      result.current.duplicateProduct("product-1", "store-2");
    });
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.mutate).toHaveBeenCalledWith(expect.objectContaining({
      productId: "product-1", storeId: "store-2", idempotencyKey: expect.any(String),
    }));
  });
});
