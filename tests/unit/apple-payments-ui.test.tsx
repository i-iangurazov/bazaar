// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ru from "../../messages/ru.json";
import kg from "../../messages/kg.json";
import en from "../../messages/en.json";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ApplePayments } from "@/components/billing/apple-payments";
import { SubscriptionPayments } from "@/components/billing/subscription-payments";

const mock = vi.hoisted(() => ({
  platform: "ios",
  nativeReady: true,
  session: { user: { id: "synthetic-buyer", organizationId: "synthetic-organization", role: "ADMIN" } },
  data: {} as Record<string, unknown>,
  products: vi.fn(),
  storefront: vi.fn(),
  temporaryData: {} as Record<string, unknown>,
  temporaryPreview: vi.fn(),
  temporaryRequest: vi.fn(),
  temporaryRefetch: vi.fn(),
  temporaryCatalogRefetch: vi.fn(),
  temporaryError: null as unknown,
  temporaryFetching: false,
  intent: vi.fn(),
  confirm: vi.fn(),
  restoreBatch: vi.fn(),
  cancel: vi.fn(),
  consumptionConsent: vi.fn(),
  purchase: vi.fn(),
  finish: vi.fn(),
  restore: vi.fn(),
  retryCompletions: vi.fn(),
  history: vi.fn(),
  manage: vi.fn(),
  refund: vi.fn(),
  refetch: vi.fn(),
  updated: vi.fn(),
  webGet: vi.fn(),
}));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: mock.session, status: "authenticated" }) }));
vi.mock("@/lib/native/platform", () => ({ getNativePlatform: () => mock.platform }));
vi.mock("@/lib/native/appleBilling", () => ({
  isAppleBillingAvailable: () => mock.nativeReady,
  getAppleProducts: mock.products,
  getAppleStorefront: mock.storefront,
  purchaseAppleProduct: mock.purchase,
  finishAppleTransaction: mock.finish,
  restoreApplePurchases: mock.restore,
  retryAppleCompletions: mock.retryCompletions,
  getAppleTransactionHistory: mock.history,
  showAppleSubscriptionManagement: mock.manage,
  requestAppleRefund: mock.refund,
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    billing: {
      apple: {
        temporaryUpgradeCatalog: {
          useQuery: () => ({ data: mock.temporaryData, isLoading: false, isError: false, refetch: mock.temporaryCatalogRefetch }),
        },
        previewTemporaryUpgrade: {
          useQuery: (input: TemporaryRequest, options: { enabled: boolean }) => {
            mock.temporaryRequest(input, options);
            return { data: options.enabled && !mock.temporaryError ? mock.temporaryPreview(input) : undefined,
              isFetching: options.enabled && mock.temporaryFetching,
              isError: options.enabled && Boolean(mock.temporaryError), error: mock.temporaryError, refetch: mock.temporaryRefetch };
          },
        },
        preview: {
          useQuery: () => ({
            data: {
              quoteToken: "signed-preview-token",
              timing: { startsAt: "2027-02-01T00:00:00Z", endsAt: "2027-03-01T00:00:00Z" },
            },
            isFetching: false,
            isError: false,
            refetch: mock.refetch,
          }),
        },
        catalog: {
          useQuery: () => ({
            data: mock.data,
            isLoading: false,
            isError: false,
            refetch: mock.refetch,
          }),
        },
        intent: { useMutation: () => ({ mutateAsync: mock.intent }) },
        confirm: { useMutation: () => ({ mutateAsync: mock.confirm }) },
        restore: { useMutation: () => ({ mutateAsync: mock.restoreBatch }) },
        cancelIntent: { useMutation: () => ({ mutateAsync: mock.cancel }) },
        consumptionConsent: { useMutation: () => ({ mutateAsync: mock.consumptionConsent }) },
      },
      payments: { get: { useQuery: mock.webGet } },
    },
  },
}));
const receipt = (transactionId = "9007199254740993123") => ({
  transactionId,
  productId: "kg.bazaar.test.month",
  signedTransactionInfo: `signed.${transactionId}.receipt`,
});
const product = {
  id: "kg.bazaar.test.month",
  displayName: "Bazaar StoreKit plan",
  description: "Apple product description",
  displayPrice: "$19.99",
  price: "19.99",
  currencyCode: "USD",
  type: "NON_RENEWING",
};
const offer = () => ({
  kind: "SUBSCRIPTION",
  offerKey: "business-contract-offer",
  productId: product.id,
  productType: "NON_RENEWING",
  selection: { plan: "STARTER", months: 1, extras: { stores: 0, productPacks: 0, userPacks: 0 } },
  available: true,
  availableActions: ["RENEW"],
  unavailableReason: null,
  renewUnavailableReason: null,
  changeUnavailableReason: "appleChangeRequiresAppleSubscription",
  serviceValue: { currency: "KGS", amountMinor: 200000 },
  entitlements: { limits: { maxStores: 1, maxProducts: 1000, maxActiveUsers: 2 } },
});
const fixture = () => ({
  ready: true,
  environment: "Production",
  organization: { id: "synthetic-organization", name: "Synthetic organization" },
  offers: [offer()],
  termsVersion: "test-terms",
  termsUrl: "https://example.invalid/terms",
  pendingIntent: null,
  recentTransactions: [] as unknown[],
  temporaryUpgrades: [] as unknown[],
  access: {
    plan: "STARTER",
    extras: { stores: 0, productPacks: 0, userPacks: 0 },
    source: "GATEWAY",
    lifetimeAccess: false,
    paidUntil: null as string | null,
    trialUntil: null,
    appleAutoRenew: false,
    appleIssue: null as string | null,
    appleScheduledChange: null as { productId: string; startsAt: string | null; offer: unknown } | null,
  },
});
type TemporaryRequest = {
  expectedOrganizationId: string;
  selection: { plan: string; months: number; extras: { stores: number; productPacks: number; userPacks: number } };
  storefrontId: string;
  currency: string;
};
const temporaryProduct = {
  ...product, id: "kg.bazaar.testing.temporary", displayName: "Temporary plan upgrade",
  displayPrice: "$2.99", price: "2.99", priceMillis: "2990", storefrontId: "123456",
};
const temporaryCatalogFixture = (ready = false) => ({
  ready, unavailableReason: ready ? null : "appleTemporaryUpgradePolicyUnavailable", policyVersion: "synthetic-policy",
  organization: { id: "synthetic-organization", name: "Synthetic organization" },
  currentSelection: { plan: "STARTER", months: 6, extras: { stores: 0, productPacks: 0, userPacks: 0 } },
  currentTermOnly: true, futureCoverageUnchanged: true,
  products: ready ? [{ productId: temporaryProduct.id, productType: "NON_RENEWING" }] : [],
  markets: ready ? [{ storefrontId: "123456", currency: "USD" }] : [],
});
const temporaryQuoteFixture = (input: TemporaryRequest) => ({
  offerKey: "temporary-upgrade:synthetic-policy:band-one", action: "CHANGE", quoteToken: "temporary-signed-quote",
  organization: { id: "synthetic-organization", name: "Synthetic organization" },
  productId: temporaryProduct.id, productType: "NON_RENEWING", selection: { ...input.selection, months: 6 },
  target: { selection: { ...input.selection, months: 6 }, entitlements: { limits: { maxStores: 3 + input.selection.extras.stores, maxProducts: 10_000, maxActiveUsers: 5 } } },
  source: { id: "synthetic-gopay-period", plan: "STARTER", extras: { stores: 0, productPacks: 0, userPacks: 0 }, months: 6,
    provider: "GOPAY", startsAt: "2026-11-01T00:00:00Z", endsAt: "2027-05-01T00:00:00Z" },
  timing: { startsAt: "2026-11-11T00:00:00Z", endsAt: "2027-05-01T00:00:00Z", validUntil: "2027-01-01T00:00:00Z" },
  priceConstraint: { storefrontId: "123456", currency: "USD", priceMillis: "2990" },
  serviceValue: { currency: "KGS", incrementalMinor: 20_000, chargedServiceMinor: 19_000, ownerDiscountMinor: 1000 },
  currentTermOnly: true, futureCoverageUnchanged: true, parentDependent: true,
});
const configureTemporary = () => {
  const data = fixture();
  data.access.paidUntil = "2027-11-01T00:00:00Z";
  for (const stores of [0, 1]) for (const reserve of [0, 1]) data.offers.push({
    ...offer(), offerKey: `business-next-term-${stores}-${reserve}`,
    selection: { plan: "BUSINESS", months: 1, extras: { stores, productPacks: reserve, userPacks: 0 } },
  });
  mock.data = data;
  mock.temporaryData = temporaryCatalogFixture(true);
  mock.temporaryPreview.mockImplementation(temporaryQuoteFixture);
  mock.products.mockImplementation(async (productIds: string[]) => ({
    products: [product, temporaryProduct].filter((entry) => productIds.includes(entry.id)), missingProductIds: [],
  }));
  mock.intent.mockResolvedValue({ intentId: "native-authorized-intent", productId: temporaryProduct.id });
  mock.purchase.mockResolvedValue({ status: "purchased", transaction: { ...receipt(), productId: temporaryProduct.id } });
  return data;
};
const configureAutomaticChange = () => {
  const data = fixture();
  Object.assign(data.offers[0], { productType: "AUTO_RENEWABLE", availableActions: ["CHANGE"],
    renewUnavailableReason: "appleExistingAccessActive", changeUnavailableReason: null });
  Object.assign(data.access, { source: "APPLE", appleAutoRenew: true, appleCoverageUntil: "2027-05-01T00:00:00Z" });
  mock.data = data;
  mock.products.mockResolvedValue({ products: [{ ...product, type: "AUTO_RENEWABLE", subscriptionPeriod: { unit: "month", value: 1 } }], missingProductIds: [] });
  return data;
};
const messages = { ru, kg, en };
const mount = (locale: keyof typeof messages = "ru", wrapper = false) =>
  render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone="Asia/Bishkek">
      <TooltipProvider>
        {wrapper ? (
          <SubscriptionPayments onUpdated={mock.updated} />
        ) : (
          <ApplePayments kind="SUBSCRIPTION" onUpdated={mock.updated} />
        )}
      </TooltipProvider>
    </NextIntlClientProvider>,
  );
