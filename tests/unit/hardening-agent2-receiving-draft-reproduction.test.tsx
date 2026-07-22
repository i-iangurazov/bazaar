// @vitest-environment jsdom

import type { ReactNode } from "react";
import React from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSearchParams, mockUseSession, mockToast } = vi.hoisted(() => ({
  mockSearchParams: new URLSearchParams(),
  mockUseSession: vi.fn(),
  mockToast: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => mockSearchParams,
}));

vi.mock("next-auth/react", () => ({
  useSession: mockUseSession,
}));

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/components/page-header", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

vi.mock("@/components/page-loading", () => ({
  PageLoading: () => <div>loading</div>,
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    asChild: _asChild,
    variant: _variant,
    size: _size,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    asChild?: boolean;
    variant?: string;
    size?: string;
  }) => <button {...props}>{children}</button>,
}));

vi.mock("@/components/ui/input", () => {
  const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
    (props, ref) => <input ref={ref} {...props} />,
  );
  Input.displayName = "MockInput";
  return { Input };
});

vi.mock("@/components/ui/textarea", () => {
  const Textarea = React.forwardRef<
    HTMLTextAreaElement,
    React.TextareaHTMLAttributes<HTMLTextAreaElement>
  >((props, ref) => <textarea ref={ref} {...props} />);
  Textarea.displayName = "MockTextarea";
  return { Textarea };
});

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
    <label {...props}>{children}</label>
  ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/spinner", () => ({
  Spinner: () => <span>spinner</span>,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectValue: () => <span />,
}));

vi.mock("@/components/icons", () => {
  const Icon = () => <span aria-hidden />;
  return {
    BackIcon: Icon,
    AddIcon: Icon,
    CopyIcon: Icon,
    DeleteIcon: Icon,
    EditIcon: Icon,
    EmptyIcon: Icon,
    ReceiveIcon: Icon,
    SearchIcon: Icon,
    StatusDangerIcon: Icon,
    StatusSuccessIcon: Icon,
  };
});

const emptyQuery = { data: [], isLoading: false, isFetching: false, error: null };
const mutation = { isLoading: false, mutate: vi.fn() };
const invalidate = vi.fn().mockResolvedValue(undefined);
const fetchProducts = vi.fn().mockResolvedValue([]);

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      inventory: {
        list: { invalidate },
        searchProducts: { invalidate, fetch: fetchProducts },
        productMovements: { invalidate },
        productMovementDocument: { invalidate },
        editableProductMovementDocument: { invalidate },
      },
    }),
    stores: {
      list: {
        useQuery: () => ({
          ...emptyQuery,
          data: [
            {
              id: "store-b",
              name: "User B Store",
              enableSku: true,
              enableBarcode: true,
              currencyCode: "KGS",
              currencyRateKgsPerUnit: 1,
            },
          ],
        }),
      },
    },
    inventory: {
      editableProductMovementDocument: { useQuery: () => emptyQuery },
      searchProducts: { useQuery: () => emptyQuery },
      postStockReceiving: { useMutation: () => mutation },
      editProductMovementDocument: { useMutation: () => mutation },
    },
  },
}));

import { InventoryReceivingPage } from "@/components/inventory/receiving-workflow";

describe("HARD-A2-017 receiving draft account isolation", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    mockSearchParams.delete("receivingDraftKey");
    mockSearchParams.delete("returnSource");
    mockUseSession.mockReturnValue({
      status: "authenticated",
      data: {
        user: {
          id: "user-b",
          organizationId: "org-b",
          role: "MANAGER",
          email: "user-b@test.local",
        },
      },
    });
    vi.stubGlobal("React", React);
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    vi.stubGlobal("scrollTo", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("hydrates User A's unowned session draft into User B's receiving form and leaves it reusable", async () => {
    const draftKey = "receiving-user-a-canary";
    const storageKey = `bazaar:inventory-receiving-draft:${draftKey}`;
    const draft = {
      version: 1,
      storeId: "store-a",
      dateTime: "2026-07-22T06:00",
      supplierName: "USER-A-SUPPLIER-CANARY",
      referenceNumber: "USER-A-REFERENCE-CANARY",
      note: "USER-A-NOTE-CANARY",
      search: "USER-A-SEARCH-CANARY",
      lines: [
        {
          key: "product-a:BASE",
          productId: "product-a",
          variantId: null,
          productName: "USER-A-PRODUCT-CANARY",
          variantName: null,
          sku: "USER-A-SKU",
          barcode: null,
          imageUrl: null,
          currentStock: 4,
          unitCostInput: "123",
          quantityInput: "7",
        },
      ],
    };
    window.sessionStorage.setItem(storageKey, JSON.stringify(draft));
    mockSearchParams.set("receivingDraftKey", draftKey);
    mockSearchParams.set("returnSource", "stockReceiving");

    const { container } = render(<InventoryReceivingPage />);

    await waitFor(() => {
      expect((container.querySelector("#receiving-supplier") as HTMLInputElement | null)?.value).toBe(
        "USER-A-SUPPLIER-CANARY",
      );
    });
    expect((container.querySelector("#receiving-reference") as HTMLInputElement).value).toBe(
      "USER-A-REFERENCE-CANARY",
    );
    expect((container.querySelector("#receiving-note") as HTMLTextAreaElement).value).toBe(
      "USER-A-NOTE-CANARY",
    );
    expect(container.textContent).toContain("USER-A-PRODUCT-CANARY");
    expect(
      Array.from(container.querySelectorAll<HTMLInputElement>('input[data-receiving-input="quantity"]')).some(
        (input) => input.value === "7",
      ),
    ).toBe(true);
    expect(window.sessionStorage.getItem(storageKey)).toBe(JSON.stringify(draft));
    expect(fetchProducts).not.toHaveBeenCalled();
  });
});
