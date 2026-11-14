// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppleTransactionUpdate } from "@/lib/native/appleBilling";
import { ApplePurchaseRecovery } from "@/components/native/apple-purchase-recovery";

const mock = vi.hoisted(() => ({
  status: "authenticated",
  nativeReady: true,
  session: {
    user: { id: "synthetic-admin", organizationId: "synthetic-organization", role: "ADMIN" },
  },
  confirm: vi.fn(),
  retryCancellations: vi.fn(),
  retryCompletions: vi.fn(),
  unfinished: vi.fn(),
  finish: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
  listener: null as ((event: AppleTransactionUpdate) => void) | null,
  queryClient: { invalidateQueries: vi.fn() },
}));

vi.mock("next-auth/react", () => ({ useSession: () => ({ status: mock.status, data: mock.session }) }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => mock.queryClient }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/native/appleBilling", () => ({
  isAppleBillingAvailable: () => mock.nativeReady,
  retryAppleCancellations: mock.retryCancellations,
  retryAppleCompletions: mock.retryCompletions,
  getUnfinishedAppleTransactions: mock.unfinished,
  finishAppleTransaction: mock.finish,
  addAppleTransactionListener: mock.addListener,
}));
vi.mock("@/lib/trpc", () => ({
  trpc: { billing: { apple: { confirm: { useMutation: () => ({ mutateAsync: mock.confirm }) } } } },
}));

const transaction = (id = "9007199254740993123") => ({
  transactionId: id,
  originalTransactionId: id,
  productId: "kg.bazaar.testing.interrupted",
  signedTransactionInfo: `synthetic.${id}.evidence`,
  purchaseDate: "2026-11-11T00:00:00Z",
  ownershipType: "PURCHASED",
  isUpgraded: false,
});
const pending = (...ids: string[]) => ({
  transactions: ids.map((id) => transaction(id)), unverifiedTransactionIds: [],
});

