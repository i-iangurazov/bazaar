// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubscriptionPayments } from "@/components/billing/subscription-payments";
import { TooltipProvider } from "@/components/ui/tooltip";
import { formatCurrencyKGS, formatDateTime } from "@/lib/i18nFormat";

type InvoiceFixture = {
  id: string;
  provider: "GOPAY" | "FREEDOMPAY";
  isTest: boolean;
  plan: string;
  amountMinor: number;
  currency: string;
  status: string;
  createdAt: string;
  paidAt: string | null;
  expiresAt: string;
  checkoutUrl: string | null;
  syncDelayed: boolean;
  period: null;
  purchase: null;
  sellerName: string;
  termsVersion: string;
  termsUrl: string;
  orderId?: string | null;
  refundedMinor?: number;
  refunds?: { id: string; amountMinor: number; bankTransferredOn: string; createdAt: string }[];
};
type QuoteSelection = {
  plan: string;
  months: number;
  extras: { stores: number; productPacks: number; userPacks: number };
  action: string;
};

const mocks = vi.hoisted(() => ({
  data: {
    available: true,
    mode: "sandbox",
    provider: "GOPAY",
    billingMode: "SELF_SERVE",
    accountPaused: false,
    lifetimeAccess: false,
    canPurchase: true,
    currentPlan: "STARTER",
    catalogVersion: "2026-10",
    mayChangePlan: true,
    catalog: [{ plan: "STARTER", amountMinor: 175000 }],
    sellerName: "Synthetic seller",
    termsVersion: "qa-v1",
    termsUrl: "https://example.invalid/terms/v1",
    pendingInvoice: null as InvoiceFixture | null,
    scheduledSubscription: null,
    canChange: false,
    currentMonths: 1,
    currentExtras: { stores: 0, productPacks: 0, userPacks: 0 },
  },
  quoteOverrides: {} as Record<string, unknown>,
  quoteForSelection: null as null | ((input: QuoteSelection) => Record<string, unknown>),
  quoteFetching: false,
  records: [] as InvoiceFixture[],
  mutate: vi.fn(),
  checkMutate: vi.fn(),
  refetch: vi.fn(),
  success: null as
    null | ((invoice: { status: string; checkoutUrl: null; syncDelayed: boolean }) => void),
  error: null as null | ((error: { message: string }) => void),
  checkSuccess: null as
    null | ((invoice: { status: string; isTest: boolean; syncDelayed: boolean }) => void),
}));
vi.mock("next-intl", () => ({
  useLocale: () => "ru",
  useTranslations: (ns: string) =>
    Object.assign(
      (key: string, params?: Record<string, string>) =>
        `${ns}.${key}${params ? ` ${JSON.stringify(params)}` : ""}`,
      { has: () => true },
    ),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    billing: {
      payments: {
        get: {
          useQuery: () => ({
            data: mocks.data,
            isLoading: false,
            isError: false,
            refetch: mocks.refetch,
          }),
        },
        quote: {
          useQuery: (input: QuoteSelection) => ({
            data: {
              plan: input.plan,
              months: input.months,
              extras: input.extras,
              amountMinor: mocks.data.catalog.find((p) => p.plan === input.plan)?.amountMinor ?? 0,
              quoteToken: `quote:${input.plan}:${mocks.data.catalog[0].amountMinor}:${input.months}:${JSON.stringify(input.extras)}`,
              startsAt: "2027-01-01T00:00:00.000Z",
              endsAt: "2027-02-01T00:00:00.000Z",
              creditMinor: 0,
              discountBps: 0,
              kind: input.action === "CHANGE" ? "UPGRADE" : "RENEWAL",
              catalogVersion: mocks.data.catalogVersion,
              entitlements: {
                limits: { maxStores: 1, maxProducts: 1000, maxActiveUsers: 2 },
                features: { pos: true, customerOrders: true, analytics: false },
              },
              fullAmountMinor:
                mocks.data.catalog.find((p) => p.plan === input.plan)?.amountMinor ?? 0,
              termAmountMinor:
                mocks.data.catalog.find((p) => p.plan === input.plan)?.amountMinor ?? 0,
              savingsMinor: 0,
              serviceValueMinor: 175000,
              effectiveTiming: "IMMEDIATE",
              scheduledReduction: false,
              ...mocks.quoteOverrides,
              ...mocks.quoteForSelection?.(input),
            },
            isFetching: mocks.quoteFetching,
            isError: false,
            refetch: mocks.refetch,
          }),
        },
        invoices: {
          useInfiniteQuery: () => ({
            data: { pages: [{ items: mocks.records }] },
            isLoading: false,
            isError: false,
            refetch: mocks.refetch,
            hasNextPage: false,
          }),
        },
        checkout: {
          useMutation: (options: {
            onSuccess: typeof mocks.success;
            onError: typeof mocks.error;
          }) => {
            mocks.success = options.onSuccess;
            mocks.error = options.onError;
            return { mutate: mocks.mutate, isLoading: false };
          },
        },
        check: {
          useMutation: (options: { onSuccess: typeof mocks.checkSuccess }) => {
            mocks.checkSuccess = options.onSuccess;
            return { mutate: mocks.checkMutate, isLoading: false };
          },
        },
      },
    },
  },
}));
const open = () => fireEvent.click(screen.getByRole("button", { name: /^billing.payments.pay / }));
const submit = () => fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
const choose = async (label: string, option: string) => {
  fireEvent.keyDown(screen.getByRole("combobox", { name: label }), { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name: option }));
};
const originalScrollIntoView = Element.prototype.scrollIntoView;
const invoice = (overrides: Partial<InvoiceFixture> = {}): InvoiceFixture => ({
  id: "invoice-fixture",
  provider: "GOPAY",
  isTest: false,
  plan: "STARTER",
  amountMinor: 200000,
  currency: "KGS",
  status: "PENDING",
  createdAt: "2026-11-09T00:00:00.000Z",
  paidAt: null,
  expiresAt: "2029-11-09T00:00:00.000Z",
  checkoutUrl: "https://example.invalid/checkout",
  syncDelayed: false,
  period: null,
  purchase: null,
  sellerName: "Synthetic seller",
  termsVersion: "qa-v1",
  termsUrl: "https://example.invalid/terms/v1",
  ...overrides,
});
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/billing");
  mocks.quoteOverrides = {};
  mocks.quoteForSelection = null;
  mocks.quoteFetching = false;
  mocks.records = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  Object.assign(mocks.data, {
    available: true,
    mode: "sandbox",
    provider: "GOPAY",
    billingMode: "SELF_SERVE",
    accountPaused: false,
    lifetimeAccess: false,
    canPurchase: true,
    pendingInvoice: null,
    scheduledSubscription: null,
    canChange: false,
    currentMonths: 1,
    currentExtras: { stores: 0, productPacks: 0, userPacks: 0 },
    catalogVersion: "2026-10",
    termsVersion: "qa-v1",
    catalog: [{ plan: "STARTER", amountMinor: 175000 }],
    currentPlan: "STARTER",
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

describe("subscription payment consent and recovery", () => {
  it.each([
    [50000, "manualRefundPartial"],
    [200000, "manualRefundFull"],
  ] as const)(
    "shows a recorded bank refund of %s without implying provider cancellation",
    (refundedMinor, badge) => {
      mocks.records = [
        invoice({
          status: "PAID",
          paidAt: "2026-11-10T00:00:00Z",
          orderId: "c".repeat(32),
          refundedMinor,
          refunds: [
            {
              id: "refund-public-summary",
              amountMinor: refundedMinor,
              bankTransferredOn: "2026-11-11",
              createdAt: "2026-11-11T00:00:00Z",
            },
          ],
        }),
      ];
      render(<SubscriptionPayments onUpdated={vi.fn()} />);
      expect(screen.getByText(`billing.payments.${badge}`)).toBeTruthy();
      expect(screen.getByText("c".repeat(32))).toBeTruthy();
      expect(screen.getByText("billing.payments.manualRefundHint")).toBeTruthy();
      expect(screen.getByText(/^billing.payments.manualRefundEntry/).textContent).toContain(
        formatCurrencyKGS(refundedMinor / 100, "ru"),
      );
      expect(screen.getByText("billing.payments.statuses.PAID")).toBeTruthy();
      expect(mocks.checkMutate).not.toHaveBeenCalled();
      expect(mocks.mutate).not.toHaveBeenCalled();
    },
  );

  const serverQuotes = [
    ["STARTER", 1, 200000, 200000, 0, 0],
    ["STARTER", 6, 1140000, 1200000, 60000, 500],
    ["STARTER", 12, 2040000, 2400000, 360000, 1500],
    ["BUSINESS", 1, 350000, 350000, 0, 0],
    ["BUSINESS", 6, 1995000, 2100000, 105000, 500],
    ["BUSINESS", 12, 3570000, 4200000, 630000, 1500],
    ["ENTERPRISE", 1, 550000, 550000, 0, 0],
    ["ENTERPRISE", 6, 3135000, 3300000, 165000, 500],
    ["ENTERPRISE", 12, 5610000, 6600000, 990000, 1500],
  ] as const;
  const termEnds = {
    1: "2027-02-01T00:00:00.000Z",
    6: "2027-07-01T00:00:00.000Z",
    12: "2028-01-01T00:00:00.000Z",
  };

  it.each(serverQuotes)(
    "keeps %s for %s months payable from the server's frozen quote",
    async (plan, months, amountMinor, fullAmountMinor, savingsMinor, discountBps) => {
      Object.assign(mocks.data, {
        catalogVersion: "2026-11",
        mode: "live",
        catalog: [
          { plan: "STARTER", amountMinor: 200000 },
          { plan: "BUSINESS", amountMinor: 350000 },
          { plan: "ENTERPRISE", amountMinor: 550000 },
        ],
      });
      mocks.quoteForSelection = (input) => {
        const row = serverQuotes.find(
          (entry) => entry[0] === input.plan && entry[1] === input.months,
        )!;
        return {
          amountMinor: row[2],
          fullAmountMinor: row[3],
          termAmountMinor: row[2],
          savingsMinor: row[4],
          discountBps: row[5],
          endsAt: termEnds[row[1]],
          quoteToken: `frozen:${row[0]}:${row[1]}`,
        };
      };
      render(<SubscriptionPayments onUpdated={vi.fn()} />);
      await choose("billing.payments.plan", `billing.plans.${plan.toLowerCase()}.name`);
      await choose("billing.payments.term", `billing.payments.term${months}`);
      open();
      const dialog = within(screen.getByRole("dialog"));
      expect(dialog.getByText(`billing.payments.term${months}`)).toBeTruthy();
      expect(dialog.getAllByText("billing.payments.renewalPolicy")).toHaveLength(1);
      const quote = screen.getByRole("dialog").querySelector("[data-subscription-quote]")!;
      expect(quote.textContent).toContain(formatDateTime("2027-01-01T00:00:00.000Z", "ru"));
      expect(quote.textContent).toContain(formatDateTime(termEnds[months], "ru"));
      expect(quote.textContent).toContain("billing.payments.limitsSummary");
      const confirm = dialog.getByRole("button", {
        name: "billing.payments.goToPayment",
      }) as HTMLButtonElement;
      expect(confirm.disabled).toBe(true);
      submit();
      expect(mocks.mutate).not.toHaveBeenCalled();
      fireEvent.click(dialog.getByRole("checkbox"));
      submit();
      expect(mocks.mutate).toHaveBeenCalledOnce();
      expect(mocks.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          plan,
          months,
          expectedAmountMinor: amountMinor,
          extras: { stores: 0, productPacks: 0, userPacks: 0 },
          quoteToken: `frozen:${plan}:${months}`,
          acceptedTerms: true,
          expectedProvider: "GOPAY",
        }),
      );
      expect(quote.textContent).toContain(formatCurrencyKGS(amountMinor / 100, "ru"));
      expect(quote.querySelector("[data-subscription-savings]") !== null).toBe(savingsMinor > 0);
      if (savingsMinor > 0) {
        expect(quote.textContent).toContain(`"percent":${discountBps / 100}`);
        expect(quote.textContent).toContain(formatCurrencyKGS(fullAmountMinor / 100, "ru"));
        expect(quote.textContent).toContain(formatCurrencyKGS(savingsMinor / 100, "ru"));
      }
    },
  );

  it("keeps both Business add-ons selectable and confirms their exact server total and limits", async () => {
    Object.assign(mocks.data, {
      catalogVersion: "2026-11",
      mode: "live",
      catalog: [{ plan: "BUSINESS", amountMinor: 350000 }],
      currentPlan: "BUSINESS",
    });
    const quotes = {
      "0:0": {
        amountMinor: 1995000,
        fullAmountMinor: 2100000,
        savingsMinor: 105000,
        stores: 1,
        products: 5000,
        users: 5,
      },
      "1:0": {
        amountMinor: 2565000,
        fullAmountMinor: 2700000,
        savingsMinor: 135000,
        stores: 2,
        products: 5000,
        users: 5,
      },
      "0:1": {
        amountMinor: 2280000,
        fullAmountMinor: 2400000,
        savingsMinor: 120000,
        stores: 1,
        products: 6000,
        users: 7,
      },
      "1:1": {
        amountMinor: 2850000,
        fullAmountMinor: 3000000,
        savingsMinor: 150000,
        stores: 2,
        products: 6000,
        users: 7,
      },
    };
    mocks.quoteForSelection = (input) => {
      if (input.months !== 6) return {};
      const row =
        quotes[`${input.extras.stores}:${input.extras.productPacks}` as keyof typeof quotes];
      return {
        ...row,
        termAmountMinor: row.amountMinor,
        discountBps: 500,
        endsAt: termEnds[6],
        entitlements: {
          limits: { maxStores: row.stores, maxProducts: row.products, maxActiveUsers: row.users },
          features: { pos: true, customerOrders: true },
        },
      };
    };
    render(<SubscriptionPayments onUpdated={vi.fn()} />);
    await choose("billing.payments.term", "billing.payments.term6");
    await choose("billing.payments.extrastores", 'billing.payments.extraStoreCount {"count":1}');
    fireEvent.click(screen.getByRole("checkbox", { name: /billing.payments.extraproductPacks/ }));
    open();
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText(/^billing.payments.limitsSummary/).textContent).toContain(
      '"stores":2,"products":6000,"users":7',
    );
    expect(dialog.getByText(/^billing.payments.extrasSummary/).textContent).toContain(
      '"stores":1,"products":1000,"users":2',
    );
    expect(dialog.getByText(/^billing.payments.savings/).textContent).toContain('"percent":5');
    fireEvent.click(dialog.getByRole("checkbox"));
    submit();
    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: "BUSINESS",
        months: 6,
        expectedAmountMinor: 2850000,
        extras: { stores: 1, productPacks: 1, userPacks: 0 },
      }),
    );
  });

  it("prevents a double submit before the mutation's loading state has rendered", () => {
    render(<SubscriptionPayments onUpdated={vi.fn()} />);
    open();
    fireEvent.click(screen.getByRole("checkbox"));
    submit();
    submit();
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });
  it("checks a bank return without treating the return URL as proof of payment", () => {
    window.history.replaceState({}, "", "/billing?invoice=invoice-from-bank");
    render(<SubscriptionPayments onUpdated={vi.fn()} />);
    expect(mocks.checkMutate).toHaveBeenCalledWith({ invoiceId: "invoice-from-bank" });
    expect(screen.getByText("billing.payments.returnHint")).toBeTruthy();
    expect(screen.queryByText("billing.payments.confirmed")).toBeNull();
    expect(mocks.mutate).not.toHaveBeenCalled();
    act(() => mocks.checkSuccess?.({ status: "PAID", isTest: false, syncDelayed: false }));
    expect(screen.getByText("billing.payments.confirmed")).toBeTruthy();
  });
  it("resumes reconciliation on restored connection and removes listeners when the invoice settles", () => {
    Object.assign(mocks.data, { pendingInvoice: invoice(), canPurchase: false });
    const mounted = render(<SubscriptionPayments onUpdated={vi.fn()} />);
    fireEvent(window, new Event("online"));
    fireEvent(window, new Event("focus"));
    expect(mocks.checkMutate).toHaveBeenCalledTimes(1);
    act(() => mocks.checkSuccess?.({ status: "PENDING", isTest: false, syncDelayed: false }));
    fireEvent(window, new Event("focus"));
    expect(mocks.checkMutate).toHaveBeenCalledTimes(2);
    Object.assign(mocks.data, { pendingInvoice: null });
    mounted.rerender(<SubscriptionPayments onUpdated={vi.fn()} />);
    fireEvent(window, new Event("online"));
    expect(mocks.checkMutate).toHaveBeenCalledTimes(2);
  });
  it("closes the uncertain checkout dialog when the server recovers its existing pending invoice", () => {
    const mounted = render(<SubscriptionPayments onUpdated={vi.fn()} />);
    open();
    fireEvent.click(screen.getByRole("checkbox"));
    submit();
    act(() => mocks.error?.({ message: "billingProviderUnavailable" }));
    Object.assign(mocks.data, { pendingInvoice: invoice(), canPurchase: false });
    mounted.rerender(<SubscriptionPayments onUpdated={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("link", { name: "billing.payments.continue" })).toBeTruthy();
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });
  it("requires a refreshed quote and new consent after the server rejects stale terms", () => {
    render(<SubscriptionPayments onUpdated={vi.fn()} />);
    open();
    fireEvent.click(screen.getByRole("checkbox"));
    submit();
    const first = mocks.mutate.mock.calls[0][0];
    act(() => mocks.error?.({ message: "billingQuoteChanged" }));
    submit();
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "billing.payments.refreshQuote" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    open();
    expect(
      (screen.getByRole("button", { name: "billing.payments.goToPayment" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    submit();
    expect(mocks.mutate.mock.calls[1][0].idempotencyKey).not.toBe(first.idempotencyKey);
  });
  it.each(["FAILED", "EXPIRED"])(
    "lets a customer recheck a historical %s invoice if money arrived late",
    (status) => {
      mocks.records = [invoice({ status, checkoutUrl: null })];
      render(
        <TooltipProvider>
          <SubscriptionPayments onUpdated={vi.fn()} />
        </TooltipProvider>,
      );
      const record = within(
        document.querySelector('[data-subscription-invoice="invoice-fixture"]') as HTMLElement,
      );
      const details = document.querySelector(
        '[data-subscription-invoice="invoice-fixture"] details',
      ) as HTMLDetailsElement;
      expect(details.open).toBe(false);
      fireEvent.click(details.querySelector("summary")!);
      expect(details.open).toBe(true);
      const button = record.getByRole("button", { name: "billing.payments.check" });
      expect(button.textContent).toBe("");
      fireEvent.click(button);
      expect(mocks.checkMutate).toHaveBeenCalledWith({ invoiceId: "invoice-fixture" });
      expect(mocks.mutate).not.toHaveBeenCalled();
    },
  );
  it("identifies the GoPay test checkout and freezes the provider and mode with consent", () => {
    const view = render(<SubscriptionPayments onUpdated={vi.fn()} />);
    expect(screen.getByText('billing.payments.sandbox {"provider":"GoPay"}')).toBeTruthy();
    open();
    Object.assign(mocks.data, { provider: "FREEDOMPAY", mode: "live" });
    view.rerender(<SubscriptionPayments onUpdated={vi.fn()} />);
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText('billing.payments.sandbox {"provider":"GoPay"}')).toBeTruthy();
    expect(dialog.getByText("billing.payments.provider")).toBeTruthy();
    expect(dialog.getByText("GoPay")).toBeTruthy();
    expect(dialog.getByText("billing.payments.testPaymentPolicy")).toBeTruthy();
    expect(dialog.queryByText("billing.payments.renewalPolicy")).toBeNull();
  });
  it("uses the invoice provider for a historical FreedomPay checkout after switching to GoPay", () => {
    Object.assign(mocks.data, {
      canPurchase: false,
      pendingInvoice: invoice({ provider: "FREEDOMPAY" }),
    });
    render(<SubscriptionPayments onUpdated={vi.fn()} />);
    const pending = document.querySelector("[data-pending-invoice]") as HTMLElement;
    expect(
      within(pending).getByText('billing.payments.providerDescription {"provider":"FreedomPay"}'),
    ).toBeTruthy();
    expect(
      screen.queryByText('billing.payments.providerDescription {"provider":"GoPay"}'),
    ).toBeNull();
    expect(
      screen.getAllByText('billing.payments.providerDescription {"provider":"FreedomPay"}'),
    ).toHaveLength(1);
    expect(
      screen.getByRole("link", { name: "billing.payments.continue" }).getAttribute("href"),
    ).toBe("https://example.invalid/checkout");
    expect(document.querySelector("[data-checkout-form]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "billing.payments.check" }));
    expect(mocks.checkMutate).toHaveBeenCalledWith({ invoiceId: "invoice-fixture" });
  });
  it("distinguishes test confirmations and history from real paid invoices", () => {
    mocks.records = [
      invoice({ id: "test-gopay", isTest: true, status: "PAID", checkoutUrl: null }),
      invoice({ id: "live-freedompay", provider: "FREEDOMPAY", status: "PAID", checkoutUrl: null }),
    ];
    render(<SubscriptionPayments onUpdated={vi.fn()} />);
    const testRow = within(
      document.querySelector('[data-subscription-invoice="test-gopay"]') as HTMLElement,
    );
    const liveRow = within(
      document.querySelector('[data-subscription-invoice="live-freedompay"]') as HTMLElement,
    );
    for (const id of ["test-gopay", "live-freedompay"]) {
      const details = document.querySelector(
        `[data-subscription-invoice="${id}"] details`,
      ) as HTMLDetailsElement;
      fireEvent.click(details.querySelector("summary")!);
      expect(details.open).toBe(true);
    }
    expect(testRow.getByText("GoPay")).toBeTruthy();
    expect(testRow.getByText("billing.payments.testInvoice")).toBeTruthy();
    expect(testRow.getByText("billing.payments.testPaid")).toBeTruthy();
    expect(testRow.queryByText("billing.payments.statuses.PAID")).toBeNull();
    expect(liveRow.getByText("FreedomPay")).toBeTruthy();
    expect(liveRow.getByText("billing.payments.statuses.PAID")).toBeTruthy();
    expect(liveRow.queryByText("billing.payments.testInvoice")).toBeNull();
    act(() => mocks.checkSuccess?.({ status: "PAID", isTest: true, syncDelayed: false }));
    expect(screen.getByText("billing.payments.testConfirmed")).toBeTruthy();
    expect(screen.queryByText("billing.payments.confirmed")).toBeNull();
    act(() => mocks.checkSuccess?.({ status: "PAID", isTest: false, syncDelayed: false }));
    expect(screen.getByText("billing.payments.confirmed")).toBeTruthy();
  });
  it("preserves delayed and review recovery messages after checking the provider", () => {
    render(<SubscriptionPayments onUpdated={vi.fn()} />);
    act(() => mocks.checkSuccess?.({ status: "PENDING", isTest: true, syncDelayed: true }));
    expect(screen.getByText("billing.payments.checkDelayed")).toBeTruthy();
    act(() => mocks.checkSuccess?.({ status: "REVIEW", isTest: false, syncDelayed: false }));
    expect(screen.getByText("billing.payments.reviewHint")).toBeTruthy();
  });
  it.each([
    ["CREATING", "creatingHint"],
    ["PENDING", "linkUnavailable"],
    ["REVIEW", "reviewHint"],
  ])(
    "explains %s without offering a missing payment link or claiming its expiry",
    (status, hint) => {
      Object.assign(mocks.data, {
        canPurchase: false,
        pendingInvoice: invoice({ status, checkoutUrl: null }),
      });
      render(<SubscriptionPayments onUpdated={vi.fn()} />);
      expect(screen.getByText(`billing.payments.${hint}`)).toBeTruthy();
      expect(screen.queryByText(/^billing.payments.expiresAt/)).toBeNull();
      expect(screen.queryByRole("link", { name: "billing.payments.continue" })).toBeNull();
      expect(screen.getByRole("button", { name: "billing.payments.check" })).toBeTruthy();
      if (status === "REVIEW")
        expect(screen.getByRole("link", { name: "billing.payments.support" })).toBeTruthy();
    },
  );
  it("offers only the reserve pack on Starter and discloses its two additional users", () => {
    Object.assign(mocks.data, { catalogVersion: "2026-11" });
    render(<SubscriptionPayments onUpdated={vi.fn()} />);
    expect(screen.getByText("billing.payments.starterOneStore")).toBeTruthy();
    expect(document.getElementById("subscription-extra-stores")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /billing.payments.extraproductPacks/ }));
    open();
    expect(
      within(screen.getByRole("dialog")).getByText(/^billing.payments.extrasSummary/).textContent,
    ).toContain('"products":1000,"users":2');
  });
  it("requires consent and freezes the quoted amount and terms through background updates and failed retries", () => {
    const view = render(<SubscriptionPayments onUpdated={vi.fn()} />);
    open();
    const button = screen.getByRole("button", {
      name: "billing.payments.goToPayment",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    submit();
    expect(mocks.mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(button.disabled).toBe(false);
    const summary = screen.getByRole("dialog").querySelector("[data-subscription-quote]")!;
    const frozenSummary = summary.textContent;
    const terms = within(screen.getByRole("dialog")).getByRole("link", {
      name: "billing.payments.termsLink",
    });
    expect(terms.getAttribute("href")).toBe("https://example.invalid/terms/v1");
    mocks.data.catalog[0].amountMinor = 199900;
    mocks.data.termsVersion = "qa-v2";
    view.rerender(<SubscriptionPayments onUpdated={vi.fn()} />);
    expect(screen.getByRole("dialog").querySelector("[data-subscription-quote]")!.textContent).toBe(
      frozenSummary,
    );
    expect(terms.getAttribute("href")).toBe("https://example.invalid/terms/v1");
    expect(within(screen.getByRole("dialog")).getByText("Synthetic seller")).toBeTruthy();
    submit();
    const first = mocks.mutate.mock.calls[0][0];
    expect(first).toMatchObject({
      expectedAmountMinor: 175000,
      expectedProvider: "GOPAY",
      termsVersion: "qa-v1",
      acceptedTerms: true,
    });
    act(() => mocks.error?.({ message: "billingPaymentsUnavailable" }));
    expect(screen.getByRole("alert").textContent).toBe("errors.billingPaymentsUnavailable");
    submit();
    expect(mocks.mutate.mock.calls[1][0]).toEqual(first);
  });
  it("uses a fresh checkout key after a completed failed invoice, so retrying can create a new attempt", () => {
    render(<SubscriptionPayments onUpdated={vi.fn()} />);
    open();
    fireEvent.click(screen.getByRole("checkbox"));
    submit();
    const first = mocks.mutate.mock.calls[0][0];
    act(() => mocks.success?.({ status: "FAILED", checkoutUrl: null, syncDelayed: false }));
    open();
    fireEvent.click(screen.getByRole("checkbox"));
    submit();
    expect(mocks.mutate.mock.calls[1][0].idempotencyKey).not.toBe(first.idempotencyKey);
  });
  it("keeps the paused-account explanation in checkout without offering another payment", () => {
    Object.assign(mocks.data, { accountPaused: true, canPurchase: false });
    render(<SubscriptionPayments onUpdated={vi.fn()} />);
    expect(screen.getByText("billing.payments.accountPaused")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^billing.payments.pay / })).toBeNull();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it("does not offer collection for manual or unavailable access", () => {
    Object.assign(mocks.data, { billingMode: "MANUAL", canPurchase: false });
    const view = render(<SubscriptionPayments onUpdated={vi.fn()} />);
    expect(screen.getByText("billing.payments.manualAccess")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^billing.payments.pay / })).toBeNull();
    const addons = document.querySelector(
      "details[data-subscription-addons]",
    ) as HTMLDetailsElement;
    expect(addons.open).toBe(false);
    fireEvent.click(addons.querySelector("summary")!);
    expect(addons.open).toBe(true);
    expect(within(addons).getByText("billing.publicPricing.storeExtra")).toBeTruthy();
    expect(within(addons).getByText("billing.publicPricing.reserveExtra")).toBeTruthy();
    expect(screen.getByText("billing.payments.legacyExtras")).toBeTruthy();
    Object.assign(mocks.data, { billingMode: "SELF_SERVE", available: false });
    view.rerender(<SubscriptionPayments onUpdated={vi.fn()} />);
    expect(screen.getByText("billing.trial.paymentUnavailable")).toBeTruthy();
    expect(within(addons).getByText("billing.publicPricing.storeExtra")).toBeTruthy();
    expect(within(addons).getByText("billing.publicPricing.reserveExtra")).toBeTruthy();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
});
