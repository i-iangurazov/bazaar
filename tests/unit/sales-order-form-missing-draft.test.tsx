// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ru from "../../messages/ru.json";

const mocks = vi.hoisted(() => {
  const store = {
    id: "store-1",
    name: "Test store",
    currencyCode: "KGS",
    currencyRateKgsPerUnit: 1,
    organization: { retailWholesaleEnabled: false },
  };
  const order = {
    id: "order-10",
    number: "SO-000010",
    status: "DRAFT",
    storeId: "store-1",
    priceMode: "RETAIL",
    updatedAt: "2026-11-16T12:00:00.000Z",
    customerId: null,
    customerName: null,
    customerEmail: null,
    customerPhone: null,
    customerAddress: null,
    notes: "Original note",
    store,
    lines: [
      {
        id: "line-1",
        productId: "product-missing",
        variantId: null,
        qty: 1,
        unitPriceKgs: 0,
        lineTotalKgs: 0,
        priceSource: "MISSING",
        manualPrice: false,
        product: { name: "Unpriced item", sku: "SKU-MISSING", isBundle: false },
      },
    ],
  };
  return {
    store,
    order,
    mode: "edit" as "edit" | "create",
    userId: "user-1",
    toast: vi.fn(),
    push: vi.fn(),
    updateMutate: vi.fn(async (_input: Record<string, unknown>) => order),
    createMutate: vi.fn(async (_input: Record<string, unknown>) => order),
    saleMutate: vi.fn(async (_input: Record<string, unknown>) => order),
    storesQuery: { data: [store], error: null, isLoading: false },
    productsQuery: { data: [] as unknown[], error: null, isLoading: false },
    utils: {
      salesOrders: {
        list: { invalidate: vi.fn() },
        getById: { invalidate: vi.fn() },
        linePrice: {
          fetch: vi.fn(async () => ({
            hasConfiguredPrice: false,
            unitPriceKgs: 0,
            priceSource: "STANDARD",
          })),
        },
      },
    },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.push }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/sales/orders/order-10/edit",
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: { id: mocks.userId, organizationId: "org-1", role: "ADMIN" },
    },
    status: "authenticated",
  }),
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/components/ui/use-confirm-dialog", () => ({
  useConfirmDialog: () => ({ confirm: vi.fn(async () => true), confirmDialog: null }),
}));

vi.mock("@/components/sales-order-customer-select", () => ({
  SalesOrderCustomerSelect: () => null,
}));

vi.mock("@/components/ScanInput", () => ({
  ScanInput: React.forwardRef(function MockScanInput(
    {
      value,
      onValueChange,
      onResolved,
    }: {
      value: string;
      onValueChange: (value: string) => void;
      onResolved: (resolved: {
        kind: "exact";
        item: { id: string; name: string; sku: string };
      }) => boolean;
    },
    _ref: React.ForwardedRef<HTMLInputElement>,
  ) {
    return (
      <div>
        <input
          aria-label="product search"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
        />
        <button
          type="button"
          onClick={() =>
            onResolved({
              kind: "exact",
              item: { id: "product-missing", name: "Unpriced item", sku: "SKU-MISSING" },
            })
          }
        >
          resolve product
        </button>
      </div>
    );
  }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => mocks.utils,
    stores: {
      list: {
        useQuery: () => mocks.storesQuery,
      },
    },
    products: {
      searchQuick: {
        useQuery: () => mocks.productsQuery,
      },
    },
    salesOrders: {
      getById: {
        useQuery: () => ({
          data: mocks.mode === "edit" ? mocks.order : undefined,
          error: null,
          isLoading: false,
          refetch: vi.fn(),
        }),
      },
      quotePriceMode: {
        useMutation: () => ({ mutateAsync: vi.fn(), isLoading: false }),
      },
      createDraft: {
        useMutation: () => ({ mutateAsync: mocks.createMutate, isLoading: false }),
      },
      createSale: {
        useMutation: () => ({ mutateAsync: mocks.saleMutate, isLoading: false }),
      },
      update: {
        useMutation: () => ({ mutateAsync: mocks.updateMutate, isLoading: false }),
      },
    },
  },
}));

