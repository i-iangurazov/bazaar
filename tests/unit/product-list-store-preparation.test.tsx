// @vitest-environment jsdom

import React, { type AnchorHTMLAttributes, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "../../messages/en.json";
import kg from "../../messages/kg.json";
import ru from "../../messages/ru.json";

const mock = vi.hoisted(() => ({
  role: "ADMIN",
  mobile: false,
  sourceStoreId: "source-store" as string | null,
  inlineSaving: false,
  storePriceSaving: false,
  preview: vi.fn(),
  apply: vi.fn(),
  reconcile: vi.fn(),
  otherWrite: vi.fn(),
  invalidate: vi.fn(),
  refetch: vi.fn(),
  toast: vi.fn(),
  push: vi.fn(),
}));

const stores = [
  {
    id: "source-store",
    name: "Source shop",
    currencyCode: "KGS",
    currencyRateKgsPerUnit: 1,
    enableSku: true,
    enableBarcode: true,
  },
  {
    id: "target-store",
    name: "Target shop",
    currencyCode: "USD",
    currencyRateKgsPerUnit: 87,
    enableSku: true,
    enableBarcode: true,
  },
];

const product = (id: string, name: string, sku: string) => ({
  id,
  name,
  sku,
  createdAt: new Date("2026-11-09T00:00:00Z"),
  updatedAt: new Date("2026-11-10T00:00:00Z"),
  baseUnitId: "each",
  unit: "pcs",
  basePriceKgs: 120,
  effectivePriceKgs: 130,
  wholesalePriceKgs: 100,
  avgCostKgs: 80,
  onHandQty: 3,
  isBundle: false,
  isDeleted: false,
  hiddenInStore: false,
  category: null,
  categories: [],
  photoUrl: null,
  images: [],
  barcodes: [{ value: `barcode-${id}` }],
  inventorySnapshots: [{ storeId: "source-store", onHand: 3, variantId: null, version: 1 }],
});
const alpha = product("alpha", "Alpha product", "ALPHA-01");
const beta = product("beta", "Beta product", "BETA-02");
const hidden = { ...product("hidden", "Hidden product", "HIDDEN-03"), hiddenInStore: true };
const archived = { ...product("archived", "Archived product", "ARCHIVED-04"), isDeleted: true };
const products = [alpha, beta, hidden, archived];
const categories: string[] = [];
const catalog = { products };

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    status: "authenticated",
    data: { user: { id: "user", organizationId: "org", role: mock.role } },
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mock.push }),
  usePathname: () => "/products",
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: mock.toast }) }));
vi.mock("@/lib/useSse", () => ({ useSse: () => undefined }));
vi.mock("@/components/camera-scan-button", () => ({ CameraScanButton: () => null }));
vi.mock("@/components/products/product-duplicate-dialog", () => ({
  ProductDuplicateDialog: () => null,
}));
vi.mock("@/components/products/use-quick-product-duplicate", () => ({
  useQuickProductDuplicate: () => ({ duplicateProduct: mock.otherWrite, isLoading: false }),
}));

// JSDOM does not apply responsive CSS. Select the render branch here while
// retaining the actual page, table/cards, menu, inline cells and preparation dialog.
vi.mock("@/components/responsive-data-list", () => ({
  ResponsiveDataList: <T extends { id: string }>({
    items,
    renderDesktop,
    renderMobile,
  }: {
    items: T[];
    renderDesktop: (items: T[]) => ReactNode;
    renderMobile: (item: T) => ReactNode;
  }) => (
    <div data-testid="product-list">
      {mock.mobile
        ? items.map((item) => <div key={item.id}>{renderMobile(item)}</div>)
        : renderDesktop(items)}
    </div>
  ),
}));

