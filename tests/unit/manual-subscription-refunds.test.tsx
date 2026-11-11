// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../messages/en.json";
import { ManualSubscriptionRefunds } from "@/components/billing/manual-subscription-refunds";

const fixture = () => ({
  invoiceId: "invoice-manual-refund",
  orderId: "b".repeat(32),
  organization: { id: "synthetic-org", name: "Synthetic merchant" },
  plan: "BUSINESS",
  period: { startsAt: new Date("2026-11-10T00:00:00Z"), endsAt: new Date("2026-12-10T00:00:00Z") },
  amountMinor: 200000,
  currency: "KGS",
  paidAt: new Date("2026-11-10T00:00:00Z"),
  refundedMinor: 0,
  remainingRefundableMinor: 200000,
  refunds: [],
});
const mock = vi.hoisted(() => ({
  query: vi.fn(),
  mutate: vi.fn(),
  refetch: vi.fn(),
  setData: vi.fn(),
  reset: vi.fn(),
  onRecorded: vi.fn(),
  data: null as unknown,
  error: null as Error | null,
  options: null as null | {
    onError: (error: Error) => void;
    onSuccess: (invoice: unknown) => void;
  },
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ platformOwner: { refundInvoice: { setData: mock.setData } } }),
    platformOwner: {
      refundInvoice: {
        useQuery: (input: unknown, options: unknown) => {
          mock.query(input, options);
          return { data: mock.data, error: mock.error, isFetching: false, refetch: mock.refetch };
        },
      },
      recordManualRefund: {
        useMutation: (options: typeof mock.options) => {
          mock.options = options;
          return { mutate: mock.mutate, reset: mock.reset, isLoading: false };
        },
      },
    },
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  mock.data = fixture();
  mock.error = null;
  mock.options = null;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("crypto", {
    randomUUID: vi
      .fn()
      .mockReturnValueOnce("a1111111-1111-4111-8111-111111111111")
      .mockReturnValue("b2222222-2222-4222-8222-222222222222"),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const mount = (enabled = true) =>
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Bishkek">
      <ManualSubscriptionRefunds enabled={enabled} onRecorded={mock.onRecorded} />
    </NextIntlClientProvider>,
  );
const search = () => {
  fireEvent.change(screen.getByLabelText(en.platformOwner.manualRefunds.orderId), {
    target: { value: "b".repeat(32) },
  });
  fireEvent.click(screen.getByRole("button", { name: en.common.search }));
};
const open = () => {
  search();
  fireEvent.click(
    screen.getByRole("button", { name: en.platformOwner.manualRefunds.recordAction }),
  );
  return screen.getByRole("dialog", { name: en.platformOwner.manualRefunds.recordAction });
};
const fill = (dialog: HTMLElement, amount = "68,50") => {
  fireEvent.change(within(dialog).getByLabelText(en.platformOwner.manualRefunds.amount), {
    target: { value: amount },
  });
  fireEvent.change(within(dialog).getByLabelText(en.platformOwner.manualRefunds.bankOperationId), {
    target: { value: "BANK-20261111-001" },
  });
  fireEvent.change(
    within(dialog).getByLabelText(en.platformOwner.manualRefunds.bankTransferredOn),
    { target: { value: "2026-11-11" } },
  );
  fireEvent.change(within(dialog).getByLabelText(en.platformOwner.manualRefunds.reason), {
    target: { value: "Agreed unused period refund" },
  });
};
describe("recording a completed bank refund", () => {
  it("does not enable a lookup on mount or while typing", () => {
    mount();
    expect(mock.query.mock.calls.every(([, options]) => !options.enabled)).toBe(true);
    fireEvent.change(screen.getByLabelText(en.platformOwner.manualRefunds.orderId), {
      target: { value: "b".repeat(32) },
    });
    expect(mock.query.mock.calls.every(([, options]) => !options.enabled)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: en.common.search }));
    expect(mock.query).toHaveBeenLastCalledWith(
      { orderId: "b".repeat(32) },
      expect.objectContaining({ enabled: true, retry: false }),
    );
  });
  it("does not expose the tool for a disabled role", () => {
    mount(false);
    expect(screen.queryByText(en.platformOwner.manualRefunds.title)).toBeNull();
    expect(mock.query.mock.calls.every(([, options]) => !options.enabled)).toBe(true);
  });
  it("requires explicit bank-document attestation and never rounds a three-decimal draft", () => {
    mount();
    const dialog = open();
    fill(dialog, "68,505");
    expect(
      (within(dialog).getByLabelText(en.platformOwner.manualRefunds.amount) as HTMLInputElement)
        .value,
    ).toBe("68,505");
    expect(within(dialog).getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
    fireEvent.click(within(dialog).getByRole("checkbox"));
    const submit = within(dialog).getByRole("button", {
      name: en.platformOwner.manualRefunds.recordAction,
    });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(submit);
    expect(mock.mutate).not.toHaveBeenCalled();
  });
  it("retries the identical bank record with the same UUID after an ambiguous failure", () => {
    mount();
    const dialog = open();
    fill(dialog);
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(
      within(dialog).getByRole("button", { name: en.platformOwner.manualRefunds.recordAction }),
    );
    expect(mock.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        amountMinor: 6850,
        bankTransferredOn: "2026-11-11",
        confirmed: true,
        idempotencyKey: "a1111111-1111-4111-8111-111111111111",
      }),
    );
    const first = mock.mutate.mock.calls[0][0];
    act(() => mock.options!.onError(new Error("genericMessage")));
    expect(
      (within(dialog).getByLabelText(en.platformOwner.manualRefunds.amount) as HTMLInputElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(
      within(dialog).getByRole("button", { name: en.platformOwner.manualRefunds.retryRecord }),
    );
    expect(mock.mutate).toHaveBeenCalledTimes(2);
    expect(mock.mutate.mock.calls[1][0]).toEqual(first);
    act(() => mock.options!.onSuccess(fixture()));
    expect(mock.onRecorded).toHaveBeenCalledOnce();
    expect(mock.setData).toHaveBeenCalledWith(
      { orderId: "b".repeat(32) },
      expect.objectContaining({ invoiceId: "invoice-manual-refund" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("shows a recoverable lookup error rather than an empty success", () => {
    mock.data = null;
    mock.error = new Error("billingManualRefundInvoiceNotFound");
    mount();
    search();
    expect(screen.getByRole("alert").textContent).toContain(
      en.errors.billingManualRefundInvoiceNotFound,
    );
    fireEvent.click(screen.getByRole("button", { name: en.common.tryAgain }));
    expect(mock.refetch).toHaveBeenCalledOnce();
  });
  it("blocks another record when the payment is fully refunded", () => {
    mock.data = { ...fixture(), refundedMinor: 200000, remainingRefundableMinor: 0 };
    mount();
    search();
    expect(screen.getByText(en.platformOwner.manualRefunds.full)).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: en.platformOwner.manualRefunds.recordAction,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
