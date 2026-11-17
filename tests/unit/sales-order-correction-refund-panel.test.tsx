// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CorrectionRefundQueuePanel } from "@/components/sales-order-correction-refund-panel";
import ru from "../../messages/ru.json";

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(async () => true),
  toast: vi.fn(),
  invalidate: vi.fn(async () => undefined),
  mutateAsync: vi.fn<(input: unknown) => Promise<{ status: string }>>(async (_input) => ({
    status: "RESOLVED",
  })),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      salesOrders: {
        getById: { invalidate: mocks.invalidate },
        paymentInfo: { invalidate: mocks.invalidate },
      },
    }),
    salesOrders: {
      resolveCorrectionRefund: {
        useMutation: (options?: {
          onSuccess?: (result: { status: string }) => Promise<void> | void;
          onError?: (error: unknown) => void;
          onSettled?: () => void;
        }) => ({
          isPending: false,
          mutateAsync: async (input: unknown) => {
            try {
              const result = await mocks.mutateAsync(input);
              await options?.onSuccess?.(result as { status: string });
              return result;
            } catch (error) {
              options?.onError?.(error);
              throw error;
            } finally {
              options?.onSettled?.();
            }
          },
        }),
      },
    },
  },
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/components/ui/use-confirm-dialog", () => ({
  useConfirmDialog: () => ({ confirm: mocks.confirm, confirmDialog: null }),
}));

const currency = { currencyCode: "KGS", currencyRateKgsPerUnit: 1 };

const renderPanel = (overrides: Partial<React.ComponentProps<typeof CorrectionRefundQueuePanel>> = {}) =>
  render(
    <NextIntlClientProvider locale="ru" messages={ru} timeZone="Asia/Bishkek">
      <CorrectionRefundQueuePanel
        customerOrderId="order-1"
        request={{
          id: "request-1",
          status: "OPEN",
          amountKgs: "100",
          payment: {
            id: "payment-1",
            settlementStatus: "PENDING",
            amountKgs: "100",
            shiftId: "shift-1",
          },
        }}
        actualRefundedKgs={0}
        pendingRefundKgs={100}
        shifts={[{ id: "shift-1", name: "Main register" }]}
        canManage
        currency={currency}
        {...overrides}
      />
    </NextIntlClientProvider>,
  );

describe("sales order correction refund queue panel", () => {
  beforeEach(() => {
    mocks.confirm.mockClear();
    mocks.confirm.mockResolvedValue(true);
    mocks.toast.mockClear();
    mocks.invalidate.mockClear();
    mocks.mutateAsync.mockClear();
    mocks.mutateAsync.mockResolvedValue({ status: "RESOLVED" });
  });

  it("shows actual and pending amounts separately and offers an explicit payout shift", () => {
    renderPanel();
    expect(screen.getByText("Ожидает выплаты")).toBeTruthy();
    expect(screen.getByText("Фактически возвращено")).toBeTruthy();
    expect(screen.getByText("Ожидает возврата")).toBeTruthy();
    expect(screen.getByLabelText("Смена выплаты")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Подтвердить выплату" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Отменить заявку" })).toBeNull();
    expect(screen.getByText(ru.salesOrders.correctionRefundCannotCancel)).toBeTruthy();
  });

  it("confirms the payout with the selected open shift after a dialog", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить выплату" }));
    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledTimes(1));
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(mocks.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        refundRequestId: "request-1",
        action: "RESOLVED",
        shiftId: "shift-1",
        idempotencyKey: expect.any(String),
      }),
    );
    expect(mocks.invalidate).toHaveBeenCalledTimes(2);
    expect(mocks.toast).toHaveBeenCalledTimes(1);
  });

  it("does not expose cancellation for an accepted return", () => {
    renderPanel();
    expect(screen.queryByRole("button", { name: "Отменить заявку" })).toBeNull();
    expect(screen.getByText(ru.salesOrders.correctionRefundCannotCancel)).toBeTruthy();
  });

  it("renders resolved requests without actions", () => {
    renderPanel({
      request: {
        id: "request-1",
        status: "RESOLVED",
        amountKgs: "100",
        reviewedAt: "2026-11-17T10:00:00.000Z",
        reviewedBy: { id: "user-1", name: "Manager" },
        payment: {
          id: "payment-1",
          settlementStatus: "ACTUAL",
          amountKgs: "100",
          shiftId: "shift-1",
        },
      },
      actualRefundedKgs: 100,
      pendingRefundKgs: 0,
    });
    expect(screen.getByText("Выплачено")).toBeTruthy();
    expect(screen.getByText("Проверил: Manager")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("keeps non-managers read-only while the request is open", () => {
    renderPanel({ canManage: false });
    expect(screen.getByText(/только руководитель/i)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders a read-only limitation for an open request without a matching pending payment", () => {
    renderPanel({
      request: {
        id: "request-legacy",
        status: "OPEN",
        amountKgs: "100",
        payment: null,
      },
    });
    expect(screen.getByTestId("correction-refund-unavailable").textContent).toContain(
      "У заявки нет связанного ожидающего платежа",
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders a read-only limitation when the pending payment amount does not match", () => {
    renderPanel({
      request: {
        id: "request-mismatch",
        status: "OPEN",
        amountKgs: "100",
        payment: {
          id: "payment-mismatch",
          settlementStatus: "PENDING",
          amountKgs: "50",
          shiftId: "shift-1",
        },
      },
    });
    expect(screen.getByTestId("correction-refund-unavailable").textContent).toContain(
      "У заявки нет связанного ожидающего платежа",
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("retries with the same idempotency key and refetches after an error", async () => {
    mocks.mutateAsync
      .mockRejectedValueOnce(new Error("requestInProgress"))
      .mockResolvedValueOnce({ status: "RESOLVED" });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить выплату" }));
    expect((await screen.findByRole("alert")).textContent).toContain("уже выполняется");
    expect(mocks.invalidate).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить выплату" }));
    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledTimes(2));
    const [first, second] = mocks.mutateAsync.mock.calls;
    expect(first?.[0]).toMatchObject({ idempotencyKey: expect.any(String) });
    expect(second?.[0]).toMatchObject({
      idempotencyKey: (first?.[0] as { idempotencyKey: string }).idempotencyKey,
    });
  });

  it("shows a translated error when confirmation is rejected", async () => {
    mocks.mutateAsync.mockRejectedValue(new Error("salesOrderCorrectionRefundNotOpen"));
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить выплату" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Заявка на возврат уже не открыта. Обновите продажу.",
    );
  });
});
