// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ru from "../../messages/ru.json";
import kg from "../../messages/kg.json";
import en from "../../messages/en.json";
import { createContractTerms } from "@/server/billing/contractTerms";
import { PLAN_CODES } from "@/lib/billing/plans";
import { formatDateTime, formatNumber } from "@/lib/i18nFormat";
import { createBillingUiFixture } from "../helpers/billingUiFixture";

type BillingSummaryFixture = Omit<ReturnType<typeof createBillingUiFixture>["summary"], "graceEndsAt"> & {
  graceEndsAt: string | null;
};

const state = vi.hoisted(() => ({
  role: "ADMIN",
  billingMode: "SELF_SERVE",
  lifetime: false,
  status: "ACTIVE",
  platform: "web" as "ios" | "android" | "web" | null,
  summary: null as BillingSummaryFixture | null,
  get: vi.fn(),
  refetch: vi.fn(),
  request: vi.fn(),
  selected: null as string | null,
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ status: "authenticated", data: { user: { role: state.role } } }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/billing" }));
vi.mock("@/lib/native/useNativePlatform", () => ({ useNativePlatform: () => state.platform }));
vi.mock("@/components/page-breadcrumbs", () => ({ PageBreadcrumbs: () => null }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
// The quote/consent/recovery child has its own tests. This test verifies page
// routing of selections and roles, rather than replacing its payment evidence.
vi.mock("@/components/billing/subscription-payments", () => ({
  SubscriptionPayments: ({ selectedPlan }: { selectedPlan: string | null }) => {
    state.selected = selectedPlan;
    return (
      <div id="subscription-checkout" data-testid="checkout-selection">
        {selectedPlan}
      </div>
    );
  },
}));
vi.mock("@/components/billing/subscription-usage", () => ({ SubscriptionUsage: () => null }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    billing: {
      get: { useQuery: (...args: unknown[]) => state.get(...args) },
      requestUpgrade: { useMutation: () => ({ mutate: state.request, isLoading: false }) },
    },
  },
}));
import BillingPage from "@/app/(app)/billing/page";

const terms = createContractTerms("2026-11");
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(state, {
    role: "ADMIN",
    billingMode: "SELF_SERVE",
    lifetime: false,
    status: "ACTIVE",
    platform: "web",
    summary: null,
    selected: null,
  });
  state.get.mockImplementation(() => ({
    isLoading: false,
    isError: false,
    refetch: state.refetch,
    data: state.summary ?? {
      planTier: "STARTER",
      plan: "STARTER",
      subscriptionBillingMode: state.billingMode,
      subscriptionStatus: state.status,
      lifetimeAccess: state.lifetime,
      billingCatalogVersion: "2026-11",
      pendingUpgradeRequest: null,
      trialOffer: null,
      trialEndsAt: null,
      currentPeriodEndsAt: new Date("2027-01-01T00:00:00Z"),
      trialActive: false,
      trialExpired: false,
      subscriptionActive: true,
      hasAccess: true,
      inGrace: false,
      graceEndsAt: null,
      limitState: "WITHIN_LIMITS",
      featureFlags: terms.plans.STARTER.features,
      monthlyPriceKgs: 2000,
      usage: { stores: 1, products: 10, users: 1 },
      limits: { maxStores: 1, maxProducts: 1000, maxUsers: 2 },
      planCatalog: PLAN_CODES.map((code) => ({
        planTier: code,
        plan: code,
        monthlyPriceKgs: terms.plans[code].monthlyPriceKgs,
        limits: { ...terms.plans[code].limits, maxUsers: terms.plans[code].limits.maxActiveUsers },
        featureFlags: terms.plans[code].features,
      })),
    },
  }));
});
afterEach(cleanup);
const localeMessages = { ru, kg, en };
const mount = (locale: keyof typeof localeMessages = "ru") =>
  render(
    <NextIntlClientProvider locale={locale} messages={localeMessages[locale]} timeZone="Asia/Bishkek">
      <BillingPage />
    </NextIntlClientProvider>,
  );

