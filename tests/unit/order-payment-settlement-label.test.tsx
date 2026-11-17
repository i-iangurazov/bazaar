// @vitest-environment jsdom

import React from "react";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import { OrderPayment } from "@/components/pos/order-payment";
import { formatKgsMoney, type CurrencySource } from "@/lib/currencyDisplay";
import ru from "../../messages/ru.json";

type PaymentInfo = {
  canReturn: boolean;
  returnLines: never[];
  paidKgs: number;
  actualPaidKgs: number;
  offsetKgs: number;
  hasEvidence: boolean;
  remainingKgs: number;
  canPay: boolean;
  shifts: Array<{ id: string; name: string }>;
};

const paymentInfo: PaymentInfo = {
  canReturn: false,
  returnLines: [],
  paidKgs: 150,
  actualPaidKgs: 50,
  offsetKgs: 100,
  hasEvidence: true,
  remainingKgs: 0,
  canPay: false,
  shifts: [],
};

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { role: "ADMIN" } } }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    salesOrders: {
      paymentInfo: { useQuery: () => ({ data: paymentInfo, error: null }) },
      recordPayment: { useMutation: () => ({ mutate: vi.fn(), isLoading: false, error: null }) },
    },
  },
}));

vi.mock("@/components/pos/order-return", () => ({
  OrderReturn: () => null,
}));

const renderPayment = (currency: CurrencySource) =>
  render(
    <NextIntlClientProvider locale="ru" messages={ru} timeZone="Asia/Bishkek">
      <OrderPayment customerOrderId="order-1" currency={currency} onPaid={() => undefined} />
    </NextIntlClientProvider>,
  );

const kgs = { currencyCode: "KGS", currencyRateKgsPerUnit: 1 };

describe("order payment settlement labels", () => {
  it("shows actual money separately from offset credit and the settled total", () => {
    renderPayment(kgs);
    const money = (value: number) => formatKgsMoney(value, "ru", kgs);
    expect(screen.getByText(/^Получено:/).textContent).toBe(`Получено: ${money(50)}`);
    expect(screen.getByText(/^Зачтено обменом:/).textContent).toBe(
      `Зачтено обменом: ${money(100)}`,
    );
    expect(screen.getByText(/^Всего зачтено:/).textContent).toBe(`Всего зачтено: ${money(150)}`);
    expect(screen.queryByText(`Получено: ${money(150)}`)).toBeNull();
  });

  it("formats settlement amounts in the order currency while keeping the input in KGS", () => {
    const usd = { currencyCode: "USD", currencyRateKgsPerUnit: 87.5 };
    paymentInfo.remainingKgs = 100;
    paymentInfo.canPay = true;
    paymentInfo.shifts = [{ id: "shift-1", name: "Register 1" }];
    try {
      renderPayment(usd);
      const money = (value: number) => formatKgsMoney(value, "ru", usd);
      const received = screen.getByText(/^Получено:/);
      expect(received.textContent).toContain(money(50));
      expect(received.textContent).toContain("$");
      expect(received.textContent).not.toContain("сом");
      expect(screen.getByText(/^Зачтено обменом:/).textContent).toContain(money(100));
      expect(screen.getByText(/^Всего зачтено:/).textContent).toContain(money(150));
      expect(screen.getByText("Сумма, KGS")).toBeTruthy();
    } finally {
      paymentInfo.remainingKgs = 0;
      paymentInfo.canPay = false;
      paymentInfo.shifts = [];
    }
  });
});
