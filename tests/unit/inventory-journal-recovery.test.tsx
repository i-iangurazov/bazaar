// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  path: "/inventory/movements",
  params: new URLSearchParams("storeId=assigned-store"),
  error: null as null | { message: string; data: { code: string } },
  storeError: null as null | { message: string; data: { code: string } },
  stores: [{ id: "assigned-store", name: "Assigned store" }],
  retry: vi.fn(),
  retryStores: vi.fn(),
  mutate: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => state.path,
  useSearchParams: () => state.params,
  useParams: () => ({ id: "STOCK_RECEIVING:STOCK_RECEIVING:synthetic-document" }),
  useRouter: () => ({ replace: state.replace }),
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { role: "ADMIN" } }, status: "authenticated" }),
}));
vi.mock("next-intl", () => ({
  useLocale: () => "ru",
  useTranslations: (namespace: string) =>
    Object.assign((key: string) => `${namespace}.${key}`, { has: () => true }),
}));
vi.mock("@/components/page-header", () => ({
  PageHeader: ({
    title,
    action,
    filters,
  }: {
    title: string;
    action?: React.ReactNode;
    filters?: React.ReactNode;
  }) => (
    <header>
      <h1>{title}</h1>
      {action}
      {filters}
    </header>
  ),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/trpc", () => {
  const list = () => ({
    data: state.error ? undefined : { items: [], total: 0 },
    error: state.error,
    isLoading: !state.stores.length,
    refetch: state.retry,
  });
  return {
    trpc: {
      stores: {
        list: {
          useQuery: () => ({
            data: state.storeError ? undefined : state.stores,
            error: state.storeError,
            isLoading: false,
            refetch: state.retryStores,
          }),
        },
      },
      inventory: {
        productMovements: { useQuery: list },
        productMovementDocument: {
          useQuery: () => ({
            data: null,
            error: state.error,
            isLoading: false,
            refetch: state.retry,
          }),
        },
        archiveProductMovementDocument: {
          useMutation: () => ({ mutate: state.mutate, isLoading: false }),
        },
      },
      stockCounts: {
        list: { useQuery: list },
        create: { useMutation: () => ({ mutate: state.mutate, isLoading: false }) },
      },
      useUtils: () => ({}),
    },
  };
});

import MovementsPage from "@/app/(app)/inventory/movements/page";
import MovementDocumentPage from "@/app/(app)/inventory/movements/[id]/page";
import CountsPage from "@/app/(app)/inventory/counts/page";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  state.path = "/inventory/movements";
  state.params = new URLSearchParams("storeId=assigned-store");
  state.error = state.storeError = null;
  state.stores = [{ id: "assigned-store", name: "Assigned store" }];
});

describe("inventory journal recovery preserves document semantics", () => {
  it("keeps a failed movement query distinct from an empty journal and retries it", () => {
    state.error = { message: "storeAccessDenied", data: { code: "FORBIDDEN" } };
    render(<MovementsPage />);
    expect(screen.queryByText("inventory.movementJournal.empty")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("errors.storeAccessDenied");
    fireEvent.click(screen.getByRole("button", { name: "common.tryAgain" }));
    expect(state.retry).toHaveBeenCalledOnce();
    expect(state.mutate).not.toHaveBeenCalled();
  });
  it("does not describe a service failure as a missing movement document", () => {
    state.error = { message: "serviceUnavailable", data: { code: "INTERNAL_SERVER_ERROR" } };
    render(<MovementDocumentPage />);
    expect(screen.queryByText("inventory.movementJournal.documentNotFound")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("errors.serviceUnavailable");
    fireEvent.click(screen.getByRole("button", { name: "common.tryAgain" }));
    expect(state.retry).toHaveBeenCalledOnce();
  });
  it("retains the genuine missing-document state and its safe return link", () => {
    state.params = new URLSearchParams(
      "returnTo=/inventory/movements?storeId=assigned-store%26type=TRANSFER",
    );
    render(<MovementDocumentPage />);
    expect(screen.getByText("inventory.movementJournal.documentNotFound")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "inventory.movementJournal.backToMovements" })
        .getAttribute("href"),
    ).toBe("/inventory/movements?storeId=assigned-store&type=TRANSFER");
  });
  it("reports stock-count query failure with retry instead of an empty count list", () => {
    state.path = "/inventory/counts";
    state.error = { message: "serviceUnavailable", data: { code: "INTERNAL_SERVER_ERROR" } };
    render(<CountsPage />);
    expect(screen.queryByText("stockCounts.empty")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("errors.serviceUnavailable");
    fireEvent.click(screen.getByRole("button", { name: "common.tryAgain" }));
    expect(state.retry).toHaveBeenCalledOnce();
    expect(state.mutate).not.toHaveBeenCalled();
  });
  it("recovers the store list without claiming a stock-count result", () => {
    state.path = "/inventory/counts";
    state.params = new URLSearchParams();
    state.storeError = { message: "serviceUnavailable", data: { code: "INTERNAL_SERVER_ERROR" } };
    render(<CountsPage />);
    expect(screen.queryByText("stockCounts.empty")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("errors.serviceUnavailable");
    fireEvent.click(screen.getByRole("button", { name: "common.tryAgain" }));
    expect(state.retryStores).toHaveBeenCalledOnce();
  });
  it("requests a store instead of leaving the disabled count query loading forever", () => {
    state.path = "/inventory/counts";
    state.params = new URLSearchParams();
    state.stores = [];
    render(<CountsPage />);
    expect(document.querySelector("[data-stock-counts-skeleton]")).toBeNull();
    expect(screen.queryByText("stockCounts.empty")).toBeNull();
    expect(screen.getAllByText("common.selectStore").length).toBeGreaterThan(0);
  });
  it("retains the successful empty count list and names both filters", () => {
    state.path = "/inventory/counts";
    render(<CountsPage />);
    expect(screen.getByText("stockCounts.empty")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "common.store" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "stockCounts.status" })).toBeTruthy();
  });
  it("names the existing journal filters including advanced options", () => {
    render(<MovementsPage />);
    for (const name of ["store", "documentType", "statusLabel"]) {
      expect(
        screen.getByRole("combobox", { name: `inventory.movementJournal.${name}` }),
      ).toBeTruthy();
    }
    fireEvent.click(
      screen.getByRole("button", { name: "inventory.movementJournal.additionalFilters" }),
    );
    for (const name of ["paymentStatus", "archiveFilter", "orderStatus"]) {
      expect(
        screen.getByRole("combobox", { name: `inventory.movementJournal.${name}` }),
      ).toBeTruthy();
    }
  });
});
