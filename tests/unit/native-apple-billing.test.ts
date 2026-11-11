import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  getProducts: vi.fn(),
  purchase: vi.fn(),
  retryCancellations: vi.fn(),
  getUnfinishedTransactions: vi.fn(),
  getTransactionHistory: vi.fn(),
  restorePurchases: vi.fn(),
  finishTransaction: vi.fn(),
  showManageSubscriptions: vi.fn(),
  requestRefund: vi.fn(),
  addListener: vi.fn(),
}));
const platform = vi.hoisted(() => ({ isIOS: vi.fn(), isPluginAvailable: vi.fn() }));

vi.mock("@capacitor/core", () => ({ registerPlugin: () => native }));
vi.mock("@/lib/native/platform", () => platform);

import {
  addAppleTransactionListener,
  AppleBillingError,
  finishAppleTransaction,
  getAppleProducts,
  getAppleTransactionHistory,
  getUnfinishedAppleTransactions,
  isAppleBillingAvailable,
  purchaseAppleProduct,
  requestAppleRefund,
  restoreApplePurchases,
  retryAppleCancellations,
  showAppleSubscriptionManagement,
  type AppleSignedTransaction,
} from "@/lib/native/appleBilling";

const transaction: AppleSignedTransaction = {
  transactionId: "18446744073709551614",
  originalTransactionId: "18446744073709551613",
  productId: "kg.bazaar.testing.monthly",
  signedTransactionInfo: "test-only.signed.evidence",
  purchaseDate: "2026-11-11T00:00:00Z",
  ownershipType: "PURCHASED",
  isUpgraded: false,
};

beforeEach(() => {
  vi.resetAllMocks();
  platform.isIOS.mockReturnValue(true);
  platform.isPluginAvailable.mockReturnValue(true);
});

