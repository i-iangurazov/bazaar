// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../messages/en.json";
import { TooltipProvider } from "@/components/ui/tooltip";

const mock = vi.hoisted(() => ({ update: vi.fn(), refetch: vi.fn() }));
const organization = (
  id: string,
  canEnableSelfServe: boolean,
  subscriptionBillingMode = "MANUAL",
) => ({
  id,
  name: id,
  plan: "STARTER",
  subscriptionStatus: "ACTIVE",
  subscriptionBillingMode,
  canEnableSelfServe,
  createdAt: new Date("2026-11-10T00:00:00Z"),
  trialEndsAt: null,
  currentPeriodEndsAt: null,
  stores: [],
  _count: { stores: 1, users: 1, products: 0 },
});
const organizations = [
  organization("pilot-target", true),
  organization("other-target", false),
  organization("existing-self-serve", false, "SELF_SERVE"),
];

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    status: "authenticated",
    data: { user: { isPlatformOwner: true, organizationId: "operator-org" } },
  }),
}));
vi.mock("@/components/page-breadcrumbs", () => ({ PageBreadcrumbs: () => null }));
vi.mock("@/components/billing/payment-reviews", () => ({ PaymentReviews: () => null }));
vi.mock("@/components/billing/manual-subscription-refunds", () => ({
  ManualSubscriptionRefunds: () => null,
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/trpc", () => {
  const query = (data: unknown) => ({ data, isLoading: false, error: null, refetch: mock.refetch });
  return {
    trpc: {
      platformOwner: {
        summary: {
          useQuery: () =>
            query({
              organizationsTotal: 3,
              organizationsPaid: 0,
              organizationsPastDue: 0,
              organizationsCanceled: 0,
              pendingUpgradeRequests: 0,
              confirmedPaidMrrKgs: 0,
              activeByTier: { STARTER: 3, BUSINESS: 0, ENTERPRISE: 0 },
              // Merchant readiness is global; it cannot authorize an unrelated target.
              paymentsAvailable: true,
            }),
        },
        listOrganizations: { useQuery: () => query(organizations) },
        listUpgradeRequests: { useQuery: () => query([]) },
        updateOrganizationBilling: {
          useMutation: () => ({ mutate: mock.update, isLoading: false }),
        },
        reviewUpgradeRequest: { useMutation: () => ({ mutate: vi.fn(), isLoading: false }) },
      },
    },
  };
});

import PlatformPage from "@/app/(app)/platform/page";
const originalScrollIntoView = Element.prototype.scrollIntoView;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Element.prototype.scrollIntoView = originalScrollIntoView;
});
const mount = () =>
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Bishkek">
      <TooltipProvider>
        <PlatformPage />
      </TooltipProvider>
    </NextIntlClientProvider>,
  );
const edit = (id: string) => {
  const row = screen.getByText(id, { exact: true }).closest("tr")!;
  fireEvent.click(within(row).getByRole("button", { name: en.platformOwner.editBilling }));
  return screen.getByRole("dialog", { name: en.platformOwner.editBillingTitle });
};

describe("platform billing pilot target availability", () => {
  it.each([
    ["pilot-target", true],
    ["other-target", false],
  ] as const)(
    "uses the permission of %s rather than the operator or global readiness",
    async (id, allowed) => {
      mount();
      const dialog = edit(id);
      const mode = within(dialog).getByRole("combobox", { name: en.platformOwner.billingMode });
      fireEvent.keyDown(mode, { key: "Enter" });
      const option = await screen.findByRole("option", {
        name: en.platformOwner.billingModeSelfServe,
      });
      expect(option.getAttribute("aria-disabled") === "true").toBe(!allowed);
      fireEvent.click(option);
      if (allowed) {
        expect(mode.textContent).toBe(en.platformOwner.billingModeSelfServe);
        fireEvent.click(within(dialog).getByRole("button", { name: en.common.save }));
        expect(mock.update).toHaveBeenCalledWith({
          organizationId: id,
          plan: "STARTER",
          subscriptionStatus: "ACTIVE",
          subscriptionBillingMode: "SELF_SERVE",
        });
      } else {
        expect(mode.textContent).toBe(en.platformOwner.billingModeManual);
        expect(mock.update).not.toHaveBeenCalled();
      }
    },
  );

  it("preserves an existing self-serve setting when new purchases are restricted", async () => {
    mount();
    const dialog = edit("existing-self-serve");
    const mode = within(dialog).getByRole("combobox", { name: en.platformOwner.billingMode });
    expect(mode.textContent).toBe(en.platformOwner.billingModeSelfServe);
    fireEvent.keyDown(mode, { key: "Enter" });
    const option = await screen.findByRole("option", {
      name: en.platformOwner.billingModeSelfServe,
    });
    expect(option.getAttribute("aria-disabled")).not.toBe("true");
    fireEvent.click(option);
    fireEvent.click(within(dialog).getByRole("button", { name: en.common.save }));
    expect(mock.update).toHaveBeenCalledWith({
      organizationId: "existing-self-serve",
      plan: "STARTER",
      subscriptionStatus: "ACTIVE",
      subscriptionBillingMode: "SELF_SERVE",
    });
  });
});