vi.mock("@/lib/trpc", () => {
  const query = <T,>(data: T) => ({
    data,
    isLoading: false,
    isSuccess: true,
    error: null,
    refetch: mock.refetch,
  });
  const idle = () => ({
    mutate: mock.otherWrite,
    mutateAsync: mock.otherWrite,
    isLoading: false,
  });
  const cache = {
    invalidate: mock.invalidate,
    cancel: vi.fn(),
    getData: vi.fn(),
    setData: vi.fn(),
  };
  const utils = {
    products: {
      invalidate: mock.invalidate,
      bootstrap: cache,
      list: cache,
      byIds: cache,
    },
    inventory: { invalidate: mock.invalidate, list: cache, searchProducts: cache },
  };
  return {
    trpc: {
      useUtils: () => utils,
      billing: {
        features: { useQuery: () => query({ featureFlags: {}, access: { hasAccess: true } }) },
      },
      stores: {
        list: { useQuery: () => query(stores) },
        hardware: { useQuery: () => query(undefined) },
      },
      products: {
        listContext: {
          useQuery: () => query({ selectedStoreId: mock.sourceStoreId, stores, categories }),
        },
        bootstrap: {
          useQuery: () =>
            query({
              selectedStoreId: mock.sourceStoreId,
              list: {
                items: catalog.products,
                total: catalog.products.length,
                priceTypesEnabled: false,
              },
            }),
        },
        list: { useQuery: () => query({ items: [], total: 0 }) },
        byIds: { useQuery: () => query([]) },
        storePricing: {
          useQuery: () =>
            query({
              stores: stores.map((store) => ({ storeId: store.id, storeName: store.name })),
            }),
        },
        descriptionGenerationJob: { useQuery: () => query(undefined) },
        assignToStore: { useMutation: idle },
        setStoreVisibility: { useMutation: idle },
        archive: { useMutation: idle },
        restore: { useMutation: idle },
        inlineUpdate: { useMutation: () => ({ ...idle(), isLoading: mock.inlineSaving }) },
        bulkUpdateCategory: { useMutation: idle },
        arrangeClothingCategories: { useMutation: idle },
        bulkGenerateBarcodes: { useMutation: idle },
        startDescriptionGenerationJob: { useMutation: idle },
        retryDescriptionGenerationJobFailed: { useMutation: idle },
        previewStorePreparation: { useMutation: () => ({ mutateAsync: mock.preview }) },
        applyStorePreparation: { useMutation: () => ({ mutateAsync: mock.apply }) },
        reconcileStorePreparation: { useMutation: () => ({ mutateAsync: mock.reconcile }) },
      },
      storePrices: {
        upsert: { useMutation: () => ({ ...idle(), isLoading: mock.storePriceSaving }) },
        bulkUpdate: { useMutation: idle },
        previewDiscount: { useMutation: idle },
        applyDiscount: { useMutation: idle },
        removeDiscount: { useMutation: idle },
        discountVariants: { useQuery: () => query([]) },
      },
      inventory: { setOnHand: { useMutation: idle } },
      productCategories: { create: { useMutation: idle }, remove: { useMutation: idle } },
    },
  };
});

import ProductsPage from "@/app/(app)/products/page";
import { TooltipProvider } from "@/components/ui/tooltip";

const messages = { en, ru, kg };
type Locale = keyof typeof messages;
const originalScrollIntoView = Element.prototype.scrollIntoView;

function mount({
  locale = "en",
  view = "table",
}: { locale?: Locale; view?: "table" | "grid" } = {}) {
  history.replaceState(
    null,
    "",
    `/products?storeId=${mock.sourceStoreId ?? "all"}&archived=true&view=${view}`,
  );
  const page = () => (
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      <TooltipProvider>
        <ProductsPage />
      </TooltipProvider>
    </NextIntlClientProvider>
  );
  const result = render(page());
  return {
    ...result,
    refreshCatalog: () => {
      // A completed refetch returns new objects while retaining the product identities.
      catalog.products = products.map((item) => ({ ...item }));
      result.rerender(page());
    },
  };
}

function actionContainer(name: string, locale: Locale = "en") {
  let node = within(screen.getByTestId("product-list")).getByText(name, {
    exact: true,
  }).parentElement;
  while (node) {
    if (within(node).queryByRole("button", { name: messages[locale].common.tooltips.moreActions }))
      return node;
    node = node.parentElement;
  }
  throw new Error(`No row actions for ${name}`);
}

async function openPreparation(
  user: ReturnType<typeof userEvent.setup>,
  name = beta.name,
  locale: Locale = "en",
) {
  await user.click(
    within(actionContainer(name, locale)).getByRole("button", {
      name: messages[locale].common.tooltips.moreActions,
    }),
  );
  const action = await screen.findByRole("menuitem", {
    name: messages[locale].products.prepareInStores,
  });
  expect(action.querySelector("svg")).not.toBeNull();
  await user.click(action);
  return screen.findByRole("dialog", { name: messages[locale].productPreparation.title });
}