const openConsent = async () => {
  await screen.findByText(product.displayPrice);
  const purchaseButton = screen.getByRole("button", { name: /\$19\.99/ });
  await waitFor(() => expect((purchaseButton as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(purchaseButton);
  const dialog = within(await screen.findByRole("dialog"));
  fireEvent.click(dialog.getByRole("checkbox"));
  return dialog;
};
const choose = async (label: string, option: string) => {
  fireEvent.keyDown(screen.getByRole("combobox", { name: label }), { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name: option }));
};
const chooseTemporary = async (locale: keyof typeof messages = "ru", target: "business" | "enterprise" = "business") => {
  await screen.findByRole("combobox", { name: messages[locale].billingApple.action });
  await choose(messages[locale].billingApple.action, messages[locale].billingApple.temporaryChange);
  await choose(messages[locale].billingApple.plan, messages[locale].billing.plans[target].name);
  await screen.findByText(temporaryProduct.displayPrice);
};
const openTemporaryConsent = async () => {
  fireEvent.click(screen.getByRole("button", { name: /\$2\.99/ }));
  const dialog = within(screen.getByRole("dialog"));
  fireEvent.click(dialog.getByRole("checkbox"));
  return dialog;
};
const originalScrollIntoView = Element.prototype.scrollIntoView;
beforeEach(() => {
  vi.resetAllMocks();
  mock.platform = "ios";
  mock.nativeReady = true;
  mock.session = { user: { id: "synthetic-buyer", organizationId: "synthetic-organization", role: "ADMIN" } };
  mock.data = fixture();
  mock.temporaryData = temporaryCatalogFixture();
  mock.temporaryError = null;
  mock.temporaryFetching = false;
  mock.storefront.mockResolvedValue({ id: "123456", countryCode: "KGZ" });
  mock.temporaryRefetch.mockResolvedValue(undefined);
  mock.temporaryCatalogRefetch.mockImplementation(async () => ({ data: mock.temporaryData }));
  mock.products.mockResolvedValue({ products: [product], missingProductIds: [] });
  mock.intent.mockResolvedValue({ intentId: "native-authorized-intent" });
  mock.purchase.mockResolvedValue({ status: "purchased", transaction: receipt() });
  mock.confirm.mockResolvedValue({ acknowledged: true, status: "GRANTED" });
  mock.restoreBatch.mockImplementation(
    async ({ signedTransactions }: { signedTransactions: string[] }) => ({
      results: signedTransactions.map((signed, index) => ({
        index,
        success: true,
        confirmation: { transactionId: signed.split(".")[1], status: "GRANTED" },
      })),
    }),
  );
  mock.finish.mockResolvedValue({ finished: true });
  mock.retryCompletions.mockResolvedValue({ pendingCount: 0, acknowledgedCount: 0, deferredCount: 0, recordedCount: 0 });
  mock.refetch.mockResolvedValue({ data: mock.data });
  mock.restore.mockResolvedValue({
    transactions: [],
    unverifiedTransactionIds: [],
    nextCursor: null,
  });
  mock.cancel.mockResolvedValue({ canceled: true, recorded: false });
  mock.manage.mockResolvedValue(undefined);
  mock.refund.mockResolvedValue({ status: "submitted" });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

describe("iOS Apple checkout and recovery", () => {
  it.each(["ru", "kg", "en"] as const)("keeps a deferred native result distinct from new paid access in %s", async (locale) => {
    configureAutomaticChange();
    mock.purchase.mockResolvedValueOnce({ status: "deferred", completionAcknowledged: true, completionRecorded: false,
      scheduled: false, effectiveAt: "2027-05-01T00:00:00Z" });
    const { container } = mount(locale);
    const dialog = await openConsent();
    fireEvent.click(dialog.getByRole("button", { name: messages[locale].billingApple.confirmPurchase }));
    await screen.findByText(messages[locale].billingApple.deferredRecorded);
    expect(mock.confirm).not.toHaveBeenCalled();
    expect(mock.finish).not.toHaveBeenCalled();
    expect(mock.cancel).not.toHaveBeenCalled();
    expect(mock.refetch).toHaveBeenCalled();
    expect(container.querySelector("[data-apple-scheduled-change]")).toBeNull();
    expect(screen.queryByText(messages[locale].billingApple.confirmed)).toBeNull();
  });

  it("retains a lost deferred acknowledgement without confirming or finishing the old transaction", async () => {
    configureAutomaticChange();
    mock.purchase.mockResolvedValueOnce({ status: "deferred", completionAcknowledged: false, completionRecorded: false, scheduled: false });
    mount();
    const dialog = await openConsent();
    fireEvent.click(dialog.getByRole("button", { name: ru.billingApple.confirmPurchase }));
    await screen.findByText(ru.billingApple.deferredPending);
    expect(mock.confirm).not.toHaveBeenCalled();
    expect(mock.finish).not.toHaveBeenCalled();
    expect(mock.cancel).not.toHaveBeenCalled();
  });

  it("hands deferred money precedence to refreshed financial status without claiming a scheduled change", async () => {
    configureAutomaticChange();
    mock.purchase.mockResolvedValueOnce({ status: "deferred", completionAcknowledged: true, completionRecorded: true, scheduled: false });
    mount();
    const dialog = await openConsent();
    fireEvent.click(dialog.getByRole("button", { name: ru.billingApple.confirmPurchase }));
    await screen.findByText(ru.billingApple.deferredMoneyRecorded);
    expect(mock.confirm).not.toHaveBeenCalled();
    expect(mock.finish).not.toHaveBeenCalled();
    expect(mock.refetch).toHaveBeenCalled();
  });

  it("does not mistake an older native build's old-SKU success for the requested auto change", async () => {
    configureAutomaticChange();
    mock.purchase.mockResolvedValueOnce({ status: "purchased", transaction: { ...receipt(), productId: "kg.bazaar.testing.previous-term" } });
    mount();
    const dialog = await openConsent();
    fireEvent.click(dialog.getByRole("button", { name: ru.billingApple.confirmPurchase }));
    await screen.findByText(ru.billingApple.deferredPending);
    expect(mock.confirm).not.toHaveBeenCalled();
    expect(mock.finish).not.toHaveBeenCalled();
    expect(mock.cancel).not.toHaveBeenCalled();
  });

  it("includes earned completion recovery in explicit restore without declaring all proofs resolved", async () => {
    mock.retryCompletions.mockResolvedValueOnce({ pendingCount: 1, acknowledgedCount: 0, deferredCount: 0, recordedCount: 0 });
    mount();
    await screen.findByText(product.displayPrice);
    fireEvent.click(screen.getByRole("button", { name: ru.billingApple.restore }));
    await screen.findByText(ru.billingApple.completionPending);
    expect(mock.retryCompletions).toHaveBeenCalledExactlyOnceWith();
    expect(mock.restore).toHaveBeenCalledTimes(1);
    expect(mock.finish).not.toHaveBeenCalled();
    expect(mock.purchase).not.toHaveBeenCalled();
  });

  it.each(["ru", "kg", "en"] as const)("buys a direct current-term upgrade with exact Apple metadata and preserved coverage in %s", async (locale) => {
    configureTemporary();
    const { container } = mount(locale);
    await chooseTemporary(locale);
    expect(screen.queryByRole("combobox", { name: messages[locale].billingApple.months })).toBeNull();
    const details = container.querySelector("[data-apple-temporary-details]")!;
    expect(details.textContent).toContain(messages[locale].billingApple.temporaryDependency);
    expect(details.textContent).toContain(messages[locale].billingApple.temporaryPreserved);
    expect(details.textContent).toContain("2027");
    expect(details.textContent).not.toContain("KGS");
    expect(container.querySelector("[data-apple-price]")?.textContent).not.toContain(product.displayPrice);
    expect(mock.products.mock.calls.at(-1)?.[0]).toEqual([temporaryProduct.id]);
    const dialog = await openTemporaryConsent();
    expect(dialog.getByText(messages[locale].billingApple.temporaryTerms)).toBeTruthy();
    expect(dialog.getByText(messages[locale].billingApple.temporaryDependency)).toBeTruthy();
    fireEvent.click(dialog.getByRole("button", { name: messages[locale].billingApple.confirmPurchase }));
    await waitFor(() => expect(mock.finish).toHaveBeenCalledWith(receipt().transactionId));
    expect(mock.intent).toHaveBeenCalledWith(expect.objectContaining({
      offerKey: "temporary-upgrade:synthetic-policy:band-one", action: "CHANGE", quoteToken: "temporary-signed-quote",
      expectedOrganizationId: "synthetic-organization", acceptedTerms: true,
    }));
    expect(mock.purchase).toHaveBeenCalledWith("native-authorized-intent");
    expect(mock.webGet).not.toHaveBeenCalled();
    await screen.findByText(messages[locale].billingApple.temporaryRecorded);
  });

  it("preserves selected paid additions when the temporary target plan changes", async () => {
    const data = configureTemporary();
    data.access.plan = "BUSINESS";
    data.access.extras.stores = 1;
    data.access.extras.productPacks = 1;
    data.offers.push({ ...offer(), offerKey: "enterprise-current-term-target",
      selection: { plan: "ENTERPRISE", months: 1, extras: { stores: 1, productPacks: 1, userPacks: 0 } } });
    mock.temporaryPreview.mockImplementation((input: TemporaryRequest) => ({
      ...temporaryQuoteFixture(input), source: { ...temporaryQuoteFixture(input).source,
        plan: "BUSINESS", extras: { stores: 1, productPacks: 1, userPacks: 0 } },
    }));
    mount();
    await chooseTemporary("ru", "enterprise");
    expect(screen.getByRole("combobox", { name: ru.billingApple.additionalStores }).textContent).toContain("1");
    expect(screen.getByRole("combobox", { name: ru.billingApple.reserve }).textContent).toContain(ru.billingApple.reserveIncluded);
    expect(mock.temporaryRequest).toHaveBeenCalledWith(expect.objectContaining({
      selection: { plan: "ENTERPRISE", months: 1, extras: { stores: 1, productPacks: 1, userPacks: 0 } },
    }), expect.objectContaining({ enabled: true }));
    expect(mock.purchase).not.toHaveBeenCalled();
  });

  it("keeps unapproved temporary sales disabled without substituting a renewal", async () => {
    configureTemporary();
    mock.temporaryData = temporaryCatalogFixture(false);
    mount();
    await choose(ru.billingApple.action, ru.billingApple.temporaryChange);
    await screen.findByText(ru.errors.appleTemporaryUpgradePolicyUnavailable);
    expect((screen.getByRole("button", { name: /Продолжить с Apple/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(product.displayPrice)).toBeNull();
    expect(mock.storefront).not.toHaveBeenCalled();
    expect(mock.intent).not.toHaveBeenCalled();
  });

  it("can quote an approved C band independently of unavailable full-period product mappings", async () => {
    const data = configureTemporary();
    data.ready = false;
    for (const entry of data.offers) Object.assign(entry, { productId: null, available: false, availableActions: [] });
    mount();
    await chooseTemporary();
    expect((screen.getByRole("button", { name: /\$2\.99/ }) as HTMLButtonElement).disabled).toBe(false);
    expect(mock.products.mock.calls.at(-1)?.[0]).toEqual([temporaryProduct.id]);
    expect(screen.queryByText(product.displayPrice)).toBeNull();
  });

  it("keeps temporary checkout disabled while a fresh quote is loading", async () => {
    configureTemporary();
    mock.temporaryFetching = true;
    const view = mount();
    await choose(ru.billingApple.action, ru.billingApple.temporaryChange);
    await choose(ru.billingApple.plan, ru.billing.plans.business.name);
    await waitFor(() => expect(mock.temporaryRequest).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ enabled: true })));
    expect(screen.getAllByText(ru.common.loading).length).toBeGreaterThan(0);
    expect((screen.getByRole("button", { name: /\$2\.99/ }) as HTMLButtonElement).disabled).toBe(true);
    mock.temporaryFetching = false;
    view.rerender(<NextIntlClientProvider locale="ru" messages={ru} timeZone="Asia/Bishkek"><TooltipProvider><ApplePayments kind="SUBSCRIPTION" onUpdated={mock.updated} /></TooltipProvider></NextIntlClientProvider>);
    await screen.findByText(temporaryProduct.displayPrice);
    expect((screen.getByRole("button", { name: /\$2\.99/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("blocks changed C price metadata without buying a full-period renewal", async () => {
    configureTemporary();
    mock.products.mockImplementation(async (productIds: string[]) => ({
      products: [product, { ...temporaryProduct, priceMillis: "3990", displayPrice: "$3.99" }].filter((entry) => productIds.includes(entry.id)), missingProductIds: [],
    }));
    mount();
    await screen.findByText(product.displayPrice);
    await choose(ru.billingApple.action, ru.billingApple.temporaryChange);
    await choose(ru.billingApple.plan, ru.billing.plans.business.name);
    await screen.findByText("$3.99");
    expect((screen.getByRole("button", { name: /\$3\.99/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(ru.billingApple.productMismatch)).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: ru.billingApple.months })).toBeNull();
    expect(mock.intent).not.toHaveBeenCalled();
  });

  it("keeps C blocked while storefront is unavailable and recovers with an explicit retry", async () => {
    configureTemporary();
    mock.storefront.mockRejectedValueOnce(new Error("APPLE_STOREFRONT_UNAVAILABLE"));
    mount();
    await screen.findByText(product.displayPrice);
    await choose(ru.billingApple.action, ru.billingApple.temporaryChange);
    await screen.findByText(ru.billingApple.storefrontUnavailable);
    expect(mock.purchase).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: ru.billingApple.retry }));
    await choose(ru.billingApple.plan, ru.billing.plans.business.name);
    await screen.findByText(temporaryProduct.displayPrice);
    expect(mock.storefront).toHaveBeenCalledTimes(2);
    expect((screen.getByRole("button", { name: /\$2\.99/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("does not convert price or offer renewal when the storefront market is unsupported", async () => {
    configureTemporary();
    mock.storefront.mockResolvedValue({ id: "999999", countryCode: "GBR" });
    mount();
    await screen.findByText(product.displayPrice);
    await choose(ru.billingApple.action, ru.billingApple.temporaryChange);
    await screen.findByText(ru.billingApple.temporaryMarketUnavailable);
    expect(screen.getByRole("combobox", { name: ru.billingApple.action }).textContent).toContain(ru.billingApple.temporaryChange);
    expect(mock.intent).not.toHaveBeenCalled();
    expect(mock.webGet).not.toHaveBeenCalled();
  });

  it("closes stale consent without switching CHANGE to RENEW after the source changes", async () => {
    configureTemporary();
    const view = mount();
    await chooseTemporary();
    await openTemporaryConsent();
    mock.temporaryError = new Error("appleTemporaryUpgradeSourceChanged");
    view.rerender(<NextIntlClientProvider locale="ru" messages={ru} timeZone="Asia/Bishkek"><TooltipProvider><ApplePayments kind="SUBSCRIPTION" onUpdated={mock.updated} /></TooltipProvider></NextIntlClientProvider>);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("combobox", { name: ru.billingApple.action }).textContent).toContain(ru.billingApple.temporaryChange);
    expect(screen.queryByRole("combobox", { name: ru.billingApple.months })).toBeNull();
    expect(mock.intent).not.toHaveBeenCalled();
  });

  it("requires fresh consent when the exact temporary dates change", async () => {
    configureTemporary();
    const view = mount();
    await chooseTemporary();
    await openTemporaryConsent();
    mock.temporaryPreview.mockImplementation((input: TemporaryRequest) => {
      const quote = temporaryQuoteFixture(input);
      return { ...quote, timing: { ...quote.timing, endsAt: "2027-04-01T00:00:00Z" } };
    });
    view.rerender(<NextIntlClientProvider locale="ru" messages={ru} timeZone="Asia/Bishkek"><TooltipProvider><ApplePayments kind="SUBSCRIPTION" onUpdated={mock.updated} /></TooltipProvider></NextIntlClientProvider>);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mock.intent).not.toHaveBeenCalled();
  });

  it("blocks an expired temporary quote and labels its refresh", async () => {
    configureTemporary();
    mock.temporaryPreview.mockImplementation((input: TemporaryRequest) => {
      const quote = temporaryQuoteFixture(input);
      return { ...quote, timing: { ...quote.timing, validUntil: "2020-01-01T00:00:00Z" } };
    });
    mount();
    await chooseTemporary();
    await screen.findByText(ru.billingApple.temporaryQuoteExpired);
    expect((screen.getByRole("button", { name: /\$2\.99/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(mock.purchase).not.toHaveBeenCalled();
  });

  it("refuses a changed temporary intent SKU before invoking the native purchase", async () => {
    configureTemporary();
    mock.intent.mockResolvedValue({ intentId: "soft-mismatched-intent", productId: product.id });
    mount();
    await chooseTemporary();
    const dialog = await openTemporaryConsent();
    fireEvent.click(dialog.getByRole("button", { name: ru.billingApple.confirmPurchase }));
    await waitFor(() => expect(mock.cancel).toHaveBeenCalledWith({ intentId: "soft-mismatched-intent" }));
    expect(mock.purchase).not.toHaveBeenCalled();
    expect(mock.finish).not.toHaveBeenCalled();
  });

  it("retains a lost temporary confirmation for receipt recovery without claiming or finishing the grant", async () => {
    configureTemporary();
    mock.confirm.mockRejectedValueOnce(new Error("network lost"));
    mount();
    await chooseTemporary();
    const dialog = await openTemporaryConsent();
    fireEvent.click(dialog.getByRole("button", { name: ru.billingApple.confirmPurchase }));
    await screen.findByText(ru.billingApple.temporaryConfirmationPending.replace("{reason}", ru.billingApple.operationFailed));
    expect(mock.purchase).toHaveBeenCalledTimes(1);
    expect(mock.finish).not.toHaveBeenCalled();
    expect(screen.queryByText(ru.billingApple.temporaryRecorded)).toBeNull();
  });

  it("reports a native price abort through its attempt acknowledgement without a second cancellation", async () => {
    configureTemporary();
    mock.purchase.mockResolvedValueOnce({ status: "not_started", cancellationAcknowledged: true, cancellationRecorded: false,
      error: { code: "APPLE_PRICE_CHANGED" } });
    mount();
    await chooseTemporary();
    const dialog = await openTemporaryConsent();
    fireEvent.click(dialog.getByRole("button", { name: ru.billingApple.confirmPurchase }));
    await screen.findByText(ru.billingApple.purchaseNotStarted.replace("{reason}", ru.billingApple.priceChanged));
    expect(mock.cancel).not.toHaveBeenCalled();
    expect(mock.confirm).not.toHaveBeenCalled();
    expect(mock.finish).not.toHaveBeenCalled();
  });

  it("keeps a recorded temporary grant visible when the native finish acknowledgement is lost", async () => {
    configureTemporary();
    mock.finish.mockRejectedValueOnce(new Error("offline"));
    mount();
    await chooseTemporary();
    const dialog = await openTemporaryConsent();
    fireEvent.click(dialog.getByRole("button", { name: ru.billingApple.confirmPurchase }));
    await screen.findByText(ru.billingApple.temporaryRecoveryPending);
    expect(mock.confirm).toHaveBeenCalledTimes(1);
    expect(mock.purchase).toHaveBeenCalledTimes(1);
    expect(mock.cancel).not.toHaveBeenCalled();
  });

  it("renders a suspended temporary grant separately and restores its receipt without local rights or balance changes", async () => {
    const data = configureTemporary();
    data.temporaryUpgrades.push({ id: "temporary-period", sourcePeriodId: "gopay-base", plan: "BUSINESS",
      extras: { stores: 1, productPacks: 1, userPacks: 0 }, startsAt: "2026-11-01T00:00:00Z", endsAt: "2027-05-01T00:00:00Z",
      status: "SUSPENDED", parentDependent: true, currentTermOnly: true });
    mock.restore.mockResolvedValue({ transactions: [receipt("temporary-receipt")], unverifiedTransactionIds: [], nextCursor: null });
    const { container } = mount();
    await screen.findByText(product.displayPrice);
    expect(container.querySelector("[data-apple-temporary-history]")?.textContent).toContain(ru.billingApple.temporaryStatuses.SUSPENDED);
    expect(screen.getByText(ru.billingApple.noRepurchase)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: ru.billingApple.restore }));
    await waitFor(() => expect(mock.finish).toHaveBeenCalledWith("temporary-receipt"));
    expect(mock.purchase).not.toHaveBeenCalled();
    expect(container.querySelector("[data-apple-temporary-history]")?.textContent).toContain(ru.billingApple.temporaryStatuses.SUSPENDED);
  });

  it("preserves the existing same-group automatic change without requiring C storefront metadata", async () => {
    const data = fixture();
    Object.assign(data.offers[0], { productType: "AUTO_RENEWABLE", availableActions: ["CHANGE"], renewUnavailableReason: "appleExistingAccessActive", changeUnavailableReason: null });
    Object.assign(data.access, { appleAutoRenew: true, appleCoverageUntil: "2027-02-01T00:00:00Z" });
    mock.data = data;
    mock.products.mockResolvedValue({ products: [{ ...product, type: "AUTO_RENEWABLE", subscriptionPeriod: { unit: "month", value: 1 } }], missingProductIds: [] });
    mount();
    await screen.findByText(ru.billingApple.changeTiming);
    expect(screen.getByRole("combobox", { name: ru.billingApple.months })).toBeTruthy();
    const dialog = await openConsent();
    fireEvent.click(dialog.getByRole("button", { name: ru.billingApple.confirmPurchase }));
    await waitFor(() => expect(mock.purchase).toHaveBeenCalled());
    expect(mock.intent).toHaveBeenCalledWith(expect.objectContaining({ action: "CHANGE" }));
    expect(mock.storefront).not.toHaveBeenCalled();
  });

  it.each(["ru", "kg", "en"] as const)(
    "uses localized Apple prices and explicit organization consent in %s",
    async (locale) => {
      const { container } = mount(locale);
      await screen.findByText(product.displayPrice);
      expect(screen.getByRole("link", { name: messages[locale].billingApple.privacy }).getAttribute("href")).toBe("/privacy");
      expect(container.querySelector("[data-apple-price]")?.textContent).not.toContain("2000");
      expect(screen.getAllByText("Synthetic organization").length).toBe(1);
      const dialog = await openConsent();
      expect(dialog.getByText("Synthetic organization")).toBeTruthy();
      fireEvent.click(
        dialog.getByRole("button", { name: messages[locale].billingApple.confirmPurchase }),
      );
      await waitFor(() => expect(mock.finish).toHaveBeenCalledWith(receipt().transactionId));
      expect(mock.intent).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedOrganizationId: "synthetic-organization",
          acceptedTerms: true,
          termsVersion: "test-terms",
          action: "RENEW",
        }),
      );
      expect(mock.purchase).toHaveBeenCalledWith("native-authorized-intent");
      expect(mock.confirm).toHaveBeenCalledWith({
        intentId: "native-authorized-intent",
        signedTransactionInfo: receipt().signedTransactionInfo,
      });
      expect(mock.confirm.mock.invocationCallOrder[0]).toBeLessThan(
        mock.finish.mock.invocationCallOrder[0],
      );
    },
  );

  it("fails closed on iOS without the plugin and never mounts GoPay checkout", async () => {
    mock.nativeReady = false;
    mount("ru", true);
    await screen.findByText(ru.billingApple.unavailable);
    expect(mock.webGet).not.toHaveBeenCalled();
    expect(mock.products).not.toHaveBeenCalled();
    expect(mock.purchase).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("button", { name: /Продолжить с Apple/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.queryByRole("link", { name: /GoPay/ })).toBeNull();
  });

  it("shows existing GoPay coverage without offering another overlapping Apple charge", async () => {
    const data = fixture();
    data.access.paidUntil = "2027-01-01T00:00:00.000Z";
    Object.assign(data.offers[0], {
      available: false,
      availableActions: [],
      unavailableReason: "appleExistingAccessActive",
      renewUnavailableReason: "appleExistingAccessActive",
    });
    mock.data = data;
    mount();
    await screen.findByText(product.displayPrice);
    expect(screen.getByText(ru.billingApple.noRepurchase)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: /Продолжить с Apple/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(mock.intent).not.toHaveBeenCalled();
  });

  it("keeps a pending purchase unfinished and does not claim access", async () => {
    mock.purchase.mockResolvedValueOnce({ status: "pending" });
    mount();
    const dialog = await openConsent();
    fireEvent.click(dialog.getByRole("button", { name: ru.billingApple.confirmPurchase }));
    await screen.findByText(ru.billingApple.pending);
    expect(mock.confirm).not.toHaveBeenCalled();
    expect(mock.finish).not.toHaveBeenCalled();
    expect(mock.cancel).not.toHaveBeenCalled();
  });

  it("does not replace the native attempt acknowledgement with a generic web cancellation", async () => {
    mock.purchase.mockResolvedValueOnce({ status: "cancelled", cancellationAcknowledged: false, cancellationRecorded: false });
    mount();
    const dialog = await openConsent();
    fireEvent.click(dialog.getByRole("button", { name: ru.billingApple.confirmPurchase }));
    await screen.findByText(ru.billingApple.cancellationPending);
    expect(mock.cancel).not.toHaveBeenCalled();
    expect(screen.queryByText(ru.billingApple.cancelled)).toBeNull();
    expect(mock.finish).not.toHaveBeenCalled();
  });

  it("does not cancel again when native already received the durable cancellation ACK", async () => {
    mock.purchase.mockResolvedValueOnce({ status: "cancelled", cancellationAcknowledged: true, cancellationRecorded: false });
    mount();
    const dialog = await openConsent();
    fireEvent.click(dialog.getByRole("button", { name: ru.billingApple.confirmPurchase }));
    await screen.findByText(ru.billingApple.cancelled);
    expect(mock.cancel).not.toHaveBeenCalled();
    expect(mock.confirm).not.toHaveBeenCalled();
    expect(mock.finish).not.toHaveBeenCalled();
  });

  it("keeps an unacknowledged definite cancellation pending and asks native recovery to retry", async () => {
    mock.purchase.mockResolvedValueOnce({ status: "cancelled", cancellationAcknowledged: false, cancellationRecorded: false });
    const retry = vi.fn();
    window.addEventListener("bazaar:apple-retry", retry);
    try {
      mount();
      const dialog = await openConsent();
      fireEvent.click(dialog.getByRole("button", { name: ru.billingApple.confirmPurchase }));
      await screen.findByText(ru.billingApple.cancellationPending);
      expect(screen.queryByText(ru.billingApple.cancelled)).toBeNull();
      expect(retry).toHaveBeenCalledTimes(1);
      expect(mock.confirm).not.toHaveBeenCalled();
      expect(mock.finish).not.toHaveBeenCalled();
      expect(mock.cancel).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("bazaar:apple-retry", retry);
    }
  });

  it("shows recorded money for a cancellation race without claiming that payment was cancelled", async () => {
    mock.purchase.mockResolvedValueOnce({ status: "cancelled", cancellationAcknowledged: false, cancellationRecorded: true });
    mount();
    const dialog = await openConsent();
    fireEvent.click(dialog.getByRole("button", { name: ru.billingApple.confirmPurchase }));
    await screen.findByText(ru.billingApple.cancellationRecorded);
    expect(screen.queryByText(ru.billingApple.cancelled)).toBeNull();
    expect(mock.cancel).not.toHaveBeenCalled();
    expect(mock.finish).not.toHaveBeenCalled();
  });

  it.each([true, false])("describes a pre-sheet abort distinctly with native acknowledgement=%s", async (acknowledged) => {
    mock.purchase.mockResolvedValueOnce({
      status: "not_started", cancellationAcknowledged: acknowledged, cancellationRecorded: false,
      error: { code: "APPLE_APP_NOT_ACTIVE" },
    });
    mount();
    const dialog = await openConsent();
    fireEvent.click(dialog.getByRole("button", { name: ru.billingApple.confirmPurchase }));
    const copy = acknowledged ? ru.billingApple.purchaseNotStarted : ru.billingApple.purchaseNotStartedPending;
    await screen.findByText(copy.replace("{reason}", ru.errors.APPLE_APP_NOT_ACTIVE));
    expect(screen.queryByText(ru.billingApple.cancelled)).toBeNull();
    expect(mock.cancel).not.toHaveBeenCalled();
    expect(mock.confirm).not.toHaveBeenCalled();
    expect(mock.finish).not.toHaveBeenCalled();
  });

  it("keeps another device's recorded money distinct from this pre-sheet abort", async () => {
    mock.purchase.mockResolvedValueOnce({
      status: "not_started", cancellationAcknowledged: false, cancellationRecorded: true,
      error: { code: "APPLE_SERVER_ERROR", serverCode: "applePurchasePendingVerification" },
    });
    mount();
    const dialog = await openConsent();
    fireEvent.click(dialog.getByRole("button", { name: ru.billingApple.confirmPurchase }));
    await screen.findByText(ru.billingApple.cancellationRecorded);
    expect(screen.queryByText(ru.billingApple.cancelled)).toBeNull();
    expect(mock.cancel).not.toHaveBeenCalled();
    expect(mock.confirm).not.toHaveBeenCalled();
    expect(mock.finish).not.toHaveBeenCalled();
  });

  it("refreshes paid access before retrying a lost native finish without reporting the charge as failed", async () => {
    mock.finish.mockRejectedValueOnce(new Error("ack-network-down"));
    mount();
    const dialog = await openConsent();
    fireEvent.click(dialog.getByRole("button", { name: ru.billingApple.confirmPurchase }));
    await screen.findByText(ru.billingApple.confirmedRecoveryPending);
    expect(mock.updated).toHaveBeenCalledTimes(1);
    expect(mock.updated.mock.invocationCallOrder[0]).toBeLessThan(mock.finish.mock.invocationCallOrder[0]);
    expect(mock.purchase).toHaveBeenCalledTimes(1);
    expect(mock.cancel).not.toHaveBeenCalled();
    expect(screen.queryByText(ru.billingApple.operationFailed)).toBeNull();
  });

  it("cancels a native organization conflict before the payment sheet and explains its original organization", async () => {
    mock.purchase.mockRejectedValueOnce(Object.assign(new Error("APPLE_SUBSCRIPTION_ACCOUNT_CONFLICT"), { code: "APPLE_SUBSCRIPTION_ACCOUNT_CONFLICT" }));
    mount();
    const dialog = await openConsent();
    fireEvent.click(dialog.getByRole("button", { name: ru.billingApple.confirmPurchase }));
    await waitFor(() => expect(dialog.getByText(ru.errors.APPLE_SUBSCRIPTION_ACCOUNT_CONFLICT)).toBeTruthy());
    expect(mock.cancel).toHaveBeenCalledWith({ intentId: "native-authorized-intent" });
    expect(mock.confirm).not.toHaveBeenCalled();
    expect(mock.finish).not.toHaveBeenCalled();
  });

  it("shows Apple's scheduled selection and reconciliation issue separately from current access", async () => {
    const data = fixture();
    data.access.source = "APPLE";
    data.access.appleAutoRenew = true;
    data.access.appleIssue = "appleChangePendingVerification";
    data.access.appleScheduledChange = {
      productId: "kg.bazaar.test.scheduled",
      startsAt: "2027-02-01T00:00:00Z",
      offer: { kind: "SUBSCRIPTION", selection: { plan: "BUSINESS", months: 6, extras: { stores: 2, productPacks: 1, userPacks: 0 } } },
    };
    mock.data = data;
    const { container } = mount();
    await screen.findByText(product.displayPrice);
    const scheduled = container.querySelector("[data-apple-scheduled-change]")!;
    expect(scheduled.textContent).toContain(ru.billingApple.scheduledChange);
    expect(scheduled.textContent).toContain(ru.billing.plans.business.name);
    expect(scheduled.textContent).toContain(ru.billingApple.scheduledChangeHint);
    expect(scheduled.textContent).not.toContain("kg.bazaar.test.scheduled");
    expect(container.querySelector("[data-apple-access-issue]")?.textContent).toBe(ru.errors.appleChangePendingVerification);
  });

  it("uses safe instructions for an unknown scheduled offer or issue without rendering server payloads", async () => {
    const data = fixture();
    data.access.appleIssue = "internal-not-for-users";
    data.access.appleScheduledChange = { productId: "private-product", startsAt: null, offer: { arbitrary: "internal-details" } };
    mock.data = data;
    const { container } = mount();
    await screen.findByText(product.displayPrice);
    expect(container.querySelector("[data-apple-scheduled-change]")?.textContent).toContain(ru.billingApple.scheduledChangeDetails);
    expect(container.querySelector("[data-apple-access-issue]")?.textContent).toBe(ru.billingApple.review);
    expect(container.textContent).not.toContain("internal-not-for-users");
    expect(container.textContent).not.toContain("internal-details");
  });

  it("preserves payment recovery after confirmation loss without finishing the receipt", async () => {
    mock.confirm.mockRejectedValueOnce(new Error("network-down"));
    mount();
    const dialog = await openConsent();
    fireEvent.click(dialog.getByRole("button", { name: ru.billingApple.confirmPurchase }));
    await screen.findByText(ru.billingApple.operationFailed);
    expect(mock.finish).not.toHaveBeenCalled();
    expect(mock.cancel).not.toHaveBeenCalled();
  });

  it("continues paginated restore after an unrelated organization receipt and never finishes a rejected receipt", async () => {
    const other = receipt("another-org");
    const first = receipt("first");
    const last = receipt("last");
    mock.restore.mockResolvedValueOnce({
      transactions: [other, first],
      unverifiedTransactionIds: [],
      nextCursor: "page-two",
    });
    mock.history.mockResolvedValueOnce({
      transactions: [last],
      unverifiedTransactionIds: [],
      nextCursor: null,
    });
    mock.restoreBatch.mockImplementationOnce(async () => ({
      results: [
        { index: 0, success: false, reason: "applePurchaseOrganizationMismatch", retryable: false },
        { index: 1, success: true, confirmation: { transactionId: "first", status: "GRANTED" } },
      ],
    }));
    mount();
    fireEvent.click(screen.getByRole("button", { name: ru.billingApple.restore }));
    await screen.findByText(ru.billingApple.review);
    expect(mock.history).toHaveBeenCalledWith("page-two");
    expect(mock.finish.mock.calls).toEqual([["first"], ["last"]]);
    expect(mock.restore).toHaveBeenCalledTimes(1);
  });

  it("blocks a mismatched Apple product type instead of using its price", async () => {
    mock.products.mockResolvedValueOnce({
      products: [{ ...product, type: "CONSUMABLE" }],
      missingProductIds: [],
    });
    mount();
    await screen.findByText(ru.billingApple.productMismatch);
    expect(
      (screen.getByRole("button", { name: /Продолжить с Apple/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(mock.purchase).not.toHaveBeenCalled();
  });

  it("resumes a large history after a rate limit without resyncing or replaying completed batches", async () => {
    const transactions = Array.from({ length: 60 }, (_, index) => receipt(String(index)));
    mock.restore.mockResolvedValueOnce({ transactions, unverifiedTransactionIds: [], nextCursor: null });
    const record = mock.restoreBatch.getMockImplementation()!;
    mock.restoreBatch.mockImplementationOnce(record).mockRejectedValueOnce({ data: { code: "TOO_MANY_REQUESTS" } });
    mount();
    fireEvent.click(screen.getByRole("button", { name: ru.billingApple.restore }));
    await screen.findByText(ru.billingApple.restoreWait);
    expect(mock.finish).toHaveBeenCalledTimes(50);
    fireEvent.click(screen.getByRole("button", { name: ru.billingApple.resumeRestore }));
    await screen.findByText(ru.billingApple.restored);
    expect(mock.restore).toHaveBeenCalledTimes(1);
    expect(mock.finish).toHaveBeenCalledTimes(60);
    expect(mock.restoreBatch.mock.calls[2][0].signedTransactions).toEqual(transactions.slice(50).map((transaction) => transaction.signedTransactionInfo));
  });

  it("retries a refused native acknowledgment without presenting another purchase sheet", async () => {
    mock.restore.mockResolvedValueOnce({ transactions: [receipt("retry-ack")], unverifiedTransactionIds: [], nextCursor: null });
    mock.finish.mockRejectedValueOnce(new Error("temporary-ack-failure"));
    mount();
    fireEvent.click(screen.getByRole("button", { name: ru.billingApple.restore }));
    await screen.findByText(ru.billingApple.review);
    fireEvent.click(screen.getByRole("button", { name: ru.billingApple.resumeRestore }));
    await screen.findByText(ru.billingApple.restored);
    expect(mock.restore).toHaveBeenCalledTimes(1);
    expect(mock.finish.mock.calls).toEqual([["retry-ack"], ["retry-ack"]]);
    expect(mock.purchase).not.toHaveBeenCalled();
  });

  it("displays verified Apple money in its currency and treats a refund request as pending Apple decision", async () => {
    const data = fixture();
    data.recentTransactions = [
      {
        transactionId: "paid-receipt",
        priceMillis: "9990",
        currency: "USD",
        status: "REVIEW",
        purchaseDate: "2026-11-11T00:00:00Z",
        expiresDate: null,
        environment: "Production",
        refundable: true,
      },
    ];
    mock.data = data;
    const { container } = mount();
    const history = container.querySelector("[data-apple-history]") as HTMLDetailsElement;
    history.open = true;
    expect(history.textContent).toContain("9,99");
    expect(history.textContent).not.toContain("2000");
    fireEvent.click(screen.getByRole("button", { name: ru.billingApple.refund }));
    await screen.findByText(ru.billingApple.refundSubmitted);
    expect(mock.refund).toHaveBeenCalledWith("paid-receipt");
    expect(mock.confirm).not.toHaveBeenCalled();
  });

  it("keeps requesting a refund independent from a pending consent withdrawal", async () => {
    const data = fixture();
    data.recentTransactions = [{ transactionId: "9007199254740993001", priceMillis: "9990", currency: "USD", status: "GRANTED",
      purchaseDate: "2026-11-11T00:00:00Z", expiresDate: null, environment: "Sandbox", refundable: true,
      consumptionConsent: { viewerUserId: "synthetic-buyer", availableToViewer: true, policyVersion: "2026-11-13-v1",
        canManage: true, canRevoke: true, consented: true, valid: true, grantedAt: "2026-11-13T12:00:00Z", revokedAt: null,
        deliveryStatus: "DELIVERED", sampleContentProvided: false, invalidReason: null, responseStatus: null, lastIssue: null } }];
    mock.data = data;
    mock.consumptionConsent.mockReturnValue(new Promise(() => {}));
    const { container } = mount();
    (container.querySelector("[data-apple-history]") as HTMLDetailsElement).open = true;
    fireEvent.click(screen.getByRole("button", { name: ru.appleConsumption.revoke }));
    expect(mock.consumptionConsent.mock.calls[0][0]).toMatchObject({ consented: false, transactionId: "9007199254740993001" });
    const refund = screen.getByRole("button", { name: ru.billingApple.refund }) as HTMLButtonElement;
    await waitFor(() => expect(refund.disabled).toBe(false));
    fireEvent.click(refund);
    await screen.findByText(ru.billingApple.refundSubmitted);
    expect(mock.refund).toHaveBeenCalledWith("9007199254740993001");
    expect(screen.queryByText(ru.appleConsumption.withdrawn)).toBeNull();
    expect(mock.purchase).not.toHaveBeenCalled();
  });
});
