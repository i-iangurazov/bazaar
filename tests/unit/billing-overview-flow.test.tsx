// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ru from "../../messages/ru.json";
import kg from "../../messages/kg.json";
import en from "../../messages/en.json";
import {
  createBillingUiFixture,
  billingUiNow,
  billingUiTrialEnd,
  billingUiPaidEnd,
  type BillingUiState,
} from "../helpers/billingUiFixture";
import { formatCurrencyKGS, formatDateTime, formatNumber } from "@/lib/i18nFormat";
import { TooltipProvider } from "@/components/ui/tooltip";

const mock = vi.hoisted(() => ({ checkout: vi.fn(), check: vi.fn(), refetch: vi.fn() }));
let model = createBillingUiFixture();
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    status: "authenticated",
    data: { user: { role: "ADMIN", organizationId: "synthetic-billing-ui" } },
  }),
}));
vi.mock("@/components/page-breadcrumbs", () => ({ PageBreadcrumbs: () => null }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/trpc", () => {
  const query = (data: unknown) => ({
    data,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: mock.refetch,
  });
  return {
    trpc: {
      billing: {
        get: { useQuery: () => query(model.summary) },
        usage: { useQuery: () => query(model.usage) },
        requestUpgrade: { useMutation: () => ({ mutate: vi.fn(), isLoading: false }) },
        payments: {
          get: { useQuery: () => query(model.payment) },
          quote: {
            useQuery: (input: Parameters<typeof model.quote>[0]) => query(model.quote(input)),
          },
          invoices: {
            useInfiniteQuery: () => ({
              ...query({ pages: [{ items: model.invoices }] }),
              hasNextPage: false,
            }),
          },
          checkout: { useMutation: () => ({ mutate: mock.checkout, isLoading: false }) },
          check: { useMutation: () => ({ mutate: mock.check, isLoading: false }) },
        },
      },
    },
  };
});
import BillingPage from "@/app/(app)/billing/page";
const messages = { ru, kg, en };
const originalScrollIntoView = Element.prototype.scrollIntoView;
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(billingUiNow);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  model = createBillingUiFixture();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Element.prototype.scrollIntoView = originalScrollIntoView;
});
const mount = (locale: keyof typeof messages = "ru", state: BillingUiState = "paidTrial") => {
  model = createBillingUiFixture(state);
  return render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone="Asia/Bishkek">
      <TooltipProvider>
        <BillingPage />
      </TooltipProvider>
    </NextIntlClientProvider>,
  );
};