function expectNoWrites() {
  expect(mock.apply).not.toHaveBeenCalled();
  expect(mock.reconcile).not.toHaveBeenCalled();
  expect(mock.otherWrite).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  mock.role = "ADMIN";
  mock.mobile = false;
  mock.sourceStoreId = "source-store";
  mock.inlineSaving = false;
  mock.storePriceSaving = false;
  catalog.products = products;
  mock.invalidate.mockResolvedValue(undefined);
  mock.preview.mockImplementation(async (change) => ({
    token: "review-token",
    productSku: products.find((item) => item.id === change.productId)?.sku,
    unit: "pcs",
    additions: 1,
    restorations: 0,
    priceChanges: 0,
    canApply: true,
    rows: [
      {
        storeId: "target-store",
        storeName: "Target shop",
        onHand: 0,
        add: true,
        hidden: false,
        restore: false,
        blocked: null,
        prices: [],
      },
    ],
  }));
  mock.apply.mockResolvedValue({ additions: 1, priceChanges: 0 });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  // Only the selected responsive branch is mounted; JSDOM needs its visible geometry supplied.
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (this: Element) {
    return (this.isConnected ? [new DOMRect(0, 0, 40, 40)] : []) as unknown as DOMRectList;
  });
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Element.prototype.scrollIntoView = originalScrollIntoView;
  history.replaceState(null, "", "/");
});

