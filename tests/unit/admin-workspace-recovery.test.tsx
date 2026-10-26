// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "ADMIN",
  owner: false,
  status: "authenticated",
  failed: "",
  queries: [] as Array<{ path: string; enabled: boolean }>,
  retries: [] as string[],
  mutate: vi.fn(),
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    status: state.status,
    data: {
      user: { id: "viewer", organizationId: "org", role: state.role, isPlatformOwner: state.owner },
    },
  }),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/admin/metrics",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next-intl", () => ({
  useLocale: () => "ru",
  useTranslations: (ns: string) =>
    Object.assign((key: string) => `${ns}.${key}`, {
      raw: () => ["Article body"],
      has: () => true,
    }),
}));
vi.mock("@/components/page-header", () => ({
  PageHeader: ({ title, action }: { title: string; action?: React.ReactNode }) => (
    <header>
      <h1>{title}</h1>
      {action}
    </header>
  ),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/trpc", () => {
  const paths = [
    "adminJobs.list",
    "adminJobs.retry",
    "adminJobs.resolve",
    "adminMetrics.get",
    "users.list",
    "adminSupport.storeFlags",
    "adminSupport.createImpersonation",
    "adminSupport.exportBundle",
    "adminSupport.upsertStoreFlag",
    "billing.get",
    "billing.requestUpgrade",
    "billing.payments.get",
    "billing.payments.invoices",
    "billing.payments.checkout",
    "billing.payments.check",
    "onboarding.get",
    "onboarding.skipStep",
    "stores.list",
    "stores.create",
    "stores.updateLegalDetails",
    "inventory.setDefaultMinStock",
    "platformOwner.summary",
    "platformOwner.listOrganizations",
    "platformOwner.listUpgradeRequests",
    "platformOwner.updateOrganizationBilling",
    "platformOwner.reviewUpgradeRequest",
    "platformOwner.paymentReviews",
    "platformOwner.recheckPayment",
    "platformOwner.resolvePaymentReview",
  ];
  const tree: Record<string, unknown> = {};
  for (const path of paths) {
    const parts = path.split(".");
    let parent = tree;
    for (const part of parts.slice(0, -1)) {
      parent[part] ??= {};
      parent = parent[part] as Record<string, unknown>;
    }
    const query = (_input?: unknown, options?: { enabled?: boolean }) => {
      state.queries.push({ path, enabled: options?.enabled !== false });
      let data: unknown;
      if (
        [
          "adminJobs.list",
          "users.list",
          "adminSupport.storeFlags",
          "stores.list",
          "platformOwner.listOrganizations",
          "platformOwner.listUpgradeRequests",
          "platformOwner.paymentReviews",
        ].includes(path)
      )
        data = [];
      if (path === "onboarding.get")
        data = {
          steps: {
            store: "pending",
            users: "pending",
            catalog: "pending",
            inventory: "pending",
            procurement: "pending",
            receive: "pending",
          },
          stats: {},
        };
      if (path === "billing.payments.get")
        data = {
          currentPlan: "STARTER",
          catalog: [],
          mode: "disabled",
          available: false,
          billingMode: "MANUAL",
          accountPaused: false,
        };
      if (path === "billing.payments.invoices") data = { pages: [{ items: [], nextCursor: null }] };
      const error =
        state.failed === path
          ? { message: "serviceUnavailable", data: { code: "INTERNAL_SERVER_ERROR" } }
          : null;
      return {
        data: error ? undefined : data,
        error,
        isError: Boolean(error),
        isLoading: false,
        isFetching: false,
        refetch: () => {
          state.retries.push(path);
          return Promise.resolve({ data, error: null });
        },
        hasNextPage: false,
      };
    };
    parent[parts.at(-1)!] = {
      useQuery: query,
      useInfiniteQuery: query,
      useMutation: () => ({ mutate: state.mutate, mutateAsync: state.mutate, isLoading: false }),
    };
  }
  return {
    trpc: {
      ...tree,
      useUtils: () => ({ client: { adminMetrics: { export: { query: vi.fn() } } } }),
    },
  };
});

import Jobs from "@/app/(app)/admin/jobs/page";
import Support from "@/app/(app)/admin/support/page";
import Metrics from "@/app/(app)/admin/metrics/page";
import Billing from "@/app/(app)/billing/page";
import Onboarding from "@/app/(app)/onboarding/page";
import Platform from "@/app/(app)/platform/page";
import Compliance from "@/app/(app)/help/compliance/page";
import { SubscriptionPayments } from "@/components/billing/subscription-payments";
import { PaymentReviews } from "@/components/billing/payment-reviews";

const Payments = () => <SubscriptionPayments onUpdated={() => undefined} />;
const Reviews = () => <PaymentReviews enabled />;
const admins = [
  ["jobs", Jobs],
  ["support", Support],
  ["metrics", Metrics],
  ["billing", Billing],
  ["onboarding", Onboarding],
] as const;
const reads = [
  ["jobs", Jobs, "adminJobs.list"],
  ["support users", Support, "users.list"],
  ["support flags", Support, "adminSupport.storeFlags"],
  ["metrics", Metrics, "adminMetrics.get"],
  ["billing", Billing, "billing.get"],
  ["onboarding status", Onboarding, "onboarding.get"],
  ["onboarding stores", Onboarding, "stores.list"],
  ["platform summary", Platform, "platformOwner.summary"],
  ["platform organizations", Platform, "platformOwner.listOrganizations"],
  ["platform requests", Platform, "platformOwner.listUpgradeRequests"],
  ["payment settings", Payments, "billing.payments.get"],
  ["payment history", Payments, "billing.payments.invoices"],
  ["payment reviews", Reviews, "platformOwner.paymentReviews"],
] as const;
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  state.role = "ADMIN";
  state.owner = false;
  state.status = "authenticated";
  state.failed = "";
  state.queries = [];
  state.retries = [];
  window.history.replaceState(null, "", "/");
});

