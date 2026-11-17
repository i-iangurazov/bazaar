// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ru from "../../messages/ru.json";
import en from "../../messages/en.json";

const mocks = vi.hoisted(() => {
  const order = {
    id: "order-1",
    number: "SO-000001",
    status: "COMPLETED",
    storeId: "store-1",
    priceMode: "RETAIL",
    store: { id: "store-1", name: "Test store", currencyCode: "KGS", currencyRateKgsPerUnit: 1 },
    lines: [
      {
        id: "line-1",
        productId: "product-1",
        qty: 2,
        unitPriceKgs: 100,
        product: { name: "First item", sku: "P1" },
        saleReturnLines: [],
      },
    ],
  };
  const quote = {
    originalOrderId: "order-1",
    originalNumber: "SO-000001",
    status: "COMPLETED",
    storeId: "store-1",
    storeName: "Test store",
    currencyCode: "KGS",
    currencyRateKgsPerUnit: 1,
    priceMode: "RETAIL",
    retailWholesaleEnabled: true,
    money: {
      paidKgs: 200,
      returnedKgs: 0,
      actualRefundedKgs: 0,
      pendingRefundKgs: 0,
      offsetKgs: 0,
      netPaidKgs: 200,
      refundedKgs: 0,
      orderTotalKgs: 200,
    },
    returns: [] as unknown[],
    additions: [] as unknown[],
    returnedKgs: 100,
    addedKgs: 80,
    refundKgs: 20,
    chargeKgs: 0,
    openShifts: [
      { id: "shift-1", registerId: "register-1", registerName: "Register 1", openedAt: new Date() },
    ],
    fingerprint: "f".repeat(64),
    warnings: [] as string[],
  };
  return {
    order,
    quote,
    quoteEnabled: [] as boolean[],
    quoteInputs: [] as Array<Record<string, unknown>>,
    linePriceCalls: [] as Array<Record<string, unknown>>,
    deferLinePrice: false,
    pendingLinePrices: [] as Array<{
      input: Record<string, unknown>;
      resolve: (value: { hasConfiguredPrice: boolean; unitPriceKgs: number }) => void;
      reject: (reason?: unknown) => void;
    }>,
    correct: vi.fn(async () => ({ correctionNumber: "CR-000001", manualRefundRequired: false })),
    quoteRefetch: vi.fn(),
    toast: vi.fn(),
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/sales/orders/order-1/correction",
  useParams: () => ({ id: "order-1" }),
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { role: "ADMIN" } }, status: "authenticated" }),
}));

vi.mock("@/components/ScanInput", () => ({
  ScanInput: ({
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
  }) => (
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
            item: { id: "product-2", name: "Second item", sku: "P2" },
          })
        }
      >
        resolve product
      </button>
    </div>
  ),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    value,
    onValueChange,
  }: {
    children: React.ReactNode;
    value: string;
    onValueChange?: (value: string) => void;
  }) => (
    <select value={value ?? ""} onChange={(event) => onValueChange?.(event.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
}));

vi.mock("@/components/ui/use-confirm-dialog", () => ({
  useConfirmDialog: () => ({ confirm: vi.fn(async () => true), confirmDialog: null }),
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      salesOrders: {
        linePrice: {
          fetch: async (input: Record<string, unknown>) => {
            mocks.linePriceCalls.push(input);
            if (mocks.deferLinePrice) {
              return new Promise((resolve, reject) => {
                mocks.pendingLinePrices.push({ input, resolve, reject });
              });
            }
            return {
              hasConfiguredPrice: true,
              unitPriceKgs: input.priceMode === "WHOLESALE" ? 80 : 100,
            };
          },
        },
      },
    }),
    salesOrders: {
      getById: {
        useQuery: () => ({
          data: mocks.order,
          error: null,
          isLoading: false,
          refetch: vi.fn(),
        }),
      },
      correctionQuote: {
        useQuery: (input: Record<string, unknown>, options?: { enabled?: boolean }) => {
          const enabled = options?.enabled !== false;
          mocks.quoteInputs.push(input);
          mocks.quoteEnabled.push(enabled);
          return {
            data: enabled ? mocks.quote : undefined,
            error: null,
            isFetching: false,
            refetch: mocks.quoteRefetch,
          };
        },
      },
      correct: {
        useMutation: () => ({ mutateAsync: mocks.correct, isLoading: false }),
      },
    },
    products: {
      searchQuick: { useQuery: () => ({ data: [], isLoading: false }) },
    },
  },
}));

