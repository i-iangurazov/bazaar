// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InventoryReceivingPage } from "@/components/inventory/receiving-workflow";
import { writeReceivingPending } from "@/components/inventory/receiving-draft-storage";
import ru from "../../messages/ru.json";

const api = vi.hoisted(() => {
  const preview = vi.fn();
  const invalidate = vi.fn().mockResolvedValue(undefined);
  const query = { data: undefined, isLoading: false, isFetching: false, error: null };
  const store = { id: "store-one", name: "Test store", currencyCode: "KGS", currencyRateKgsPerUnit: 1 };
  const product = { id: "product-one", name: "Known batch item", sku: "KNOWN", unit: "pcs" };
  const search = [{ product, snapshot: { variantId: null, onHand: 10 }, variant: null,
    primaryBarcode: null, unitCostKgs: 100, priceKgs: 350 }];
  const utils = {
    get stores() { return { get list() { return { invalidate }; } }; },
    inventory: { searchProducts: { invalidate, fetch: vi.fn().mockResolvedValue(search) } },
  };
  return { preview, invalidate, query, stores: [store], search, utils,
    session: { user: { id: "user-one", organizationId: "org-one", role: "ADMIN" } },
    router: { push: vi.fn() }, toast: vi.fn(), mutate: vi.fn() };
});
vi.mock("next/navigation", () => ({ useRouter: () => api.router, useSearchParams: () => new URLSearchParams() }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: api.session, status: "authenticated" }) }));
vi.mock("@/lib/useSse", () => ({ useSse: () => undefined }));
vi.mock("@/lib/use-debounced-value", () => ({ useDebouncedValue: (value: unknown) => value }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: api.toast }) }));
vi.mock("@/components/page-header", () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock("@/components/inventory/inventory-line-presentation", () => ({
  InventoryLinePresentationNotice: () => null, InventoryProductThumbnail: () => <span />,
}));
vi.mock("@/components/inventory/use-inventory-line-presentation", () => ({
  useInventoryLinePresentation: () => ({ isError: false, refetch: api.invalidate,
    getPresentation: () => ({ sku: "KNOWN", barcode: null, imageUrl: null }) }),
}));
vi.mock("@/lib/trpc", () => ({ trpc: {
  useUtils: () => api.utils,
  stores: { list: { useQuery: () => ({ ...api.query, data: api.stores }) } },
  inventory: {
    editableProductMovementDocument: { useQuery: () => api.query },
    searchProducts: { useQuery: () => ({ ...api.query, data: api.search }) },
    previewStockReceiving: { useMutation: () => ({ mutateAsync: api.preview }) },
    postReviewedStockReceiving: { useMutation: () => ({ isLoading: false, mutate: api.mutate }) },
    reconcileStockReceivingAttempt: { useMutation: () => ({ isLoading: false, mutate: api.mutate }) },
    editProductMovementDocument: { useMutation: () => ({ isLoading: false, mutate: api.mutate }) },
  },
} }));

afterEach(() => { cleanup(); sessionStorage.clear(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe("receiving workflow preview lifecycle", () => {
  it("adds and edits a real receiving row without an update loop when tRPC property proxies change identity", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    Element.prototype.scrollIntoView = vi.fn();
    expect(api.utils.stores.list).not.toBe(api.utils.stores.list);
    api.preview.mockImplementation(async input => ({ token: "review-token", expiresAt: new Date(Date.now() + 900_000).toISOString(),
      currencyCode: "KGS", currencyRateKgsPerUnit: 1, pricingAllowed: true, retailWholesaleEnabled: true,
      lines: input.lines.map((line: { productId: string; quantity: number; unitCost: number }) => ({
        productId: line.productId, variantId: null, unitId: "pcs", unitLabel: "pcs", currentSalePriceKgs: 350,
        sharedRetail: false, changesSalePrice: false, valuation: {
          current: { quantity: 10, unitCostKgs: 100, status: "KNOWN", reason: null },
          projected: { quantity: 10 + line.quantity, unitCostKgs: 150, status: "KNOWN", reason: null },
        },
      })),
    }));
    const view = render(<NextIntlClientProvider locale="ru" timeZone="Asia/Bishkek"
      messages={{ inventory: ru.inventory, common: ru.common, errors: ru.errors }}>
      <InventoryReceivingPage draftOwner={{ userId: "user-one", organizationId: "org-one" }} />
    </NextIntlClientProvider>);
    await waitFor(() => expect(view.container.querySelector('#receiving-store')?.textContent).toContain("Test store"));
    fireEvent.click(screen.getByRole("button", { name: /Known batch item/ }));
    await waitFor(() => expect(view.container.querySelector('[data-receiving-line-row]')).toBeTruthy());
    fireEvent.change(view.container.querySelector('[data-receiving-input="quantity"]')!, { target: { value: "10" } });
    fireEvent.change(view.container.querySelector('[data-receiving-input="unitCost"]')!, { target: { value: "200" } });
    await waitFor(() => expect(view.container.querySelectorAll('[data-receiving-cost-state="KNOWN"]')).toHaveLength(2), { timeout: 2_000 });
    expect(api.preview).toHaveBeenCalledTimes(1);
    expect(api.preview.mock.calls[0][0].lines).toEqual([{ productId: "product-one", variantId: null, quantity: 10, unitCost: 200 }]);
    fireEvent.change(view.container.querySelector('[data-receiving-input="salePrice"]')!, { target: { value: "450" } });
    await waitFor(() => expect(api.preview).toHaveBeenCalledTimes(2), { timeout: 2_000 });
    await waitFor(() => expect(view.container.querySelectorAll('[data-receiving-cost-state="KNOWN"]')).toHaveLength(2));
    expect(api.preview.mock.calls[1][0].lines[0].salePriceKgs).toBe(450);
    expect(api.mutate).not.toHaveBeenCalled();
  });

  it("restores a frozen pending request with a check action, no preview request and no perpetual checking spinner", async () => {
    const owner = { userId: "user-one", organizationId: "org-one", storeId: "store-one" };
    expect(writeReceivingPending(owner, {
      request: { idempotencyKey: "pending-attempt-one", token: "frozen-review-token", receiving: {
        storeId: owner.storeId,
        lines: [{ productId: "product-one", variantId: null, quantity: 10, unitCost: 200, salePriceKgs: 450 }],
      } },
      draft: { storeId: owner.storeId, dateTime: "2026-11-10T14:00", supplierName: "", referenceNumber: "", note: "", search: "",
        currencyCode: "KGS", currencyRateKgsPerUnit: 1,
        lines: [{ key: "product-one:BASE", productId: "product-one", variantId: null, productName: "Known batch item", variantName: null,
          sku: "KNOWN", barcode: null, imageUrl: null, currentStock: 10, quantityInput: "10", unitCostInput: "200", salePriceInput: "450" }],
      },
    })).toBe(true);
    const view = render(<NextIntlClientProvider locale="ru" timeZone="Asia/Bishkek"
      messages={{ inventory: ru.inventory, common: ru.common, errors: ru.errors }}>
      <InventoryReceivingPage draftOwner={{ userId: owner.userId, organizationId: owner.organizationId }} />
    </NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByRole("button", { name: ru.inventory.receivingRecovery.check })).toBeTruthy());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 400)); });
    expect(api.preview).not.toHaveBeenCalled();
    const commerce = view.container.querySelector('[data-receiving-commerce-line]')!;
    expect(commerce.textContent).not.toContain(ru.inventory.receivingPricing.checking);
    expect(commerce.querySelectorAll('[data-receiving-cost-state="UNKNOWN"]')).toHaveLength(2);
    expect(commerce.querySelector('label')?.textContent).toBe("Новая цена продажи · KGS");
    expect(commerce.querySelector('input')?.disabled).toBe(true);
    expect(api.mutate).not.toHaveBeenCalled();
  });
});
