// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  createDraft: vi.fn(async () => ({ id: "runtime-order-id" })),
  pricing: vi.fn(async () => ({ effectivePriceKgs: 100 })),
  push: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: runtime.push }),
  usePathname: () => "/sales/orders/new",
  useSearchParams: () => new URLSearchParams("mode=return"),
}));

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: runtime.toast }),
}));

vi.mock("@/components/ScanInput", () => ({
  ScanInput: (props: { ariaLabel?: string }) => (
    <input aria-label={props.ariaLabel ?? "scan-input"} />
  ),
}));

vi.mock("@/components/product-search-result-item", () => ({
  ProductSearchResultItem: () => null,
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ products: { pricing: { fetch: runtime.pricing } } }),
    stores: {
      list: {
        useQuery: () => ({
          data: [
            {
              id: "store-a",
              name: "Store A",
              currencyCode: "KGS",
              currencyRateKgsPerUnit: 1,
            },
          ],
        }),
      },
    },
    products: {
      searchQuick: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
    },
    salesOrders: {
      createDraft: {
        useMutation: () => ({ mutateAsync: runtime.createDraft, isLoading: false }),
      },
    },
  },
}));

describe("B0 Agent 3 return-mode runtime wiring", () => {
  beforeEach(() => {
    runtime.createDraft.mockClear();
    runtime.pricing.mockClear();
    runtime.push.mockClear();
    runtime.toast.mockClear();
  });

  it("reproduces HARD-A3-011: return-labelled UI submits the ordinary sales draft mutation", async () => {
    vi.stubGlobal("React", React);
    const { default: NewSalesOrderPage } = await import("@/app/(app)/sales/orders/new/page");
    render(<NewSalesOrderPage />);

    expect(screen.getByText("newReturn")).toBeTruthy();
    expect(screen.getByText("returnModeHint")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText("Store A")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "create" }));
    await waitFor(() => {
      expect(runtime.createDraft).toHaveBeenCalledTimes(1);
    });

    const submittedPayload = runtime.createDraft.mock.calls[0]?.[0] as Record<string, unknown>;
    console.info(
      `[B0-EVIDENCE] HARD-A3-011-ui ${JSON.stringify({
        displayedTitle: "newReturn",
        mutation: "salesOrders.createDraft",
        submittedPayload,
        hasOriginalSaleIdentity:
          "originalSaleId" in submittedPayload || "customerOrderId" in submittedPayload,
        hasReturnType: "returnType" in submittedPayload || "isReturn" in submittedPayload,
      })}`,
    );

    expect(submittedPayload).toEqual({
      storeId: "store-a",
      customerName: null,
      customerEmail: null,
      customerPhone: null,
      customerAddress: null,
      notes: null,
      lines: [],
    });
    expect(submittedPayload).not.toHaveProperty("originalSaleId");
    expect(submittedPayload).not.toHaveProperty("customerOrderId");
    expect(submittedPayload).not.toHaveProperty("isReturn");
  });
});
