// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubscriptionPayments } from "@/components/billing/subscription-payments";

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
  },
  records: [] as InvoiceFixture[],
  mutate: vi.fn(),
  checkMutate: vi.fn(),
  refetch: vi.fn(),
  success: null as
    | null
    | ((invoice: { status: string; checkoutUrl: null; syncDelayed: boolean }) => void),
  error: null as null | ((error: { message: string }) => void),
  checkSuccess: null as null | ((invoice: { status: string; isTest: boolean; syncDelayed: boolean }) => void),
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
          useQuery: (input: { plan: string; months: number; extras: { stores: number; productPacks: number; userPacks: number }; action: string }) => ({
            data: {
              plan: input.plan, months: input.months, extras: input.extras,
              amountMinor: mocks.data.catalog.find((p) => p.plan === input.plan)?.amountMinor ?? 0,
              quoteToken: `quote:${input.plan}:${mocks.data.catalog[0].amountMinor}:${input.months}:${JSON.stringify(input.extras)}`,
              startsAt: "2027-01-01T00:00:00.000Z", endsAt: "2027-02-01T00:00:00.000Z",
              creditMinor: 0, discountBps: 0, kind: input.action === "CHANGE" ? "UPGRADE" : "RENEWAL",
            }, isFetching: false, isError: false, refetch: mocks.refetch,
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
        check: { useMutation: (options: { onSuccess: typeof mocks.checkSuccess }) => {
          mocks.checkSuccess = options.onSuccess;
          return { mutate: mocks.checkMutate, isLoading: false };
        } },
      },
    },
  },
}));
const open = () => fireEvent.click(screen.getByRole("button", { name: /^billing.payments.pay / }));
const submit = () => fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
const invoice = (overrides: Partial<InvoiceFixture> = {}): InvoiceFixture => ({
  id: "invoice-fixture", provider: "GOPAY", isTest: false, plan: "STARTER", amountMinor: 200000,
  currency: "KGS", status: "PENDING", createdAt: "2026-11-09T00:00:00.000Z", paidAt: null,
  expiresAt: "2029-11-09T00:00:00.000Z", checkoutUrl: "https://example.invalid/checkout",
  syncDelayed: false, period: null, purchase: null, sellerName: "Synthetic seller",
  termsVersion: "qa-v1", termsUrl: "https://example.invalid/terms/v1", ...overrides,
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.records = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.assign(mocks.data, {
    available: true,
    mode: "sandbox",
    provider: "GOPAY",
    billingMode: "SELF_SERVE",
    accountPaused: false,
    lifetimeAccess: false,
    canPurchase: true,
    pendingInvoice: null,
    catalogVersion: "2026-10",
    termsVersion: "qa-v1",
    catalog: [{ plan: "STARTER", amountMinor: 175000 }],
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("subscription payment consent and recovery", () => {
  it("identifies the GoPay test checkout and freezes the provider and mode with consent", () => {
    const view = render(<SubscriptionPayments onUpdated={vi.fn()} />);
    expect(screen.getByText('billing.payments.sandbox {"provider":"GoPay"}')).toBeTruthy();
    expect(screen.getByText('billing.payments.description {"provider":"GoPay"}')).toBeTruthy();
    open();
    Object.assign(mocks.data, { provider: "FREEDOMPAY", mode: "live" });
    view.rerender(<SubscriptionPayments onUpdated={vi.fn()} />);
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText('billing.payments.sandbox {"provider":"GoPay"}')).toBeTruthy();
    expect(dialog.getByText('billing.payments.providerDescription {"provider":"GoPay"}')).toBeTruthy();
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
    expect(within(pending).getByText('billing.payments.providerDescription {"provider":"FreedomPay"}')).toBeTruthy();
    expect(screen.getByRole("link", { name: "billing.payments.continue" }).getAttribute("href"))
      .toBe("https://example.invalid/checkout");
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
    const testRow = within(document.querySelector('[data-subscription-invoice="test-gopay"]') as HTMLElement);
    const liveRow = within(document.querySelector('[data-subscription-invoice="live-freedompay"]') as HTMLElement);
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
  ])("explains %s without offering a missing payment link or claiming its expiry", (status, hint) => {
    Object.assign(mocks.data, { canPurchase: false, pendingInvoice: invoice({ status, checkoutUrl: null }) });
    render(<SubscriptionPayments onUpdated={vi.fn()} />);
    expect(screen.getByText(`billing.payments.${hint}`)).toBeTruthy();
    expect(screen.queryByText(/^billing.payments.expiresAt/)).toBeNull();
    expect(screen.queryByRole("link", { name: "billing.payments.continue" })).toBeNull();
    expect(screen.getByRole("button", { name: "billing.payments.check" })).toBeTruthy();
    if (status === "REVIEW") expect(screen.getByRole("link", { name: "billing.payments.support" })).toBeTruthy();
  });
  it("offers only the reserve pack on Starter and discloses its two additional users", () => {
    Object.assign(mocks.data, { catalogVersion: "2026-11" });
    render(<SubscriptionPayments onUpdated={vi.fn()} />);
    expect(screen.getByText("billing.payments.starterOneStore")).toBeTruthy();
    expect(document.getElementById("subscription-extra-stores")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /billing.payments.extraproductPacks/ }));
    open();
    expect(screen.getByText(/^billing.payments.extrasSummary/).textContent)
      .toContain('"products":1000,"users":2');
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
    const description = screen.getByText(/^billing.payments.confirmDescription/).textContent;
    mocks.data.catalog[0].amountMinor = 199900;
    mocks.data.termsVersion = "qa-v2";
    view.rerender(<SubscriptionPayments onUpdated={vi.fn()} />);
    expect(screen.getByText(/^billing.payments.confirmDescription/).textContent).toBe(description);
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
  it("does not offer collection for manual or unavailable access", () => {
    Object.assign(mocks.data, { billingMode: "MANUAL", canPurchase: false });
    const view = render(<SubscriptionPayments onUpdated={vi.fn()} />);
    expect(screen.getByText("billing.payments.manualAccess")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^billing.payments.pay / })).toBeNull();
    expect(document.querySelectorAll("[data-subscription-addons] [data-addon]")).toHaveLength(2);
    expect(screen.getByText("billing.payments.legacyExtras")).toBeTruthy();
    Object.assign(mocks.data, { billingMode: "SELF_SERVE", available: false });
    view.rerender(<SubscriptionPayments onUpdated={vi.fn()} />);
    expect(screen.getByText("billing.payments.unavailable")).toBeTruthy();
    expect(document.querySelectorAll("[data-subscription-addons] [data-addon]")).toHaveLength(2);
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
});