import { SalesOrderForm } from "@/components/sales-order-form";
import { TooltipProvider } from "@/components/ui/tooltip";

const renderForm = (mode: "edit" | "create") => {
  mocks.mode = mode;
  return render(
    <NextIntlClientProvider locale="ru" messages={ru} timeZone="Asia/Bishkek">
      <TooltipProvider>
        <SalesOrderForm mode={mode} orderId={mode === "edit" ? "order-10" : undefined} />
      </TooltipProvider>
    </NextIntlClientProvider>,
  );
};

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userId = "user-1";
  window.sessionStorage.clear();
});

describe("BZR-03 saving an incomplete MISSING draft", () => {
  it("edits SO-000010 notes and saves the draft while its line has no price", async () => {
    renderForm("edit");
    const notes = (await screen.findByLabelText(ru.salesOrders.notes)) as HTMLTextAreaElement;
    expect(notes.value).toBe("Original note");
    fireEvent.change(notes, { target: { value: "Edited note" } });

    fireEvent.click(screen.getByTestId("sales-order-save"));

    await waitFor(() => {
      expect(mocks.updateMutate).toHaveBeenCalledTimes(1);
    });
    const payload = mocks.updateMutate.mock.calls[0]![0] as {
      notes?: string;
      lines: Array<Record<string, unknown>>;
    };
    expect(payload.notes).toBe("Edited note");
    expect(payload.lines).toEqual([
      { lineId: "line-1", productId: "product-missing", variantId: null, qty: 1 },
    ]);
    expect(mocks.toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ description: ru.salesOrders.priceNotSetBlocking }),
    );
  });

  it("still blocks a manually entered invalid price", async () => {
    renderForm("edit");
    const price = (await screen.findByLabelText(
      `${ru.salesOrders.unitPrice} · Unpriced item`,
    )) as HTMLInputElement;
    fireEvent.change(price, { target: { value: "not-a-price" } });

    fireEvent.click(screen.getByTestId("sales-order-save"));

    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith({
        variant: "error",
        description: ru.salesOrders.unitPriceInvalid,
      });
    });
    expect(mocks.updateMutate).not.toHaveBeenCalled();
  });

  it("creates the MISSING draft but blocks posting it", async () => {
    renderForm("create");
    await waitFor(() => {
      expect((screen.getByTestId("sales-order-save") as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByRole("button", { name: "resolve product" }));
    expect((await screen.findAllByText("Unpriced item")).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId("sales-order-save"));
    await waitFor(() => {
      expect(mocks.createMutate).toHaveBeenCalledTimes(1);
    });
    const payload = mocks.createMutate.mock.calls[0]![0] as {
      lines: Array<Record<string, unknown>>;
    };
    expect(payload.lines).toEqual([
      { productId: "product-missing", variantId: null, qty: 1 },
    ]);

    const postButton = screen.getByRole("button", {
      name: ru.salesOrders.workspace.postSale,
    }) as HTMLButtonElement;
    expect(postButton.disabled).toBe(true);
    expect(screen.getAllByText(ru.salesOrders.priceNotSetBlocking).length).toBeGreaterThan(0);
    fireEvent.click(postButton);
    expect(mocks.saleMutate).not.toHaveBeenCalled();
  });
});

describe("unfinished customer order recovery", () => {
  it("restores a decimal price, quantities and notes after leaving the form", async () => {
    const first = renderForm("create");
    await waitFor(() =>
      expect((screen.getByTestId("sales-order-save") as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "resolve product" }));
    const priceLabel = `${ru.salesOrders.unitPrice} · Unpriced item`;
    const qtyLabel = `${ru.salesOrders.qty} · Unpriced item`;
    fireEvent.change(await screen.findByLabelText(priceLabel), { target: { value: "68,5" } });
    fireEvent.change(screen.getByLabelText(qtyLabel), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText(ru.salesOrders.notes), {
      target: { value: "Оставить на выдаче" },
    });
    expect(mocks.createMutate).not.toHaveBeenCalled();
    first.unmount();

    mocks.userId = "user-2";
    const other = renderForm("create");
    expect((await screen.findByLabelText(ru.salesOrders.notes) as HTMLTextAreaElement).value).toBe("");
    expect(screen.queryByLabelText(priceLabel)).toBeNull();
    other.unmount();

    mocks.userId = "user-1";
    renderForm("create");
    expect(await screen.findByText(ru.salesOrders.workspace.localDraftRestored)).toBeTruthy();
    expect((screen.getByLabelText(qtyLabel) as HTMLInputElement).value).toBe("2");
    expect((screen.getByLabelText(priceLabel) as HTMLInputElement).value).toBe("68,5");
    expect((screen.getByLabelText(ru.salesOrders.notes) as HTMLTextAreaElement).value).toBe(
      "Оставить на выдаче",
    );
    expect(mocks.createMutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: ru.salesOrders.workspace.discardLocalDraft }));
    await waitFor(() => expect(screen.queryByLabelText(priceLabel)).toBeNull());
    expect(window.sessionStorage.length).toBe(0);
  });

  it("reuses the same idempotency key after a lost save response and remount", async () => {
    mocks.createMutate.mockRejectedValueOnce(new Error("connection lost"));
    const first = renderForm("create");
    await waitFor(() =>
      expect((screen.getByTestId("sales-order-save") as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.change(screen.getByLabelText(ru.salesOrders.notes), {
      target: { value: "Отложить до вечера" },
    });
    fireEvent.click(screen.getByTestId("sales-order-save"));
    await waitFor(() => expect(mocks.createMutate).toHaveBeenCalledTimes(1));
    const request = mocks.createMutate.mock.calls[0]![0];
    first.unmount();

    renderForm("create");
    await screen.findByText(ru.salesOrders.workspace.localDraftRestored);
    fireEvent.click(screen.getByTestId("sales-order-save"));
    await waitFor(() => expect(mocks.createMutate).toHaveBeenCalledTimes(2));
    expect(mocks.createMutate.mock.calls[1]![0]).toEqual(request);
  });
});

describe("V2-02 loaded manual snapshot vs current price intent", () => {
  const originalLine = { ...mocks.order.lines[0] };
  afterEach(() => {
    mocks.order.lines[0] = { ...originalLine };
  });

  const renderManualLine = () => {
    mocks.order.lines[0] = {
      ...originalLine,
      qty: 2,
      unitPriceKgs: 80,
      lineTotalKgs: 160,
      priceSource: "MANUAL",
      manualPrice: true,
    };
    renderForm("edit");
  };

  it("qty-only edit omits the loaded manual snapshot from the update payload", async () => {
    renderManualLine();
    const qty = (await screen.findByLabelText(
      `${ru.salesOrders.qty} · Unpriced item`,
    )) as HTMLInputElement;
    fireEvent.change(qty, { target: { value: "3" } });
    fireEvent.click(screen.getByTestId("sales-order-save"));
    await waitFor(() => expect(mocks.updateMutate).toHaveBeenCalledTimes(1));
    const payload = mocks.updateMutate.mock.calls[0]![0] as {
      lines: Array<Record<string, unknown>>;
    };
    expect(payload.lines).toEqual([
      { lineId: "line-1", productId: "product-missing", variantId: null, qty: 3 },
    ]);
  });

  it("intentional price edit is still serialized as MANUAL", async () => {
    renderManualLine();
    const price = (await screen.findByLabelText(
      `${ru.salesOrders.unitPrice} · Unpriced item`,
    )) as HTMLInputElement;
    fireEvent.change(price, { target: { value: "95" } });
    fireEvent.click(screen.getByTestId("sales-order-save"));
    await waitFor(() => expect(mocks.updateMutate).toHaveBeenCalledTimes(1));
    const payload = mocks.updateMutate.mock.calls[0]![0] as {
      lines: Array<Record<string, unknown>>;
    };
    expect(payload.lines[0]).toEqual({
      lineId: "line-1",
      productId: "product-missing",
      variantId: null,
      qty: 2,
      unitPriceKgs: 95,
      priceSource: "MANUAL",
    });
  });
});
