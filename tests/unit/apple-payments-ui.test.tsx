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
  data: {} as Record<string, unknown>,
  products: vi.fn(),
  intent: vi.fn(),
  confirm: vi.fn(),
  restoreBatch: vi.fn(),
  cancel: vi.fn(),
  purchase: vi.fn(),
  finish: vi.fn(),
  restore: vi.fn(),
  history: vi.fn(),
  manage: vi.fn(),
  refund: vi.fn(),
  refetch: vi.fn(),
  updated: vi.fn(),
  webGet: vi.fn(),
}));
vi.mock("@/lib/native/platform", () => ({ getNativePlatform: () => mock.platform }));
vi.mock("@/lib/native/appleBilling", () => ({
  isAppleBillingAvailable: () => mock.nativeReady,
  getAppleProducts: mock.products,
  purchaseAppleProduct: mock.purchase,
  finishAppleTransaction: mock.finish,
  restoreApplePurchases: mock.restore,
  getAppleTransactionHistory: mock.history,
  showAppleSubscriptionManagement: mock.manage,
  requestAppleRefund: mock.refund,
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    billing: {
      apple: {
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
      },
      payments: { get: { useQuery: mock.webGet } },
    },
  },
}));
const receipt = (transactionId = "9007199254740993123") => ({
  transactionId,
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
  fireEvent.click(screen.getByRole("button", { name: /\$19\.99/ }));
  const dialog = within(screen.getByRole("dialog"));
  fireEvent.click(dialog.getByRole("checkbox"));
  return dialog;
};
beforeEach(() => {
  vi.clearAllMocks();
  mock.platform = "ios";
  mock.nativeReady = true;
  mock.data = fixture();
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
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("iOS Apple checkout and recovery", () => {
  it.each(["ru", "kg", "en"] as const)(
    "uses localized Apple prices and explicit organization consent in %s",
    async (locale) => {
      const { container } = mount(locale);
      await screen.findByText(product.displayPrice);
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

  it("releases only a definitively cancelled intent", async () => {
    mock.purchase.mockResolvedValueOnce({ status: "cancelled", cancellationAcknowledged: false, cancellationRecorded: false });
    mount();
    const dialog = await openConsent();
    fireEvent.click(dialog.getByRole("button", { name: ru.billingApple.confirmPurchase }));
    await screen.findByText(ru.billingApple.cancelled);
    expect(mock.cancel).toHaveBeenCalledWith({ intentId: "native-authorized-intent" });
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
    mock.cancel.mockRejectedValueOnce(new Error("network-down"));
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
});