describe("product list store preparation", () => {
  it.each([
    { view: "table" as const, mobile: false },
    { view: "grid" as const, mobile: false },
    { view: "table" as const, mobile: true },
  ])(
    "opens the exact row from More in $view mobile=$mobile and writes only after review",
    async ({ view, mobile }) => {
      mock.mobile = mobile;
      const user = userEvent.setup();
      const page = mount({ view });
      const launcher = within(actionContainer(beta.name)).getByRole("button", {
        name: en.common.tooltips.moreActions,
      });
      const dialog = await openPreparation(user);
      expect(within(dialog).getByText("Beta product · BETA-02")).toBeTruthy();
      expect(within(dialog).getByText("Source shop")).toBeTruthy();
      expect(within(dialog).queryByRole("checkbox", { name: "Source shop" })).toBeNull();
      expect(
        within(dialog)
          .getByRole("checkbox", { name: en.productPreparation.add })
          .getAttribute("aria-checked"),
      ).toBe("true");
      expect(
        within(dialog).queryByRole("button", { name: en.productPreparation.apply }),
      ).toBeNull();
      expect(mock.preview).not.toHaveBeenCalled();
      expectNoWrites();
      await user.click(within(dialog).getByRole("checkbox", { name: "Target shop" }));
      expectNoWrites();
      await user.click(within(dialog).getByRole("button", { name: en.productPreparation.preview }));
      await within(dialog).findByRole("region", { name: en.productPreparation.preview });
      expect(mock.preview).toHaveBeenCalledWith({
        productId: beta.id,
        sourceStoreId: "source-store",
        targetStoreIds: ["target-store"],
        addToAssortment: true,
        restoreStoreIds: undefined,
        prices: "NONE",
      });
      expectNoWrites();
      await user.click(within(dialog).getByRole("button", { name: en.productPreparation.apply }));
      await within(dialog).findByText(en.productPreparation.success);
      expect(mock.apply).toHaveBeenCalledWith({
        change: mock.preview.mock.calls[0][0],
        token: "review-token",
        idempotencyKey: expect.any(String),
      });
      expect(mock.invalidate).toHaveBeenCalledTimes(2);
      expect(sessionStorage.length).toBe(0);
      expect(mock.otherWrite).not.toHaveBeenCalled();
      expect(mock.push).not.toHaveBeenCalled();
      page.refreshCatalog();
      await user.click(within(dialog).getByText(en.common.close, { selector: "button" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      const currentLauncher = within(actionContainer(beta.name)).getByRole("button", {
        name: en.common.tooltips.moreActions,
      });
      if (!mobile && view === "table") expect(launcher.isConnected).toBe(false);
      await waitFor(() => expect(document.activeElement).toBe(currentLauncher));
      await user.keyboard("{Enter}");
      expect(
        await screen.findByRole("menuitem", { name: en.products.prepareInStores }),
      ).toBeTruthy();
    },
  );

  it.each([false, true])(
    "returns Escape focus to the originating row after a catalog refresh on mobile=%s",
    async (mobile) => {
      mock.mobile = mobile;
      const user = userEvent.setup();
      const page = mount();
      const launcher = within(actionContainer(beta.name)).getByRole("button", {
        name: en.common.tooltips.moreActions,
      });
      const dialog = await openPreparation(user);
      await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
      page.refreshCatalog();
      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      const currentLauncher = within(actionContainer(beta.name)).getByRole("button", {
        name: en.common.tooltips.moreActions,
      });
      if (!mobile) expect(launcher.isConnected).toBe(false);
      await waitFor(() => expect(document.activeElement).toBe(currentLauncher));
      await user.keyboard("{Enter}");
      expect(
        await screen.findByRole("menuitem", { name: en.products.prepareInStores }),
      ).toBeTruthy();
      expect(mock.preview).not.toHaveBeenCalled();
      expectNoWrites();
    },
  );

  it("leaves the source unselected in All stores and requires an explicit source to copy prices", async () => {
    mock.sourceStoreId = null;
    const user = userEvent.setup();
    mount();
    const dialog = await openPreparation(user);
    expect(within(dialog).getByRole("checkbox", { name: "Source shop" })).toBeTruthy();
    await user.click(within(dialog).getByRole("checkbox", { name: "Target shop" }));
    fireEvent.keyDown(
      within(dialog).getByRole("combobox", { name: en.productPreparation.prices }),
      { key: "Enter" },
    );
    fireEvent.click(await screen.findByRole("option", { name: en.productPreparation.missing }));
    const source = within(dialog).getByRole("combobox", { name: en.productPreparation.source });
    expect(source.textContent).toBe(en.productPreparation.chooseSource);
    const preview = within(dialog).getByRole("button", { name: en.productPreparation.preview });
    expect((preview as HTMLButtonElement).disabled).toBe(true);
    await user.click(preview);
    expect(mock.preview).not.toHaveBeenCalled();
    expectNoWrites();
    fireEvent.keyDown(source, { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: "Source shop" }));
    await user.click(preview);
    await waitFor(() =>
      expect(mock.preview).toHaveBeenCalledWith({
        productId: beta.id,
        sourceStoreId: "source-store",
        targetStoreIds: ["target-store"],
        addToAssortment: true,
        restoreStoreIds: undefined,
        prices: "MISSING",
      }),
    );
    expectNoWrites();
  });

  it("clears a reviewed selection on close and opens another product with its own identity", async () => {
    const user = userEvent.setup();
    mount();
    let dialog = await openPreparation(user);
    await user.click(within(dialog).getByRole("checkbox", { name: "Target shop" }));
    await user.click(within(dialog).getByRole("button", { name: en.productPreparation.preview }));
    await within(dialog).findByRole("region", { name: en.productPreparation.preview });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    dialog = await openPreparation(user, alpha.name);
    expect(within(dialog).getByText("Alpha product · ALPHA-01")).toBeTruthy();
    expect(
      within(dialog).getByRole("checkbox", { name: "Target shop" }).getAttribute("aria-checked"),
    ).toBe("false");
    expect(
      within(dialog).queryByRole("region", { name: en.productPreparation.preview }),
    ).toBeNull();
    expect(within(dialog).queryByRole("button", { name: en.productPreparation.apply })).toBeNull();
    expect(
      (
        within(dialog).getByRole("button", {
          name: en.productPreparation.preview,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expectNoWrites();
  });

  it.each(["ru", "kg", "en"] as const)(
    "gives managers a localized %s entry without changing product navigation",
    async (locale) => {
      mock.role = "MANAGER";
      const user = userEvent.setup();
      mount({ locale });
      const dialog = await openPreparation(user, beta.name, locale);
      expect(
        within(dialog).getByText(messages[locale].productPreparation.identityHint),
      ).toBeTruthy();
      expect(mock.push).not.toHaveBeenCalled();
      expectNoWrites();
    },
  );

  it.each([false, true])("keeps the entry unavailable to staff on mobile=%s", (mobile) => {
    mock.role = "STAFF";
    mock.mobile = mobile;
    mount();
    const list = within(screen.getByTestId("product-list"));
    expect(list.queryByRole("button", { name: en.common.tooltips.moreActions })).toBeNull();
    expect(list.queryByText(en.products.prepareInStores)).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expectNoWrites();
  });

  it("preserves the separate recovery actions for hidden and archived rows", async () => {
    const user = userEvent.setup();
    mount();
    for (const item of [hidden, archived]) {
      const row = actionContainer(item.name);
      expect(
        within(row).getByRole("button", {
          name: item.hiddenInStore ? en.products.showInStore : en.products.restore,
        }),
      ).toBeTruthy();
      await user.click(within(row).getByRole("button", { name: en.common.tooltips.moreActions }));
      await screen.findByRole("menuitem", { name: en.products.deletePermanent });
      expect(screen.queryByRole("menuitem", { name: en.products.prepareInStores })).toBeNull();
      await user.keyboard("{Escape}");
    }
    expectNoWrites();
  });

  it.each(["inlineSaving", "storePriceSaving"] as const)(
    "does not open preparation while %s is pending",
    async (saving) => {
      mock[saving] = true;
      const user = userEvent.setup();
      mount();
      await user.click(
        within(actionContainer(beta.name)).getByRole("button", {
          name: en.common.tooltips.moreActions,
        }),
      );
      const action = await screen.findByRole("menuitem", { name: en.products.prepareInStores });
      expect(action.getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(action);
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(mock.preview).not.toHaveBeenCalled();
      expectNoWrites();
    },
  );
});