describe("Apple native billing boundary", () => {
  it("requires both iOS and the installed native plugin for every operation", async () => {
    platform.isIOS.mockReturnValue(false);
    expect(isAppleBillingAvailable()).toBe(false);
    await expect(purchaseAppleProduct("intent")).rejects.toMatchObject({ code: "APPLE_BILLING_UNAVAILABLE" });
    expect(native.purchase).not.toHaveBeenCalled();
    platform.isIOS.mockReturnValue(true);
    platform.isPluginAvailable.mockReturnValue(false);
    await expect(getAppleProducts([transaction.productId])).rejects.toBeInstanceOf(AppleBillingError);
    await expect(finishAppleTransaction(transaction.transactionId)).rejects.toMatchObject({ code: "APPLE_BILLING_UNAVAILABLE" });
    await expect(retryAppleCancellations()).rejects.toMatchObject({ code: "APPLE_BILLING_UNAVAILABLE" });
    expect(native.getProducts).not.toHaveBeenCalled();
    expect(native.finishTransaction).not.toHaveBeenCalled();
    expect(native.retryCancellations).not.toHaveBeenCalled();
  });

  it("preserves Apple's localized display price and decimal metadata", async () => {
    const products = { products: [{ id: transaction.productId, displayPrice: "$9.99", price: "9.99", currencyCode: "USD" }], missingProductIds: [] };
    native.getProducts.mockResolvedValueOnce(products);
    expect(await getAppleProducts([transaction.productId, transaction.productId])).toEqual(products);
    expect(native.getProducts).toHaveBeenCalledWith({ productIds: [transaction.productId] });
  });

  it("loads the full catalog in bounded sequential batches", async () => {
    const ids = Array.from({ length: 203 }, (_, index) => `kg.bazaar.testing.offer${index}`);
    native.getProducts.mockImplementation(async ({ productIds }: { productIds: string[] }) => ({
      products: productIds.map((id) => ({ id })), missingProductIds: [],
    }));
    const result = await getAppleProducts(ids);
    expect(result.products.map((product) => product.id)).toEqual(ids);
    expect(native.getProducts.mock.calls.map(([argument]) => argument.productIds.length)).toEqual([100, 100, 3]);
  });

  it("sends only the purchase intent and does not finish or grant a native success", async () => {
    native.purchase.mockResolvedValueOnce({ status: "purchased", transaction });
    expect(await purchaseAppleProduct("server-owned-intent")).toEqual({ status: "purchased", transaction });
    expect(native.purchase).toHaveBeenCalledExactlyOnceWith({ intentId: "server-owned-intent" });
    expect(native.finishTransaction).not.toHaveBeenCalled();
    expect(native.restorePurchases).not.toHaveBeenCalled();
  });

  it("preserves durable cancellation acknowledgement and never invents one from an error", async () => {
    native.purchase.mockResolvedValueOnce({ status: "pending" });
    expect(await purchaseAppleProduct("intent")).toEqual({ status: "pending" });
    const waiting = { status: "cancelled", cancellationAcknowledged: false, cancellationRecorded: false };
    native.purchase.mockResolvedValueOnce(waiting);
    expect(await purchaseAppleProduct("intent")).toEqual(waiting);
    const acknowledged = { status: "cancelled", cancellationAcknowledged: true, cancellationRecorded: false };
    native.purchase.mockResolvedValueOnce(acknowledged);
    expect(await purchaseAppleProduct("intent")).toEqual(acknowledged);
    const recorded = { status: "cancelled", cancellationAcknowledged: false, cancellationRecorded: true };
    native.purchase.mockResolvedValueOnce(recorded);
    expect(await purchaseAppleProduct("intent")).toEqual(recorded);
    native.purchase.mockRejectedValueOnce({ code: "APPLE_CANCELLED" });
    await expect(purchaseAppleProduct("intent")).rejects.toMatchObject({ code: "APPLE_CANCELLED" });
    expect(native.finishTransaction).not.toHaveBeenCalled();
  });

  it("retries only the native journal and preserves pending, canceled and recorded counts", async () => {
    const result = { pendingCount: 1, acknowledgedCount: 2, recordedCount: 3 };
    native.retryCancellations.mockResolvedValueOnce(result);
    await expect(retryAppleCancellations()).resolves.toEqual(result);
    expect(native.retryCancellations).toHaveBeenCalledExactlyOnceWith();
    expect(native.purchase).not.toHaveBeenCalled();
    expect(native.finishTransaction).not.toHaveBeenCalled();
    expect(native.restorePurchases).not.toHaveBeenCalled();
    native.retryCancellations.mockRejectedValueOnce({ code: "APPLE_CANCELLATION_STORAGE_FAILED" });
    await expect(retryAppleCancellations()).rejects.toMatchObject({ code: "APPLE_CANCELLATION_STORAGE_FAILED" });
  });

  it("keeps a caught pre-SDK abort distinct from App Store cancellation and recorded money", async () => {
    const notStarted = {
      status: "not_started", cancellationAcknowledged: false, cancellationRecorded: false,
      error: { code: "APPLE_NETWORK_ERROR" },
    };
    native.purchase.mockResolvedValueOnce(notStarted);
    expect(await purchaseAppleProduct("intent-with-lost-auth-response")).toEqual(notStarted);
    expect(native.purchase).toHaveBeenCalledWith({ intentId: "intent-with-lost-auth-response" });
    const recorded = {
      ...notStarted, cancellationRecorded: true,
      error: { code: "APPLE_BILLING_CONFLICT", serverCode: "applePurchasePendingVerification" },
    };
    native.purchase.mockResolvedValueOnce(recorded);
    expect(await purchaseAppleProduct("intent-recorded-elsewhere")).toEqual(recorded);
    native.purchase.mockRejectedValueOnce({ code: "APPLE_NETWORK_ERROR" });
    await expect(purchaseAppleProduct("unknown-sdk-outcome")).rejects.toMatchObject({ code: "APPLE_NETWORK_ERROR" });
    expect(native.finishTransaction).not.toHaveBeenCalled();
    expect(native.restorePurchases).not.toHaveBeenCalled();
    expect(native.retryCancellations).not.toHaveBeenCalled();
  });

  it("preserves exact transaction IDs and server refusal for later recovery", async () => {
    native.finishTransaction.mockRejectedValueOnce({ code: "APPLE_BILLING_CONFLICT", data: { serverCode: "billingAppleTransactionNeedsReview" } });
    await expect(finishAppleTransaction(transaction.transactionId)).rejects.toMatchObject({
      code: "APPLE_BILLING_CONFLICT", serverCode: "billingAppleTransactionNeedsReview",
    });
    expect(native.finishTransaction).toHaveBeenCalledExactlyOnceWith({ transactionId: transaction.transactionId });
    native.finishTransaction.mockResolvedValueOnce({ finished: true });
    await expect(finishAppleTransaction(transaction.transactionId)).resolves.toEqual({ finished: true });
  });

  it("recovers unfinished records without Apple login and pages explicit restores without syncing again", async () => {
    const unfinished = { transactions: [transaction], unverifiedTransactionIds: [] };
    native.getUnfinishedTransactions.mockResolvedValueOnce(unfinished);
    expect(await getUnfinishedAppleTransactions()).toEqual(unfinished);
    expect(native.restorePurchases).not.toHaveBeenCalled();
    native.restorePurchases.mockResolvedValueOnce({ ...unfinished, nextCursor: "1794355200000:18446744073709551614" });
    const first = await restoreApplePurchases();
    native.getTransactionHistory.mockResolvedValueOnce({ transactions: [], unverifiedTransactionIds: [], nextCursor: null });
    const second = await getAppleTransactionHistory(first.nextCursor!);
    expect(second.nextCursor).toBeNull();
    expect(native.restorePurchases).toHaveBeenCalledTimes(1);
    expect(native.getTransactionHistory).toHaveBeenCalledWith({ cursor: first.nextCursor });
    expect(native.finishTransaction).not.toHaveBeenCalled();
  });

  it("surfaces transaction updates and verification failures without acknowledging them", async () => {
    const listener = vi.fn();
    const handle = { remove: vi.fn() };
    native.addListener.mockImplementationOnce(async (_event, callback) => {
      callback({ transaction });
      callback({ error: { code: "APPLE_UNVERIFIED_TRANSACTION" } });
      return handle;
    });
    expect(await addAppleTransactionListener(listener)).toBe(handle);
    expect(native.addListener).toHaveBeenCalledWith("transactionUpdated", listener);
    expect(listener).toHaveBeenNthCalledWith(1, { transaction });
    expect(listener).toHaveBeenNthCalledWith(2, { error: { code: "APPLE_UNVERIFIED_TRANSACTION" } });
    expect(native.finishTransaction).not.toHaveBeenCalled();
  });

  it("uses Apple's management and refund flows without treating a request as a refund", async () => {
    native.showManageSubscriptions.mockResolvedValueOnce(undefined);
    await showAppleSubscriptionManagement();
    native.requestRefund.mockResolvedValueOnce({ status: "submitted" });
    expect(await requestAppleRefund(transaction.transactionId)).toEqual({ status: "submitted" });
    expect(native.requestRefund).toHaveBeenCalledWith({ transactionId: transaction.transactionId });
    expect(native.purchase).not.toHaveBeenCalled();
    expect(native.finishTransaction).not.toHaveBeenCalled();
  });
});
