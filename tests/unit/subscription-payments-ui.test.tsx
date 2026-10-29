// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubscriptionPayments } from "@/components/billing/subscription-payments";

const mocks = vi.hoisted(() => ({
  data: {
    available: true,
    mode: "sandbox",
    billingMode: "SELF_SERVE",
    accountPaused: false,
    canPurchase: true,
    currentPlan: "STARTER",
    mayChangePlan: true,
    catalog: [{ plan: "STARTER", amountMinor: 175000 }],
    sellerName: "Synthetic seller",
    termsVersion: "qa-v1",
    termsUrl: "https://example.invalid/terms/v1",
    pendingInvoice: null,
  },
  mutate: vi.fn(),
  refetch: vi.fn(),
  success: null as
    | null
    | ((invoice: { status: string; checkoutUrl: null; syncDelayed: boolean }) => void),
  error: null as null | ((error: { message: string }) => void),
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
        invoices: {
          useInfiniteQuery: () => ({
            data: { pages: [{ items: [] }] },
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
        check: { useMutation: () => ({ mutate: vi.fn(), isLoading: false }) },
      },
    },
  },
}));
const open = () => fireEvent.click(screen.getByRole("button", { name: /^billing.payments.pay / }));
const submit = () => fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
beforeEach(() => {
  vi.clearAllMocks();
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
    billingMode: "SELF_SERVE",
    canPurchase: true,
    termsVersion: "qa-v1",
    catalog: [{ plan: "STARTER", amountMinor: 175000 }],
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("subscription payment consent and recovery", () => {
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
    Object.assign(mocks.data, { billingMode: "SELF_SERVE", available: false });
    view.rerender(<SubscriptionPayments onUpdated={vi.fn()} />);
    expect(screen.getByText("billing.payments.unavailable")).toBeTruthy();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
});
