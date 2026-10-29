// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "ADMIN",
  params: new URLSearchParams(),
  storeError: null as null | { message: string; data: { code: string } },
  customerError: null as null | { message: string; data: { code: string } },
  optionsError: null as null | { message: string; data: { code: string } },
  stores: [{ id: "assigned-store", name: "Assigned store" }],
  retryStores: vi.fn(),
  retryCustomers: vi.fn(),
  retryOptions: vi.fn(),
  mutate: vi.fn(),
  reportOptions: [] as Array<{ enabled: boolean }>,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/reports",
  useSearchParams: () => state.params,
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "viewer", organizationId: "org", role: state.role } },
    status: "authenticated",
  }),
}));
vi.mock("next-intl", () => ({
  useLocale: () => "ru",
  useTranslations: (namespace: string) =>
    Object.assign((key: string) => `${namespace}.${key}`, { has: () => true }),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/components/page-header", () => ({
  PageHeader: ({ title, action }: { title: string; action?: React.ReactNode }) => (
    <header><h1>{title}</h1>{action}</header>
  ),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/trpc", () => {
  const emptyQuery = () => ({ data: [], error: null, isLoading: false, refetch: vi.fn() });
  const reportQuery = (_input: unknown, options: { enabled: boolean }) => {
    state.reportOptions.push(options);
    return { data: undefined, error: null, isLoading: false, refetch: vi.fn() };
  };
  const mutation = () => ({ mutate: state.mutate, isLoading: false });
  return { trpc: {
    stores: { list: { useQuery: () => ({
      data: state.storeError ? undefined : state.stores,
      error: state.storeError,
      isLoading: false,
      isFetching: false,
      refetch: state.retryStores,
    }) } },
    reports: {
      sales: { useQuery: reportQuery },
      operations: { useQuery: reportQuery },
      onlineSales: { useQuery: reportQuery },
      loyaltyActivity: { useQuery: reportQuery },
      filterOptions: { useQuery: (input: unknown, options: { enabled: boolean }) => ({
        ...reportQuery(input, options), error: state.optionsError, refetch: state.retryOptions,
      }) },
      customerOptions: { useQuery: (input: unknown, options: { enabled: boolean }) => ({
        ...reportQuery(input, options),
        data: state.customerError ? { total: 0, items: [] } : undefined,
        error: state.customerError, refetch: state.retryCustomers,
      }) },
      fillMissingSalesCosts: { useMutation: mutation },
    },
    exports: {
      list: { useQuery: emptyQuery },
      create: { useMutation: mutation },
      retry: { useMutation: mutation },
    },
    periodClose: { list: { useQuery: emptyQuery }, close: { useMutation: mutation } },
    useUtils: () => ({}),
  } };
});

import ReportsPage from "@/app/(app)/reports/page";
import AnalyticsPage from "@/app/(app)/reports/analytics/page";
import ExportsPage from "@/app/(app)/reports/exports/page";
import PeriodClosePage from "@/app/(app)/reports/close/page";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  state.role = "ADMIN";
  state.params = new URLSearchParams();
  state.storeError = null;
  state.customerError = state.optionsError = null;
  state.stores = [{ id: "assigned-store", name: "Assigned store" }];
  state.reportOptions = [];
});

const pages = [
  ["hub", ReportsPage, ""],
  ["sales analytics", AnalyticsPage, ""],
  ["online analytics", AnalyticsPage, "report=online&dateFrom=2026-10-01&dateTo=2026-10-26"],
  ["exports", ExportsPage, ""],
  ["period close", PeriodClosePage, ""],
] as const;

describe("report store-query recovery", () => {
  it.each(pages)("retries the failed store query in %s without a business mutation", (_name, Page, params) => {
    state.params = new URLSearchParams(params);
    state.storeError = { message: "serviceUnavailable", data: { code: "INTERNAL_SERVER_ERROR" } };
    render(<Page />);
    expect(screen.getByRole("alert").textContent).toContain("errors.serviceUnavailable");
    expect(screen.queryByText("exports.noStoresTitle")).toBeNull();
    fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "common.tryAgain" }));
    expect(state.retryStores).toHaveBeenCalledOnce();
    expect(state.reportOptions.every(options => !options.enabled)).toBe(true);
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it("retains the genuinely empty store state in exports", () => {
    state.stores = [];
    render(<ExportsPage />);
    expect(screen.getByText("exports.noStoresTitle")).toBeTruthy();
    expect(screen.queryByText("errors.serviceUnavailable")).toBeNull();
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it.each(["STAFF", "CASHIER"])("explains denied analytics access for %s without enabling queries", role => {
    state.role = role;
    // A disabled shared store query may retain an earlier viewer's error.
    state.storeError = { message: "serviceUnavailable", data: { code: "INTERNAL_SERVER_ERROR" } };
    render(<AnalyticsPage />);
    expect(screen.getByRole("alert").textContent).toContain("errors.forbidden");
    expect(state.reportOptions.every(options => !options.enabled)).toBe(true);
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it.each(["STAFF", "CASHIER"])("preserves server export access for %s", role => {
    state.role = role;
    render(<ExportsPage />);
    expect(screen.getByText("errors.forbidden")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "exports.generate" })).toBeNull();
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it.each(["STAFF", "CASHIER"])("preserves server period-close access for %s", role => {
    state.role = role;
    render(<PeriodClosePage />);
    expect(screen.getByText("errors.forbidden")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "periodClose.closeAction" })).toBeNull();
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it("retries customer loading without describing an errored cache as empty", () => {
    state.customerError = { message: "serviceUnavailable", data: { code: "INTERNAL_SERVER_ERROR" } };
    render(<AnalyticsPage />);
    fireEvent.click(screen.getByRole("button", { name: "customerPurchases.select" }));
    expect(screen.queryByText("customerPurchases.noCustomers")).toBeNull();
    fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "common.tryAgain" }));
    expect(state.retryCustomers).toHaveBeenCalledOnce();
    expect(state.retryStores).not.toHaveBeenCalled();
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it("retries auxiliary analytics filters independently of the report", () => {
    state.optionsError = { message: "serviceUnavailable", data: { code: "INTERNAL_SERVER_ERROR" } };
    render(<AnalyticsPage />);
    expect(screen.getByRole("alert").textContent).toContain("errors.serviceUnavailable");
    fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "common.tryAgain" }));
    expect(state.retryOptions).toHaveBeenCalledOnce();
    expect(state.retryStores).not.toHaveBeenCalled();
    expect(state.mutate).not.toHaveBeenCalled();
  });
});
