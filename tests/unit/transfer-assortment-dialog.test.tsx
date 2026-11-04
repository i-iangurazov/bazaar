// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import ru from "../../messages/ru.json";
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
  lines: [{ productId: "p" }],
  prices: "MISSING" as const,
};
const onApplied = vi.fn();
function mount() {
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
});
