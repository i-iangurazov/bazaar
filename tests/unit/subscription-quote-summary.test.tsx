// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import {
  SubscriptionQuoteSummary,
  type SubscriptionQuote,
} from "@/components/billing/subscription-quote-summary";
import { createContractTerms } from "@/server/billing/contractTerms";
import { formatCurrencyKGS, formatDateTime } from "@/lib/i18nFormat";
import ru from "../../messages/ru.json";
import kg from "../../messages/kg.json";
import en from "../../messages/en.json";

const quote = (overrides: Partial<SubscriptionQuote> = {}): SubscriptionQuote => ({
  version: 1,
  catalogVersion: "2026-11",
  kind: "RENEWAL",
  plan: "BUSINESS",
  months: 6,
  extras: { stores: 1, productPacks: 1, userPacks: 0 },
  entitlements: {
    ...createContractTerms("2026-11").plans.BUSINESS,
    limits: { maxStores: 2, maxProducts: 6000, maxActiveUsers: 7 },
  },
  monthlyMinor: 500000,
  fullAmountMinor: 3000000,
  termAmountMinor: 2850000,
  amountMinor: 2850000,
  serviceValueMinor: 2850000,
  savingsMinor: 150000,
  discountBps: 500,
  creditMinor: 0,
  effectiveTiming: "NEXT_PERIOD",
  scheduledReduction: false,
  organizationId: "synthetic-org",
  expectedPlan: "BUSINESS",
  expectedPeriodEnd: "2027-01-31T18:00:00.000Z",
  sourcePeriodId: null,
  startsAt: "2027-01-31T18:00:00.000Z",
  endsAt: "2027-07-31T18:00:00.000Z",
  cycleStartsAt: "2027-01-31T18:00:00.000Z",
  cycleEndsAt: "2027-07-31T18:00:00.000Z",
  anchorDay: 31,
  issuedAt: "2027-01-15T12:00:00.000Z",
  expiresAt: "2027-01-15T12:15:00.000Z",
  quoteToken: "synthetic-signed-quote",
  ...overrides,
});
function renderSummary(value: SubscriptionQuote, locale: "ru" | "kg" | "en" = "ru") {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(
    <NextIntlClientProvider
      locale={locale}
      timeZone="Asia/Bishkek"
      messages={{ billing: { ru, kg, en }[locale].billing }}
    >
      <SubscriptionQuoteSummary quote={value} />
    </NextIntlClientProvider>,
  );
  return root;
}

describe("server-calculated subscription order summary", () => {
  it.each(["ru", "kg", "en"] as const)(
    "shows the complete six-month total, saving, access dates and selected limits in %s",
    (locale) => {
      const value = quote();
      const root = renderSummary(value, locale);
      expect(root.querySelector("[data-subscription-amount-due]")?.textContent).toContain(
        formatCurrencyKGS(28500, locale),
      );
      expect(root.querySelector("[data-subscription-amount-due]")?.textContent).not.toMatch(
        /\/(?:мес|ай|month)/,
      );
      expect(root.querySelector("[data-subscription-savings]")?.textContent).toContain(
        formatCurrencyKGS(1500, locale),
      );
      expect(root.textContent).toContain(formatCurrencyKGS(30000, locale));
      expect(root.textContent).toContain(formatDateTime(value.startsAt, locale));
      expect(root.textContent).toContain(formatDateTime(value.endsAt, locale));
      expect(root.querySelector("[data-subscription-selected-limits]")?.textContent).toMatch(
        /2.*6000.*7/,
      );
      expect(root.textContent).toContain({ ru, kg, en }[locale].billing.payments.monthlyQuotas);
      expect(root.textContent).toContain({ ru, kg, en }[locale].billing.payments.timingNextPeriod);
      expect(root.textContent).not.toMatch(/undefined|NaN|\{amount\}|\{date\}/);
    },
  );
  it.each(["ru", "kg", "en"] as const)("shows a twelve-month price without a monthly suffix, automatic debit or lost trial days in %s", (locale) => {
    const root = renderSummary(
      quote({
        months: 12,
        amountMinor: 5100000,
        serviceValueMinor: 5100000,
        fullAmountMinor: 6000000,
        termAmountMinor: 5100000,
        savingsMinor: 900000,
        discountBps: 1500,
        effectiveTiming: "AFTER_TRIAL",
        endsAt: "2028-01-31T18:00:00.000Z",
      }),
      locale,
    );
    expect(root.querySelector("[data-subscription-amount-due]")?.textContent).toContain(
      formatCurrencyKGS(51000, locale),
    );
    expect(root.querySelector("[data-subscription-amount-due]")?.textContent).not.toMatch(
      /\/(?:мес|ай|month)/,
    );
    expect(root.querySelector("[data-subscription-savings]")?.textContent).toContain(
      formatCurrencyKGS(9000, locale),
    );
    expect(root.textContent).toContain({ ru, kg, en }[locale].billing.payments.timingAfterTrial);
  });
  it("uses the server's prorated amount due and credit instead of displaying the full term as the charge", () => {
    const root = renderSummary(
      quote({
        kind: "UPGRADE",
        amountMinor: 864320,
        creditMinor: 435680,
        serviceValueMinor: 1300000,
        effectiveTiming: "IMMEDIATE",
      }),
    );
    expect(root.querySelector("[data-subscription-amount-due]")?.textContent).toContain(
      formatCurrencyKGS(8643.2, "ru"),
    );
    expect(root.querySelector("[data-subscription-amount-due]")?.textContent).not.toContain(
      formatCurrencyKGS(28500, "ru"),
    );
    expect(root.textContent).toContain(formatCurrencyKGS(4356.8, "ru"));
    expect(root.textContent).toContain(formatCurrencyKGS(13000, "ru"));
    expect(root.textContent).toContain(formatCurrencyKGS(28500, "ru"));
  });
  it("does not invent a saving for a monthly payment and explains a scheduled reduction", () => {
    const root = renderSummary(
      quote({
        months: 1,
        amountMinor: 500000,
        serviceValueMinor: 500000,
        fullAmountMinor: 500000,
        termAmountMinor: 500000,
        savingsMinor: 0,
        discountBps: 0,
        scheduledReduction: true,
      }),
    );
    expect(root.querySelector("[data-subscription-savings]")).toBeNull();
    expect(root.textContent).toContain(ru.billing.payments.scheduledReduction);
  });
  it("shows the selected immutable contract features rather than assuming the plan's default grants", () => {
    const value = quote();
    value.entitlements = {
      ...value.entitlements,
      features: { ...value.entitlements.features, analytics: false },
    };
    const root = renderSummary(value);
    const list = root.querySelector("[data-subscription-selected-features]")!;
    expect(list.textContent).toContain(ru.billing.features.pos);
    expect(list.textContent).not.toContain(ru.billing.features.analytics);
  });
});