import SalesOrderCorrectionPage from "@/app/(app)/sales/orders/[id]/correction/page";

const renderPage = (locale: "ru" | "en" = "ru") =>
  render(
    <NextIntlClientProvider locale={locale} messages={locale === "ru" ? ru : en} timeZone="Asia/Bishkek">
      <SalesOrderCorrectionPage />
    </NextIntlClientProvider>,
  );

const addSecondItem = async () => {
  fireEvent.click(screen.getByRole("button", { name: "resolve product" }));
  return screen.findByTestId("correction-addition-line");
};

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.quote.retailWholesaleEnabled = true;
  mocks.quote.priceMode = "RETAIL";
  mocks.quoteEnabled.length = 0;
  mocks.quoteInputs.length = 0;
  mocks.linePriceCalls.length = 0;
  mocks.deferLinePrice = false;
  mocks.pendingLinePrices.length = 0;
});

describe("sales order correction page validation (BZR-06)", () => {
  it("keeps invalid rows visible, reports per-field errors and blocks quote and confirmation", async () => {
    renderPage();
    const returnInput = document.getElementById("return-line-1") as HTMLInputElement;
    fireEvent.change(returnInput, { target: { value: "1" } });
    const row = await addSecondItem();
    const inputs = row.querySelectorAll("input");
    const qtyInput = inputs[0] as HTMLInputElement;
    const priceInput = inputs[1] as HTMLInputElement;

    fireEvent.change(qtyInput, { target: { value: "not-a-number" } });

    const qtyError = await screen.findByText(ru.salesOrders.correctionPage.qtyInvalid);
    expect(qtyInput.getAttribute("aria-invalid")).toBe("true");
    expect(qtyInput.getAttribute("aria-describedby")).toBe(qtyError.id);
    expect(qtyError.id).toBeTruthy();
    expect(screen.getAllByTestId("correction-return-line")).toHaveLength(1);
    expect(screen.getAllByTestId("correction-addition-line")).toHaveLength(1);
    expect(screen.getByTestId("correction-preview-incomplete")).toBeTruthy();
    expect((screen.getByTestId("correction-confirm") as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.quoteEnabled.at(-1)).toBe(false);
    // The valid return row is still represented in the latest request input.
    expect(mocks.quoteInputs.at(-1)?.returns).toEqual([
      { lineId: "line-1", qty: 1, restock: true },
    ]);

    fireEvent.change(qtyInput, { target: { value: "1" } });
    fireEvent.change(priceInput, { target: { value: "" } });

    const priceError = await screen.findByText(ru.salesOrders.correctionPage.priceRequired);
    expect(priceInput.getAttribute("aria-invalid")).toBe("true");
    expect(priceInput.getAttribute("aria-describedby")).toBe(priceError.id);
    expect((screen.getByTestId("correction-confirm") as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.quoteEnabled.at(-1)).toBe(false);
    expect(mocks.correct).not.toHaveBeenCalled();

    fireEvent.change(priceInput, { target: { value: "80" } });
    await waitFor(() => {
      expect(screen.queryByText(ru.salesOrders.correctionPage.priceRequired)).toBeNull();
    });
    const settlement = screen.getByTestId("correction-settlement");
    fireEvent.change(within(settlement).getAllByRole("combobox")[0] as HTMLSelectElement, {
      target: { value: "shift-1" },
    });
    await waitFor(() => {
      expect((screen.getByTestId("correction-confirm") as HTMLButtonElement).disabled).toBe(false);
    });
    expect(mocks.quoteEnabled.at(-1)).toBe(true);
    expect(mocks.quoteInputs.at(-1)?.additions).toEqual([
      {
        key: expect.any(String),
        productId: "product-2",
        variantId: null,
        qty: 1,
        unitPriceKgs: 80,
      },
    ]);
  });

  it("reports over-available return quantities without clamping the visible input", async () => {
    renderPage();
    const returnInput = document.getElementById("return-line-1") as HTMLInputElement;
    fireEvent.change(returnInput, { target: { value: "5" } });

    expect(
      await screen.findByText(
        ru.salesOrders.correctionPage.qtyExceedsAvailable.replace("{available}", "2"),
      ),
    ).toBeTruthy();
    expect(returnInput.value).toBe("5");
    expect(returnInput.getAttribute("aria-invalid")).toBe("true");
    expect((screen.getByTestId("correction-confirm") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("sales order correction page added-goods price mode (BZR-08)", () => {
  it("shows the control with additions and reprices only unedited added lines", async () => {
    renderPage();
    const control = await screen.findByTestId("correction-price-mode");
    const settlement = screen.getByTestId("correction-settlement");
    expect(within(settlement).queryByTestId("correction-price-mode")).toBeNull();

    const row = await addSecondItem();
    const priceInput = row.querySelectorAll("input")[1] as HTMLInputElement;
    expect(priceInput.value).toBe("100");

    fireEvent.change(within(control).getByRole("combobox") as HTMLSelectElement, {
      target: { value: "WHOLESALE" },
    });

    await waitFor(() => {
      expect(mocks.linePriceCalls.at(-1)).toMatchObject({ priceMode: "WHOLESALE" });
      expect(priceInput.value).toBe("80");
    });
    const returnLine = screen.getByTestId("correction-return-line");
    expect(returnLine.textContent).toContain("100,00");
    expect(screen.getByTestId("correction-exchange-offset").textContent).toContain("80,00");
    expect(mocks.quoteInputs.at(-1)?.priceMode).toBe("WHOLESALE");
    expect(mocks.quoteInputs.at(-1)?.additions).toEqual([
      {
        key: expect.any(String),
        productId: "product-2",
        variantId: null,
        qty: 1,
      },
    ]);
  });

  it("does not reprice an edited added line when the price mode changes", async () => {
    renderPage();
    const control = await screen.findByTestId("correction-price-mode");
    const row = await addSecondItem();
    const priceInput = row.querySelectorAll("input")[1] as HTMLInputElement;
    fireEvent.change(priceInput, { target: { value: "90" } });
    const callsBefore = mocks.linePriceCalls.length;

    fireEvent.change(within(control).getByRole("combobox") as HTMLSelectElement, {
      target: { value: "WHOLESALE" },
    });

    await waitFor(() => {
      expect(mocks.quoteInputs.at(-1)?.priceMode).toBe("WHOLESALE");
    });
    expect(priceInput.value).toBe("90");
    expect(mocks.linePriceCalls).toHaveLength(callsBefore);
    expect(mocks.quoteInputs.at(-1)?.additions).toEqual([
      {
        key: expect.any(String),
        productId: "product-2",
        variantId: null,
        qty: 1,
        unitPriceKgs: 90,
      },
    ]);
  });

  it("hides the control and states the limitation when price types are disabled", async () => {
    mocks.quote.retailWholesaleEnabled = false;
    renderPage();
    expect(await screen.findByTestId("correction-price-mode-disabled")).toBeTruthy();
    expect(screen.queryByTestId("correction-price-mode")).toBeNull();
  });

  it("renders the known quote warnings in the UI locale instead of the raw server text", async () => {
    mocks.quote.retailWholesaleEnabled = false;
    mocks.quote.openShifts = [];
    mocks.quote.warnings = [
      "Цены розница/опт не включены в настройках организации; новые товары получат обычную цену магазина.",
      "Нет открытой смены: корректировка с возвратом или доплатой недоступна до открытия смены.",
    ];
    try {
      renderPage("en");
      expect(
        (await screen.findAllByText(en.salesOrders.correctionPage.priceModeUnavailable)).length,
      ).toBeGreaterThan(0);
      expect(
        screen.getAllByText(en.salesOrders.correctionPage.noShift).length,
      ).toBeGreaterThan(0);
      expect(screen.queryByText(mocks.quote.warnings[0]!)).toBeNull();
      expect(screen.queryByText(mocks.quote.warnings[1]!)).toBeNull();
    } finally {
      mocks.quote.openShifts = [
        {
          id: "shift-1",
          registerId: "register-1",
          registerName: "Register 1",
          openedAt: new Date(),
        },
      ];
      mocks.quote.warnings = [];
    }
  });
});


describe("V2-03 correction repricing races", () => {
  const priceModeSelect = () =>
    screen
      .getAllByRole("combobox")
      .find((select) => select.querySelector('option[value="WHOLESALE"]')) as
      | HTMLSelectElement
      | undefined;

  it("preserves qty and manual price typed while repricing is in flight", async () => {
    renderPage();
    const row = await addSecondItem();
    mocks.deferLinePrice = true;
    const mode = priceModeSelect()!;
    fireEvent.change(mode, { target: { value: "WHOLESALE" } });
    expect(mocks.pendingLinePrices).toHaveLength(1);

    const inputs = row.querySelectorAll("input");
    fireEvent.change(inputs[0]!, { target: { value: "3" } });
    fireEvent.change(inputs[1]!, { target: { value: "95" } });
    mocks.pendingLinePrices[0]!.resolve({ hasConfiguredPrice: true, unitPriceKgs: 90 });
    await waitFor(() => {
      expect((inputs[0] as HTMLInputElement).value).toBe("3");
      expect((inputs[1] as HTMLInputElement).value).toBe("95");
    });
  });

  it("ignores an older mode response after a newer switch", async () => {
    renderPage();
    const row = await addSecondItem();
    mocks.deferLinePrice = true;
    const mode = priceModeSelect()!;
    fireEvent.change(mode, { target: { value: "WHOLESALE" } });
    fireEvent.change(mode, { target: { value: "RETAIL" } });
    expect(mocks.pendingLinePrices.length).toBeGreaterThanOrEqual(2);
    mocks.pendingLinePrices[0]!.resolve({ hasConfiguredPrice: true, unitPriceKgs: 90 });
    await waitFor(() => expect((row.querySelectorAll("input")[1] as HTMLInputElement).value).not.toBe("90"));
    mocks.pendingLinePrices[1]!.resolve({ hasConfiguredPrice: true, unitPriceKgs: 100 });
    await waitFor(() => expect((row.querySelectorAll("input")[1] as HTMLInputElement).value).toBe("100"));
  });

  it("reverts the mode and shows an error when repricing fails", async () => {
    renderPage();
    const row = await addSecondItem();
    mocks.deferLinePrice = true;
    const mode = priceModeSelect()!;
    fireEvent.change(mode, { target: { value: "WHOLESALE" } });
    expect(mocks.pendingLinePrices).toHaveLength(1);
    mocks.pendingLinePrices[0]!.reject(new Error("network"));
    await waitFor(() => expect(screen.getByTestId("correction-price-mode-error")).toBeTruthy());
    expect((priceModeSelect() as HTMLSelectElement).value).toBe("RETAIL");
    expect((screen.getByTestId("correction-confirm") as HTMLButtonElement).disabled).toBe(true);
    expect(row.querySelectorAll("input")[1]).toBeTruthy();
  });

  it("keeps a removed addition removed when a stale repricing response arrives", async () => {
    renderPage();
    const row = await addSecondItem();
    mocks.deferLinePrice = true;
    const mode = priceModeSelect()!;
    fireEvent.change(mode, { target: { value: "WHOLESALE" } });
    fireEvent.click(within(row).getByRole("button", { name: ru.salesOrders.correctionPage.remove }));
    expect(screen.queryByTestId("correction-addition-line")).toBeNull();
    mocks.pendingLinePrices[0]!.resolve({ hasConfiguredPrice: true, unitPriceKgs: 90 });
    await waitFor(() => expect(screen.queryByTestId("correction-addition-line")).toBeNull());
  });

  it("does not add a product while repricing is in flight", async () => {
    renderPage();
    await addSecondItem();
    mocks.deferLinePrice = true;
    const mode = priceModeSelect()!;
    fireEvent.change(mode, { target: { value: "WHOLESALE" } });
    expect(mocks.pendingLinePrices).toHaveLength(1);
    const callsBeforeAdd = mocks.linePriceCalls.length;

    fireEvent.click(screen.getByRole("button", { name: "resolve product" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.linePriceCalls).toHaveLength(callsBeforeAdd);
    expect(screen.getAllByTestId("correction-addition-line")).toHaveLength(1);

    mocks.pendingLinePrices[0]!.resolve({ hasConfiguredPrice: true, unitPriceKgs: 90 });
    await waitFor(() =>
      expect(screen.queryByText(ru.salesOrders.correctionPage.priceModeRepricing)).toBeNull(),
    );
  });
});
