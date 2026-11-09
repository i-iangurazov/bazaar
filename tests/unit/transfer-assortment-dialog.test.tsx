// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import ru from "../../messages/ru.json";
import { transferAssortmentPreparationSchema } from "@/lib/transferAssortmentPreparation";
const mock = vi.hoisted(() => ({
  options: vi.fn(),
  preview: vi.fn(),
  apply: vi.fn(),
  reconcile: vi.fn(),
  invalid: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "user", organizationId: "org" } } }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      inventory: { invalidate: mock.invalid },
      products: { invalidate: mock.invalid },
      stores: { invalidate: mock.invalid },
    }),
    inventory: {
      transferAssortmentOptions: { useMutation: () => ({ mutateAsync: mock.options }) },
      previewTransferAssortment: { useMutation: () => ({ mutateAsync: mock.preview }) },
      applyTransferAssortment: { useMutation: () => ({ mutateAsync: mock.apply }) },
      reconcileTransferAssortment: { useMutation: () => ({ mutateAsync: mock.reconcile }) },
    },
  },
}));
import { TransferAssortmentDialog } from "@/components/inventory/transfer-assortment-dialog";
import {
  saveTransferPreparationPending,
  transferPreparationPendingKey,
} from "@/lib/transferPreparationPending";
const change = {
  fromStoreId: "warehouse",
  toStoreId: "shop",
  selections: [{ productId: "p", sourceKey: "store:warehouse" }],
  lines: [{ productId: "p", variantId: null }],
  prices: "MISSING" as const,
};
const onApplied = vi.fn();
function mount(override: Partial<Parameters<typeof TransferAssortmentDialog>[0]> = {}) {
  return render(
    <NextIntlClientProvider
      locale="ru"
      messages={{ inventory: ru.inventory, common: ru.common, errors: ru.errors }}
    >
      <TransferAssortmentDialog
        open
        fromStoreId="warehouse"
        storeId="shop"
        productIds={["p"]}
        lines={[{ productId: "p" }]}
        onOpenChange={() => {}}
        onApplied={onApplied}
        {...override}
      />
    </NextIntlClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  mock.options.mockResolvedValue({
    pricingAllowed: true,
    sourceName: "Warehouse",
    products: [
      {
        id: "p",
        name: "Test product",
        sku: "SKU",
        hidden: false,
        available: false,
        sources: [{ key: "store:warehouse", name: "Warehouse" }],
      },
    ],
  });
  mock.preview.mockResolvedValue({
    added: 1,
    priceChanges: 1,
    token: "preview",
    retailWholesaleEnabled: true,
    rows: [
      {
        productId: "p",
        name: "Test product",
        sku: "SKU",
        variantKey: "BASE",
        variantName: null,
        source: { retail: "120", wholesale: "90" },
        before: { retail: null, wholesale: null },
        after: { retail: "120", wholesale: "90" },
        reasons: { retail: "copy", wholesale: "copy" },
      },
    ],
  });
  mock.apply.mockResolvedValue({ added: 1, priceChanges: 1, productIds: ["p"] });
});
afterEach(cleanup);
describe("reviewed transfer dialog", () => {
  it("reviews exact rows and stores the request before sending; success refreshes the flow", async () => {
    mock.apply.mockImplementation(async () => {
      expect(sessionStorage.length).toBe(1);
      return { added: 1, priceChanges: 1 };
    });
    mount();
    await screen.findByText("Test product");
    fireEvent.click(screen.getByRole("button", { name: ru.inventory.transferSafety.preview }));
    await screen.findByLabelText(ru.inventory.transferSafety.priceReview);
    expect(mock.preview).toHaveBeenCalledWith(change);
    expect(screen.getByLabelText(ru.inventory.transferSafety.selectedSources).textContent).toBe(
      "Warehouse: 1 товар",
    );
    expect(screen.getAllByText(/120.*KGS/)).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: ru.inventory.transferSafety.connect }));
    await waitFor(() => expect(onApplied).toHaveBeenCalledOnce());
    expect(sessionStorage.length).toBe(0);
  });
  it("allows assortment without copying prices", async () => {
    mount();
    await screen.findByText("Test product");
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.click(screen.getByRole("button", { name: ru.inventory.transferSafety.preview }));
    await waitFor(() => expect(mock.preview).toHaveBeenCalledWith({ ...change, prices: "NONE" }));
  });
  it("recovers the server receipt after a lost response instead of assuming availability means prices succeeded", async () => {
    mock.apply.mockRejectedValue(new Error("network lost"));
    mock.reconcile.mockResolvedValue({ status: "APPLIED", added: 1, priceChanges: 1 });
    mount();
    await screen.findByText("Test product");
    fireEvent.click(screen.getByRole("button", { name: ru.inventory.transferSafety.preview }));
    await screen.findByLabelText(ru.inventory.transferSafety.priceReview);
    fireEvent.click(screen.getByRole("button", { name: ru.inventory.transferSafety.connect }));
    await screen.findByText(ru.inventory.transferSafety.uncertain);
    expect(onApplied).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: ru.inventory.transferSafety.check }));
    await waitFor(() => expect(onApplied).toHaveBeenCalledOnce());
    expect(mock.reconcile).toHaveBeenCalledOnce();
    expect(mock.apply).toHaveBeenCalledOnce();
  });
  it("restores a pending request after reloading and closes an uncommitted attempt before another preview", async () => {
    saveTransferPreparationPending(
      sessionStorage,
      transferPreparationPendingKey("org", "user", "warehouse", "shop"),
      { change, token: "preview", idempotencyKey: "restored-request" },
    );
    mock.reconcile.mockResolvedValue({ status: "CANCELED" });
    mount();
    await screen.findByText(ru.inventory.transferSafety.uncertain);
    fireEvent.click(screen.getByRole("button", { name: ru.inventory.transferSafety.check }));
    await waitFor(() => expect(sessionStorage.length).toBe(0));
    expect(onApplied).not.toHaveBeenCalled();
    expect(mock.reconcile).toHaveBeenCalledWith({
      change,
      token: "preview",
      idempotencyKey: "restored-request",
    });
    expect(
      await screen.findByRole("button", { name: ru.inventory.transferSafety.preview }),
    ).toBeTruthy();
  });
  it("projects real document fields to strict product/variant rows and removes duplicates before preview and apply", async () => {
    const line = {
      productId: "p",
      variantId: null,
      id: "movement",
      productName: "Test product",
      qtyDelta: -3,
      authorEmail: "synthetic@example.test",
      createdAt: new Date(),
    };
    const response = await mock.preview();
    mock.preview.mockClear();
    mock.preview.mockImplementation(async (input) => {
      transferAssortmentPreparationSchema.parse(input);
      return response;
    });
    mount({ posted: true, lines: [line, line, { ...line, variantId: "variant" }] });
    await screen.findByText("Test product");
    expect(screen.getByText(ru.inventory.transferSafety.postedPreparationHint)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: ru.inventory.transferSafety.preview }));
    await screen.findByLabelText(ru.inventory.transferSafety.priceReview);
    const expected = {
      ...change,
      lines: [change.lines[0], { productId: "p", variantId: "variant" }],
    };
    expect(mock.preview).toHaveBeenCalledOnce();
    expect(mock.preview).toHaveBeenCalledWith(expected);
    fireEvent.click(screen.getByRole("button", { name: ru.inventory.transferSafety.connect }));
    await waitFor(() => expect(onApplied).toHaveBeenCalledOnce());
    expect(mock.apply.mock.calls[0][0].change).toEqual(expected);
  });
  it("selects all 40 eligible rows, excludes blocked rows and supports partial/clear selection", async () => {
    const products = Array.from({ length: 40 }, (_, i) => ({
      id: `p${i}`,
      name: `Product ${i + 1}`,
      sku: `SKU-${i + 1}`,
      available: false,
      hidden: false,
      sources: [
        { key: "store:origin", name: "Origin" },
        { key: "catalog:shared", name: "Shared" },
      ],
    }));
    const blocked = [
      { ...products[0], id: "available", name: "Already available", available: true },
      { ...products[0], id: "hidden", name: "Hidden", hidden: true },
      { ...products[0], id: "no-source", name: "No source", sources: [] },
    ];
    mock.options.mockResolvedValue({
      pricingAllowed: true,
      sourceName: "Warehouse",
      products: [...products, ...blocked],
    });
    mount({
      productIds: [...products, ...blocked].map((p) => p.id),
      lines: products.map((p) => ({ productId: p.id })),
    });
    await screen.findByText("Product 40");
    fireEvent.click(screen.getByRole("button", { name: ru.inventory.transferSafety.selectAll }));
    expect(screen.getByText("Выбрано 40 из 40 доступных товаров")).toBeTruthy();
    expect(
      screen.getByText(
        "У 40 товаров несколько исходных каталогов. Проверьте выбранные источники в строках перед подключением.",
      ),
    ).toBeTruthy();
    for (const name of ["Already available", "Hidden", "No source"]) {
      const checkbox = screen.getByRole("checkbox", { name: new RegExp(name) });
      expect(checkbox.getAttribute("aria-checked")).toBe("false");
      expect(checkbox.getAttribute("data-disabled")).not.toBeNull();
    }
    fireEvent.click(screen.getByRole("checkbox", { name: /^Product 1 SKU-1$/ }));
    expect(screen.getByText("Выбрано 39 из 40 доступных товаров")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: ru.inventory.transferSafety.preview }));
    await waitFor(() => expect(mock.preview).toHaveBeenCalledOnce());
    expect(mock.preview.mock.calls[0][0].selections).toHaveLength(39);
    expect(mock.preview.mock.calls[0][0].lines).toHaveLength(39);
    expect(
      mock.preview.mock.calls[0][0].selections.some(
        (p: { productId: string }) => p.productId === "p0",
      ),
    ).toBe(false);
    expect(
      screen.getByLabelText(ru.inventory.transferSafety.selectedSources).textContent,
    ).toContain("Origin: 39 товаров");
    fireEvent.click(
      screen.getByRole("button", { name: ru.inventory.transferSafety.clearSelection }),
    );
    expect(screen.getByText("Выбрано 0 из 40 доступных товаров")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: ru.inventory.transferSafety.preview,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(mock.apply).not.toHaveBeenCalled();
  });
  it("shows one actual error and retains selection for a safe preview retry", async () => {
    mock.preview.mockRejectedValueOnce(
      Object.assign(new Error("invalidInput"), { data: { code: "BAD_REQUEST" } }),
    );
    mount();
    await screen.findByText("Test product");
    fireEvent.click(screen.getByRole("button", { name: ru.inventory.transferSafety.preview }));
    await screen.findByText(ru.errors.invalidInput);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByText(ru.errors.genericMessage)).toBeNull();
    expect(
      screen.getByRole("checkbox", { name: /Test product/ }).getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: ru.common.tryAgain }));
    await screen.findByLabelText(ru.inventory.transferSafety.priceReview);
    expect(mock.preview).toHaveBeenCalledTimes(2);
    expect(mock.preview.mock.calls[0][0]).toEqual(mock.preview.mock.calls[1][0]);
    expect(mock.apply).not.toHaveBeenCalled();
  });
  it("refreshes options after a stale preview and removes newly unavailable selections", async () => {
    mock.preview.mockRejectedValueOnce(
      Object.assign(new Error("transferPreparationStale"), { data: { code: "CONFLICT" } }),
    );
    mount();
    await screen.findByText("Test product");
    fireEvent.click(screen.getByRole("button", { name: ru.inventory.transferSafety.preview }));
    await screen.findByRole("alert");
    mock.options.mockResolvedValue({
      pricingAllowed: false,
      sourceName: "Warehouse",
      products: [
        {
          id: "p",
          name: "Test product",
          sku: "SKU",
          hidden: true,
          available: false,
          sources: [{ key: "store:warehouse", name: "Warehouse" }],
        },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: ru.common.tryAgain }));
    await screen.findByText(ru.inventory.transferSafety.hiddenHint);
    expect(screen.getByText("Выбрано 0 из 0 доступных товаров")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: ru.inventory.transferSafety.preview,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(mock.preview).toHaveBeenCalledOnce();
    expect(mock.apply).not.toHaveBeenCalled();
  });
});