describe("billing page automated checkout and preserved access paths", () => {
  it("selects a self-serve plan in the checkout and routes the final CTA there rather than to a manual request", () => {
    const { container } = mount();
    expect(
      container.querySelector("[data-current-subscription-features] summary")?.textContent,
    ).toBe(ru.billing.includesTitle);
    expect(container.textContent).not.toContain("{value}");
    const links = screen.getAllByRole("link", { name: ru.billing.payments.choosePlan });
    expect(links).toHaveLength(3);
    fireEvent.click(links[1]);
    expect(state.selected).toBe("BUSINESS");
    expect(screen.getByTestId("checkout-selection").textContent).toBe("BUSINESS");
    const cta = container.querySelector("[data-billing-upgrade-cta]")!;
    expect(
      within(cta as HTMLElement)
        .getByRole("link", { name: ru.billing.payments.openCheckout })
        .getAttribute("href"),
    ).toBe("#subscription-checkout");
    expect(cta.textContent).not.toContain(ru.billing.ctaHint);
    expect(screen.queryByRole("button", { name: ru.billing.requestUpgrade })).toBeNull();
    expect(state.request).not.toHaveBeenCalled();
  });
  it("preserves the legacy manual upgrade request flow", () => {
    state.billingMode = "MANUAL";
    const { container } = mount();
    expect(screen.queryByRole("link", { name: ru.billing.payments.choosePlan })).toBeNull();
    const cta = within(container.querySelector("[data-billing-upgrade-cta]") as HTMLElement);
    fireEvent.click(cta.getByRole("button", { name: ru.billing.requestUpgrade }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(state.request).not.toHaveBeenCalled();
  });
  it("keeps lifetime access free of checkout and upgrade request controls while leaving support", () => {
    state.lifetime = true;
    const { container } = mount();
    expect(screen.queryByRole("link", { name: ru.billing.payments.choosePlan })).toBeNull();
    expect(screen.queryByRole("link", { name: ru.billing.payments.openCheckout })).toBeNull();
    expect(screen.queryByRole("button", { name: ru.billing.requestUpgrade })).toBeNull();
    expect(
      within(container.querySelector("[data-billing-upgrade-cta]") as HTMLElement).getByRole(
        "link",
        { name: ru.billing.ctaWhatsapp },
      ),
    ).toBeTruthy();
  });
  it.each(["MANAGER", "STAFF", "CASHIER"])(
    "does not query billing details or expose checkout to %s",
    (role) => {
      state.role = role;
      mount();
      expect(state.get.mock.calls[0][1]).toMatchObject({ enabled: false });
      expect(screen.getByRole("alert").textContent).toBe(ru.errors.forbidden);
      expect(screen.queryByTestId("checkout-selection")).toBeNull();
    },
  );
  it("does not offer payment or a manual request while the account is paused", () => {
    state.status = "CANCELED";
    mount();
    expect(screen.queryByRole("link", { name: ru.billing.payments.openCheckout })).toBeNull();
    expect(screen.queryByRole("button", { name: ru.billing.requestUpgrade })).toBeNull();
    expect(screen.getByText(ru.billing.subscriptionStatuses.canceled)).toBeTruthy();
  });
});

describe("iOS current access and optional future purchases", () => {
  it.each(["ru", "kg", "en"] as const)("keeps prepaid access distinct from new Apple prices and keeps navigation optional in %s", (locale) => {
    state.platform = "ios";
    state.summary = { ...createBillingUiFixture("paid").summary,
      currentPeriodEndsAt: "2027-06-01T00:00:00.000Z",
      limits: { maxStores: 2, maxProducts: 6000, maxUsers: 7 }, usage: { stores: 2, products: 0, users: 1 } };
    const messages = localeMessages[locale], { container } = mount(locale);
    const overview = container.querySelector("[data-subscription-overview]") as HTMLElement;
    expect(within(overview).getByText(messages.billingApple.currentAccessPreserved)).toBeTruthy();
    expect(overview.textContent).not.toContain(messages.billingApple.pricesAppStore);
    expect(overview.textContent).toContain(formatDateTime("2027-06-01T00:00:00.000Z", locale));
    expect(within(overview).getByText(messages.billing.plans.business.name)).toBeTruthy();
    expect(Array.from(overview.querySelectorAll("dd")).map((row) => row.textContent?.replace(/\s/g, ""))).toEqual([
      "2/2", `0/${formatNumber(6000, locale)}`.replace(/\s/g, ""), "1/7",
    ]);
    const link = within(overview).getByRole("link", { name: messages.billingApple.renewalAndChanges });
    expect(link.getAttribute("href")).toBe("#subscription-checkout");
    fireEvent.click(link);
    expect(state.selected).toBeNull();
    expect(state.request).not.toHaveBeenCalled();
    // The catalog is about new offers, so its Apple price guidance remains.
    const catalog = container.querySelector("#plans") as HTMLElement;
    expect(within(catalog).getAllByText(messages.billingApple.pricesAppStore)).toHaveLength(3);
    const planLinks = within(catalog).getAllByRole("link", { name: messages.billing.payments.choosePlan });
    fireEvent.click(planLinks[2]);
    expect(state.selected).toBe("ENTERPRISE");
    expect(within(overview).getByText(messages.billing.plans.business.name)).toBeTruthy();
    expect(state.request).not.toHaveBeenCalled();
  });

  it.each(["ru", "kg", "en"] as const)("keeps the trial free wording instead of describing it as paid/current subscription in %s", (locale) => {
    state.platform = "ios"; state.summary = createBillingUiFixture("trial").summary;
    const { container } = mount(locale), messages = localeMessages[locale];
    const overview = container.querySelector("[data-subscription-overview]") as HTMLElement;
    expect(within(overview).getByText(messages.billing.trial.free)).toBeTruthy();
    expect(overview.textContent).not.toContain(messages.billingApple.currentAccessPreserved);
    expect(within(overview).getByRole("link", { name: messages.billingApple.renewalAndChanges }).getAttribute("href")).toBe("#subscription-checkout");
    expect(state.request).not.toHaveBeenCalled();
  });

  it.each(["ru", "kg", "en"] as const)("clarifies an active legacy trial without trialOffer and preserves its expiry in %s", (locale) => {
    const trialEnd = "2026-11-18T08:33:00.000Z";
    state.platform = "ios"; state.summary = { ...createBillingUiFixture("trial").summary,
      trialOffer: null, billingCatalogVersion: "2026-10", trialEndsAt: trialEnd, currentPeriodEndsAt: trialEnd };
    const { container } = mount(locale), messages = localeMessages[locale];
    const overview = container.querySelector("[data-subscription-overview]") as HTMLElement;
    expect(within(overview).getByText(messages.billing.trial.free)).toBeTruthy();
    expect(overview.querySelector("[data-current-trial-end]")?.textContent).toContain(formatDateTime(trialEnd, locale));
    expect(overview.querySelector("[data-current-subscription-end]")).toBeNull();
    expect(overview.textContent).not.toContain(messages.billingApple.pricesAppStore);
    expect(overview.textContent).not.toContain(messages.billingApple.currentAccessPreserved);
    expect(within(overview).getByRole("link", { name: messages.billingApple.renewalAndChanges }).getAttribute("href")).toBe("#subscription-checkout");
    expect(state.request).not.toHaveBeenCalled();
  });

  it.each(["manual", "lifetime"] as const)("preserves granted %s access without adding payment/request controls", (access) => {
    state.platform = "ios"; state.summary = createBillingUiFixture(access).summary;
    const { container } = mount(), overview = container.querySelector("[data-subscription-overview]") as HTMLElement;
    expect(within(overview).getByText(ru.billingApple.currentAccessPreserved)).toBeTruthy();
    expect(screen.queryByRole("link", { name: ru.billingApple.renewalAndChanges })).toBeNull();
    expect(screen.queryByRole("link", { name: ru.billing.payments.choosePlan })).toBeNull();
    expect(screen.queryByRole("button", { name: ru.billing.requestUpgrade })).toBeNull();
    expect(state.request).not.toHaveBeenCalled();
  });

  it("does not promise preserved current access after expiry while leaving future renewal navigation", () => {
    state.platform = "ios"; state.summary = createBillingUiFixture("expiredPaid").summary;
    const { container } = mount(), overview = container.querySelector("[data-subscription-overview]") as HTMLElement;
    expect(overview.textContent).not.toContain(ru.billingApple.currentAccessPreserved);
    expect(within(overview).getByText(ru.billingApple.pricesAppStore)).toBeTruthy();
    expect(within(overview).getByRole("link", { name: ru.billingApple.renewalAndChanges })).toBeTruthy();
    expect(screen.queryByText(ru.billing.subscriptionActive)).toBeNull();
  });

  it("does not describe temporary grace as an active paid subscription", () => {
    state.platform = "ios"; state.summary = { ...createBillingUiFixture("expiredPaid").summary,
      currentPeriodEndsAt: "2026-11-10T00:00:00.000Z", hasAccess: true, inGrace: true,
      graceEndsAt: "2026-11-17T00:00:00.000Z" };
    const { container } = mount(), overview = container.querySelector("[data-subscription-overview]") as HTMLElement;
    expect(overview.textContent).not.toContain(ru.billingApple.currentAccessPreserved);
    expect(within(overview).getByText(ru.billingApple.pricesAppStore)).toBeTruthy();
  });

  it("keeps paused native accounts free of checkout navigation", () => {
    state.platform = "ios"; state.summary = createBillingUiFixture("paused").summary;
    const { container } = mount(), overview = container.querySelector("[data-subscription-overview]") as HTMLElement;
    expect(overview.textContent).not.toContain(ru.billingApple.currentAccessPreserved);
    expect(screen.queryByRole("link", { name: ru.billingApple.renewalAndChanges })).toBeNull();
    expect(screen.queryByRole("link", { name: ru.billing.payments.choosePlan })).toBeNull();
    expect(state.request).not.toHaveBeenCalled();
  });

  it("leaves Android on the existing web-payment presentation", () => {
    state.platform = "android"; const { container } = mount();
    const overview = container.querySelector("[data-subscription-overview]") as HTMLElement;
    expect(overview.textContent).not.toContain(ru.billingApple.currentAccessPreserved);
    expect(within(overview).getByRole("link", { name: ru.billing.payments.openCheckout }).getAttribute("href")).toBe("#subscription-checkout");
    expect(screen.queryByRole("link", { name: ru.billingApple.renewalAndChanges })).toBeNull();
  });

  it("retains the loading presentation until the platform is resolved", () => {
    state.platform = null; const { container } = mount();
    const overview = container.querySelector("[data-subscription-overview]") as HTMLElement;
    expect(within(overview).getByText(ru.common.loading)).toBeTruthy();
    expect(overview.textContent).not.toContain(ru.billingApple.currentAccessPreserved);
  });
});
