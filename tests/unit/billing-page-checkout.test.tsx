// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ru from "../../messages/ru.json";
import { createContractTerms } from "@/server/billing/contractTerms";
import { PLAN_CODES } from "@/lib/billing/plans";

const state = vi.hoisted(() => ({
  role: "ADMIN",
  billingMode: "SELF_SERVE",
  lifetime: false,
  status: "ACTIVE",
  get: vi.fn(),
  refetch: vi.fn(),
  request: vi.fn(),
  selected: null as string | null,
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ status: "authenticated", data: { user: { role: state.role } } }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/billing" }));
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
    selected: null,
  });
  state.get.mockImplementation(() => ({
    isLoading: false,
    isError: false,
    refetch: state.refetch,
    data: {
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
const mount = () =>
  render(
    <NextIntlClientProvider locale="ru" messages={ru} timeZone="Asia/Bishkek">
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