describe("complete billing workspace disclosures", () => {
  it.each(["ru", "kg", "en"] as const)(
    "distinguishes current trial from the future paid plan and retains details in %s",
    (locale) => {
      const { container } = mount(locale);
      const t = createTranslator({ locale, messages: messages[locale], namespace: "billing" });
      const overview = container.querySelector("[data-subscription-overview]")!;
      expect(
        within(overview as HTMLElement).getByText(messages[locale].billing.plans.trial),
      ).toBeTruthy();
      expect(overview.querySelector("[data-current-trial-end]")?.textContent).toBe(
        t("trialEndsAt", { date: formatDateTime(billingUiTrialEnd, locale) }),
      );
      expect(overview.querySelector("[data-current-subscription-end]")?.textContent).toBe(
        t("accessEndsAt", { date: formatDateTime(billingUiPaidEnd, locale) }),
      );
      const used = Array.from(overview.querySelectorAll("dd")).map((row) =>
        row.textContent?.replace(/\s/g, ""),
      );
      expect(used).toEqual(["1/1", `37/${formatNumber(1000, locale)}`.replace(/\s/g, ""), "1/2"]);
      const scheduled = container.querySelector("[data-scheduled-subscription]")!;
      expect(scheduled.closest("details:not([open])")).toBeNull();
      expect(scheduled.textContent).toContain(
        t("payments.scheduledDescription", {
          plan: messages[locale].billing.plans.starter.name,
          start: formatDateTime(billingUiTrialEnd, locale),
          end: formatDateTime(billingUiPaidEnd, locale),
        }),
      );
      expect(screen.getAllByText(messages[locale].billing.trial.scope)).toHaveLength(1);
      const trialNotice = container.querySelector(
        '[data-subscription-access-notice="trial"]',
      ) as HTMLElement;
      expect(trialNotice.closest("details")).toBeNull();
      expect(trialNotice.textContent).toContain(formatDateTime(billingUiTrialEnd, locale));
      expect(trialNotice.textContent).not.toContain(messages[locale].billing.trial.scope);
      const scope = screen.getByText(messages[locale].billing.trial.scope);
      const currentFeatures = container.querySelector(
        "[data-current-subscription-features]",
      ) as HTMLDetailsElement;
      expect(scope.closest("details")).toBe(currentFeatures);
      expect(currentFeatures.open).toBe(false);
      expect(
        screen.getAllByRole("link", { name: messages[locale].billing.payments.choosePlan }),
      ).toHaveLength(3);
      for (const selector of [
        "[data-current-subscription-features]",
        "[data-billing-comparison]",
        "[data-subscription-usage-details]",
        "[data-subscription-addons]",
      ]) {
        const details = container.querySelector(selector) as HTMLDetailsElement;
        expect(details.tagName).toBe("DETAILS");
        expect(details.open).toBe(false);
        fireEvent.click(details.querySelector("summary")!);
        expect(details.open).toBe(true);
      }
      expect(currentFeatures.open).toBe(true);
      expect(currentFeatures.contains(scope)).toBe(true);
      expect(container.querySelector("[data-billing-comparison] table")).not.toBeNull();
      expect(
        within(
          container.querySelector("[data-subscription-usage-details]") as HTMLElement,
        ).getByText("8 / 100"),
      ).toBeTruthy();
      const quote = container.querySelector("[data-subscription-quote]")!;
      expect(quote.querySelector("[data-subscription-amount-due]")?.closest("details")).toBeNull();
      expect(
        quote.querySelector("[data-subscription-selected-limits]")?.closest("details"),
      ).toBeNull();
      expect(quote.textContent).toContain(formatCurrencyKGS(2000, locale));
      expect(
        quote.textContent?.split(messages[locale].billing.payments.noAutomaticCharges),
      ).toHaveLength(2);
      expect(mock.checkout).not.toHaveBeenCalled();
    },
  );

  it("shows one complete consent with the saved financial terms after the remaining trial and paid tail", () => {
    const { container } = mount();
    fireEvent.click(
      within(container.querySelector("[data-checkout-form]") as HTMLElement).getByRole("button"),
    );
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText(ru.billing.plans.starter.name)).toBeTruthy();
    expect(dialog.getByText(ru.billing.payments.term1)).toBeTruthy();
    expect(dialog.getByText(ru.billing.payments.renewalPolicy)).toBeTruthy();
    expect(
      screen.getByRole("dialog").querySelectorAll("[data-subscription-amount-due]"),
    ).toHaveLength(1);
    expect(screen.getByRole("dialog").textContent).toContain(
      formatDateTime(billingUiPaidEnd, "ru"),
    );
    const confirm = dialog.getByRole("button", {
      name: ru.billing.payments.goToPayment,
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(mock.checkout).not.toHaveBeenCalled();
  });

  it.each(["expiredTrial", "expiredPaid"] as const)(
    "keeps renewal and history available for %s without promising active operational access",
    (state) => {
      const { container } = mount("ru", state);
      expect(container.querySelector("[data-checkout-form]")).not.toBeNull();
      expect(screen.getByRole("region", { name: ru.billing.payments.history })).toBeTruthy();
      expect(screen.queryByText(ru.billing.subscriptionActive)).toBeNull();
      expect(mock.checkout).not.toHaveBeenCalled();
    },
  );
});
