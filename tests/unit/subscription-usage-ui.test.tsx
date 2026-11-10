// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubscriptionUsage } from "@/components/billing/subscription-usage";
import ru from "../../messages/ru.json";
import kg from "../../messages/kg.json";
import en from "../../messages/en.json";

const api = vi.hoisted(() => ({
  rows: [] as Array<{
    resource: string;
    limit: number | null;
    used: number;
    reserved: number;
    remaining: number | null;
    resetsAt: string | null;
  }>,
  loading: false,
  error: false,
  refetch: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    billing: {
      usage: {
        useQuery: () => ({
          data: api.loading || api.error ? undefined : api.rows,
          isLoading: api.loading,
          isError: api.error,
          error: api.error ? { message: "unknown" } : null,
          refetch: api.refetch,
        }),
      },
    },
  },
}));
const view = (locale: "ru" | "kg" | "en" = "ru", trial = false) =>
  render(
    <NextIntlClientProvider
      locale={locale}
      timeZone="Asia/Bishkek"
      messages={{
        billing: { ru, kg, en }[locale].billing,
        common: { ru, kg, en }[locale].common,
        errors: { ru, kg, en }[locale].errors,
      }}
    >
      <SubscriptionUsage trial={trial} />
    </NextIntlClientProvider>,
  );
beforeEach(() => {
  api.rows = [];
  api.error = false;
  api.loading = false;
  api.refetch.mockClear();
});
afterEach(cleanup);

describe("subscription usage visibility", () => {
  it.each(["ru", "kg", "en"] as const)(
    "keeps zero allowances visible with a plan comparison action in %s",
    (locale) => {
      api.rows = [
        {
          resource: "ai",
          limit: 100,
          used: 8,
          reserved: 2,
          remaining: 90,
          resetsAt: "2099-01-01T00:00:00.000Z",
        },
        {
          resource: "images",
          limit: 0,
          used: 0,
          reserved: 0,
          remaining: 0,
          resetsAt: "2099-01-01T00:00:00.000Z",
        },
      ];
      view(locale);
      expect(screen.getByText({ ru, kg, en }[locale].billing.usage.notIncluded)).toBeTruthy();
      expect(
        screen
          .getByRole("link", { name: { ru, kg, en }[locale].billing.usage.viewPlans })
          .getAttribute("href"),
      ).toBe("#plans");
      expect(screen.getByText("8 / 100")).toBeTruthy();
      expect(screen.getByText("90")).toBeTruthy();
    },
  );
  it("uses trial-wide allowance wording and does not promise another allowance after the expired window", () => {
    api.rows = [
      {
        resource: "ai",
        limit: 100,
        used: 100,
        reserved: 0,
        remaining: 0,
        resetsAt: "2020-01-01T00:00:00.000Z",
      },
    ];
    view("ru", true);
    expect(screen.getByText(ru.billing.usage.trialDescription)).toBeTruthy();
    expect(screen.queryByText(ru.billing.usage.description)).toBeNull();
    expect(screen.getByText(ru.billing.usage.periodEnded)).toBeTruthy();
  });
  it("does not show new quota limits for legacy or lifetime unrestricted contracts", () => {
    api.rows = [
      { resource: "ai", limit: null, used: 0, reserved: 0, remaining: null, resetsAt: null },
    ];
    expect(view().container.innerHTML).toBe("");
  });
  it("shows loading and a retryable error without inventing usage amounts", () => {
    api.loading = true;
    const mounted = view();
    expect(screen.getByText(ru.common.loading)).toBeTruthy();
    api.loading = false;
    api.error = true;
    mounted.rerender(
      <NextIntlClientProvider
        locale="ru"
        timeZone="Asia/Bishkek"
        messages={{ billing: ru.billing, common: ru.common, errors: ru.errors }}
      >
        <SubscriptionUsage />
      </NextIntlClientProvider>,
    );
    const retry = screen.getByRole("button");
    fireEvent.click(retry);
    expect(api.refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("0 / 100")).toBeNull();
  });
});