beforeEach(() => {
  vi.resetAllMocks();
  mock.status = "authenticated";
  mock.nativeReady = true;
  mock.session = { user: { id: "synthetic-admin", organizationId: "synthetic-organization", role: "ADMIN" } };
  mock.listener = null;
  mock.confirm.mockResolvedValue({ acknowledged: true, status: "GRANTED" });
  mock.retryCancellations.mockResolvedValue({ pendingCount: 0, acknowledgedCount: 0, recordedCount: 0 });
  mock.retryCompletions.mockResolvedValue({ pendingCount: 0, acknowledgedCount: 0, deferredCount: 0, recordedCount: 0 });
  mock.unfinished.mockResolvedValue(pending());
  mock.finish.mockResolvedValue({ finished: true });
  mock.removeListener.mockResolvedValue(undefined);
  mock.queryClient.invalidateQueries.mockResolvedValue(undefined);
  mock.addListener.mockImplementation(async (listener: (event: AppleTransactionUpdate) => void) => {
    mock.listener = listener;
    return { remove: mock.removeListener };
  });
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("interrupted Apple purchase recovery", () => {
  it("confirms the durable signed evidence before native finish and access refresh", async () => {
    mock.unfinished.mockResolvedValueOnce(pending("paid-before-app-closed"));
    let acknowledge: (() => void) | undefined;
    mock.confirm.mockImplementationOnce(() => new Promise<void>((resolve) => { acknowledge = resolve; }));
    render(<ApplePurchaseRecovery />);
    await waitFor(() => expect(mock.confirm).toHaveBeenCalledWith({
      signedTransactionInfo: transaction("paid-before-app-closed").signedTransactionInfo,
    }));
    expect(mock.finish).not.toHaveBeenCalled();
    expect(mock.queryClient.invalidateQueries).not.toHaveBeenCalled();
    await act(async () => { acknowledge!(); });
    await waitFor(() => expect(mock.finish).toHaveBeenCalledWith("paid-before-app-closed"));
    await waitFor(() => expect(mock.queryClient.invalidateQueries).toHaveBeenCalledTimes(1));
    expect(mock.confirm.mock.invocationCallOrder[0]).toBeLessThan(mock.finish.mock.invocationCallOrder[0]);
    expect(mock.confirm.mock.invocationCallOrder[0]).toBeLessThan(mock.queryClient.invalidateQueries.mock.invocationCallOrder[0]);
  });

  it("never finishes a failed confirmation and continues other receipts", async () => {
    mock.unfinished.mockResolvedValueOnce(pending("other-organization", "valid-organization"));
    mock.confirm.mockRejectedValueOnce(new Error("applePurchaseOrganizationMismatch"));
    render(<ApplePurchaseRecovery />);
    await screen.findByText("recoveryHint");
    expect(mock.confirm).toHaveBeenCalledTimes(2);
    expect(mock.finish.mock.calls).toEqual([["valid-organization"]]);
    expect(mock.queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
  });

  it.each([
    { status: "unauthenticated", role: "ADMIN", nativeReady: true },
    { status: "loading", role: "ADMIN", nativeReady: true },
    { status: "authenticated", role: "MANAGER", nativeReady: true },
    { status: "authenticated", role: "CASHIER", nativeReady: true },
    { status: "authenticated", role: "ADMIN", nativeReady: false },
  ])("does not start session-dependent receipt recovery for $status/$role with native=$nativeReady", async (state) => {
    mock.status = state.status;
    mock.session.user.role = state.role;
    mock.nativeReady = state.nativeReady;
    render(<ApplePurchaseRecovery />);
    await act(async () => {});
    expect(mock.addListener).not.toHaveBeenCalled();
    expect(mock.unfinished).not.toHaveBeenCalled();
    expect(mock.retryCancellations).not.toHaveBeenCalled();
    expect(mock.confirm).not.toHaveBeenCalled();
    expect(mock.finish).not.toHaveBeenCalled();
    expect(mock.retryCompletions).toHaveBeenCalledTimes(state.nativeReady ? 1 : 0);
  });

  it("completes an already-earned cancellation after logout without reading or confirming money", async () => {
    mock.status = "unauthenticated";
    mock.retryCompletions.mockResolvedValueOnce({ pendingCount: 1, acknowledgedCount: 0, deferredCount: 0, recordedCount: 0 });
    render(<ApplePurchaseRecovery />);
    await screen.findByText("completionPending");
    mock.retryCompletions.mockResolvedValueOnce({ pendingCount: 0, acknowledgedCount: 1, deferredCount: 0, recordedCount: 0 });
    await act(async () => { fireEvent(window, new Event("online")); });
    await waitFor(() => expect(screen.queryByText("completionPending")).toBeNull());
    expect(mock.queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(mock.addListener).not.toHaveBeenCalled();
    expect(mock.retryCancellations).not.toHaveBeenCalled();
    expect(mock.unfinished).not.toHaveBeenCalled();
    expect(mock.confirm).not.toHaveBeenCalled();
    expect(mock.finish).not.toHaveBeenCalled();
  });

  it("recovers an earned deferred result after role loss and refreshes authoritative state without granting locally", async () => {
    mock.session.user.role = "STAFF";
    mock.retryCompletions.mockResolvedValueOnce({ pendingCount: 0, acknowledgedCount: 0, deferredCount: 1, recordedCount: 0 });
    render(<ApplePurchaseRecovery />);
    await waitFor(() => expect(mock.queryClient.invalidateQueries).toHaveBeenCalledTimes(1));
    expect(mock.unfinished).not.toHaveBeenCalled();
    expect(mock.confirm).not.toHaveBeenCalled();
    expect(mock.finish).not.toHaveBeenCalled();
    expect(screen.queryByText("completionPending")).toBeNull();
  });

  it("retains a failed signed completion and retries on focus without reopening a purchase", async () => {
    mock.status = "unauthenticated";
    mock.retryCompletions.mockRejectedValueOnce(new Error("APPLE_NETWORK_ERROR"));
    const view = render(<ApplePurchaseRecovery />);
    await screen.findByText("completionPending");
    await act(async () => { fireEvent(window, new Event("focus")); });
    await waitFor(() => expect(screen.queryByText("completionPending")).toBeNull());
    view.unmount();
    const calls = mock.retryCompletions.mock.calls.length;
    await act(async () => { fireEvent(window, new Event("online")); });
    expect(mock.retryCompletions).toHaveBeenCalledTimes(calls);
    expect(mock.unfinished).not.toHaveBeenCalled();
    expect(mock.finish).not.toHaveBeenCalled();
  });

  it("hands a recorded-money completion to normal receipt confirmation before native finish", async () => {
    mock.retryCompletions.mockResolvedValueOnce({ pendingCount: 0, acknowledgedCount: 0, deferredCount: 0, recordedCount: 1 });
    mock.unfinished.mockResolvedValueOnce(pending("later-paid-receipt"));
    let confirm: (() => void) | undefined;
    mock.confirm.mockImplementationOnce(() => new Promise<void>((resolve) => { confirm = resolve; }));
    render(<ApplePurchaseRecovery />);
    await waitFor(() => expect(mock.confirm).toHaveBeenCalledWith({ signedTransactionInfo: transaction("later-paid-receipt").signedTransactionInfo }));
    expect(mock.finish).not.toHaveBeenCalled();
    await act(async () => { confirm!(); });
    await waitFor(() => expect(mock.finish).toHaveBeenCalledWith("later-paid-receipt"));
    expect(mock.confirm.mock.invocationCallOrder[0]).toBeLessThan(mock.finish.mock.invocationCallOrder[0]);
  });

  it("waits offline or hidden and resumes on connectivity, focus and visibility", async () => {
    let online = false;
    let hidden = false;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
    render(<ApplePurchaseRecovery />);
    await act(async () => {});
    expect(mock.unfinished).not.toHaveBeenCalled();
    online = true;
    await act(async () => { fireEvent(window, new Event("online")); });
    expect(mock.unfinished).toHaveBeenCalledTimes(1);
    hidden = true;
    await act(async () => { fireEvent(window, new Event("focus")); });
    expect(mock.unfinished).toHaveBeenCalledTimes(1);
    hidden = false;
    await act(async () => { fireEvent(document, new Event("visibilitychange")); });
    expect(mock.unfinished).toHaveBeenCalledTimes(2);
    await act(async () => { fireEvent(window, new Event("focus")); });
    expect(mock.unfinished).toHaveBeenCalledTimes(3);
  });

  it("retries a refused ACK on focus and does not treat the first attempt as delivered", async () => {
    mock.unfinished.mockResolvedValue(pending("recorded-but-unacknowledged"));
    mock.finish.mockRejectedValueOnce(new Error("APPLE_NETWORK_ERROR"));
    render(<ApplePurchaseRecovery />);
    await screen.findByText("recoveryHint");
    expect(mock.queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    await act(async () => { fireEvent(window, new Event("focus")); });
    await waitFor(() => expect(mock.finish).toHaveBeenCalledTimes(2));
    expect(mock.confirm).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByText("recoveryHint")).toBeNull());
    expect(mock.queryClient.invalidateQueries).toHaveBeenCalledTimes(2);
  });

  it("retries a durably journaled cancellation on resume and only refreshes after server acknowledgement", async () => {
    mock.retryCancellations.mockResolvedValueOnce({ pendingCount: 1, acknowledgedCount: 0, recordedCount: 0 });
    render(<ApplePurchaseRecovery />);
    await screen.findByText("cancellationPending");
    expect(mock.queryClient.invalidateQueries).not.toHaveBeenCalled();
    mock.retryCancellations.mockResolvedValueOnce({ pendingCount: 0, acknowledgedCount: 1, recordedCount: 0 });
    await act(async () => { fireEvent(window, new Event("focus")); });
    await waitFor(() => expect(screen.queryByText("cancellationPending")).toBeNull());
    expect(mock.retryCancellations).toHaveBeenCalledTimes(2);
    expect(mock.queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(mock.confirm).not.toHaveBeenCalled();
    expect(mock.finish).not.toHaveBeenCalled();
  });

  it("continues paid receipt recovery when cancellation acknowledgement is offline", async () => {
    mock.retryCancellations.mockRejectedValueOnce(new Error("APPLE_NETWORK_ERROR"));
    mock.unfinished.mockResolvedValueOnce(pending("paid-alongside-cancelled"));
    render(<ApplePurchaseRecovery />);
    await screen.findByText("recoveryHint");
    expect(screen.queryByText("cancellationPending")).toBeNull();
    expect(mock.confirm).toHaveBeenCalledWith({ signedTransactionInfo: transaction("paid-alongside-cancelled").signedTransactionInfo });
    expect(mock.finish).toHaveBeenCalledWith("paid-alongside-cancelled");
    expect(mock.queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
  });

  it("refreshes recorded-money status without interpreting it as a cancellation or granting locally", async () => {
    mock.retryCancellations.mockResolvedValueOnce({ pendingCount: 0, acknowledgedCount: 0, recordedCount: 1 });
    render(<ApplePurchaseRecovery />);
    await waitFor(() => expect(mock.queryClient.invalidateQueries).toHaveBeenCalledTimes(1));
    expect(mock.unfinished).toHaveBeenCalledTimes(1);
    expect(mock.confirm).not.toHaveBeenCalled();
    expect(mock.finish).not.toHaveBeenCalled();
    expect(screen.queryByText("cancellationPending")).toBeNull();
  });

  it("drains late transaction updates and removes listeners on unmount", async () => {
    const view = render(<ApplePurchaseRecovery />);
    await waitFor(() => expect(mock.listener).not.toBeNull());
    await act(async () => {});
    mock.unfinished.mockResolvedValueOnce(pending("approved-after-pending"));
    await act(async () => { mock.listener!({ transaction: transaction("approved-after-pending") }); });
    await waitFor(() => expect(mock.finish).toHaveBeenCalledWith("approved-after-pending"));
    view.unmount();
    await waitFor(() => expect(mock.removeListener).toHaveBeenCalledTimes(1));
    const calls = mock.unfinished.mock.calls.length;
    await act(async () => {
      fireEvent(window, new Event("focus"));
      fireEvent(window, new Event("online"));
      mock.listener!({ transaction: transaction("after-unmount") });
    });
    expect(mock.unfinished).toHaveBeenCalledTimes(calls);
  });

  it("removes a late listener handle after the component has already unmounted", async () => {
    let registered: ((handle: { remove: typeof mock.removeListener }) => void) | undefined;
    mock.addListener.mockImplementationOnce(() => new Promise((resolve) => { registered = resolve; }));
    const view = render(<ApplePurchaseRecovery />);
    view.unmount();
    await act(async () => { registered!({ remove: mock.removeListener }); });
    expect(mock.removeListener).toHaveBeenCalledTimes(1);
  });

  it("does not finish an obsolete session after confirmation resolves", async () => {
    mock.unfinished.mockResolvedValueOnce(pending("old-admin-session"));
    let acknowledge: (() => void) | undefined;
    mock.confirm.mockImplementationOnce(() => new Promise<void>((resolve) => { acknowledge = resolve; }));
    const view = render(<ApplePurchaseRecovery />);
    await waitFor(() => expect(mock.confirm).toHaveBeenCalledTimes(1));
    mock.session = { user: { id: "synthetic-admin", organizationId: "another-organization", role: "MANAGER" } };
    view.rerender(<ApplePurchaseRecovery />);
    await act(async () => { acknowledge!(); });
    expect(mock.finish).not.toHaveBeenCalled();
    expect(mock.queryClient.invalidateQueries).not.toHaveBeenCalled();
    expect(mock.removeListener).toHaveBeenCalledTimes(1);
  });

  it("surfaces verification failures without submitting or finishing unverified records", async () => {
    mock.unfinished.mockResolvedValueOnce({ transactions: [], unverifiedTransactionIds: ["unverified"] });
    render(<ApplePurchaseRecovery />);
    await screen.findByText("recoveryHint");
    expect(mock.confirm).not.toHaveBeenCalled();
    expect(mock.finish).not.toHaveBeenCalled();
  });
});