describe("administration workspace recovery", () => {
  it.each(reads)("recovers %s without invoking operational mutations", (_name, Page, path) => {
    state.owner = true;
    state.failed = path;
    render(<Page />);
    const alerts = screen.getAllByRole("alert");
    expect(alerts.some((x) => x.textContent?.includes("errors.serviceUnavailable"))).toBe(true);
    fireEvent.click(within(alerts[0]).getByRole("button", { name: "common.tryAgain" }));
    expect(state.retries).toEqual([path]);
    expect(state.mutate).not.toHaveBeenCalled();
  });
  for (const role of ["MANAGER", "STAFF", "CASHIER"]) {
    it.each(admins)("explains existing " + role + " denial for %s", (_name, Page) => {
      state.role = role;
      render(<Page />);
      expect(screen.getByRole("alert").textContent).toContain("errors.forbidden");
      expect(state.queries.every((x) => !x.enabled)).toBe(true);
      expect(state.mutate).not.toHaveBeenCalled();
    });
  }
  it.each([...admins, ["platform", Platform]] as const)(
    "does not expose cached %s content while the session loads",
    (_name, Page) => {
      state.status = "loading";
      state.owner = true;
      render(<Page />);
      expect(screen.getByRole("status").textContent).toContain("common.loading");
      expect(state.queries.every((x) => !x.enabled)).toBe(true);
      expect(state.mutate).not.toHaveBeenCalled();
    },
  );
  it.each(["ADMIN", "MANAGER", "STAFF", "CASHIER"])(
    "keeps platform-owner boundary for %s",
    (role) => {
      state.role = role;
      render(<Platform />);
      expect(screen.getByRole("alert").textContent).toContain("errors.forbidden");
      expect(state.queries.every((x) => !x.enabled)).toBe(true);
      expect(state.mutate).not.toHaveBeenCalled();
    },
  );
});

describe("compliance article disclosure", () => {
  it("announces expanded state and connects the button to the visible article", () => {
    render(<Compliance />);
    const buttons = screen.getAllByRole("button");
    expect(buttons[0].getAttribute("aria-expanded")).toBe("true");
    expect(buttons[1].getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(buttons[1]);
    expect(buttons[0].getAttribute("aria-expanded")).toBe("false");
    expect(buttons[1].getAttribute("aria-expanded")).toBe("true");
    expect(
      document.getElementById(buttons[1].getAttribute("aria-controls")!)?.textContent,
    ).toContain("Article body");
    fireEvent.click(buttons[1]);
    expect(buttons[1].getAttribute("aria-expanded")).toBe("false");
  });
  it("preserves the direct link to period close", () => {
    window.history.replaceState(null, "", "/#periodClose");
    render(<Compliance />);
    expect(screen.getAllByRole("button")[3].getAttribute("aria-expanded")).toBe("true");
  });
});
