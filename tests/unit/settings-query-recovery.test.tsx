// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "ADMIN",
  unitError: null as null | { message: string; data: { code: string } },
  storeError: null as null | { message: string; data: { code: string } },
  categoryError: null as null | { message: string; data: { code: string } },
  usersError: null as null | { message: string; data: { code: string } },
  invitesError: null as null | { message: string; data: { code: string } },
  stores: [{ id: "assigned-store", name: "Assigned store", code: "QA" }],
  categories: [] as Array<{ name: string; normalizedName: string; isVisibleInForms: boolean; isArchived: boolean; productCount: number }>,
  refetchUnits: vi.fn(), refetchStores: vi.fn(), refetchCategories: vi.fn(), mutate: vi.fn(),
  refetchUsers: vi.fn(), refetchInvites: vi.fn(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/settings/users", useSearchParams: () => new URLSearchParams(), useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { role: state.role } }, status: "authenticated" }) }));
vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: (namespace: string) => Object.assign((key: string) => `${namespace}.${key}`, { has: () => true }),
}));
vi.mock("@/components/page-header", () => ({ PageHeader: ({ title, action }: { title: string; action?: React.ReactNode }) => <header><h1>{title}</h1>{action}</header> }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/trpc", () => {
  const mutation = () => ({ mutate: state.mutate, isLoading: false });
  const cache = { getData: vi.fn(), setData: vi.fn(), invalidate: vi.fn() };
  return { trpc: {
    units: {
      list: { useQuery: () => ({ data: state.unitError ? undefined : [], error: state.unitError, isLoading: false, refetch: state.refetchUnits }) },
      create: { useMutation: mutation }, update: { useMutation: mutation }, remove: { useMutation: mutation },
    },
    stores: { list: { useQuery: () => ({ data: state.storeError ? undefined : state.stores, error: state.storeError, isLoading: false, refetch: state.refetchStores }) } },
    productCategories: {
      listForStore: { useQuery: () => ({ data: state.categoryError ? undefined : state.categories, error: state.categoryError, isLoading: !state.stores.length, refetch: state.refetchCategories }) },
      setStoreVisibility: { useMutation: mutation },
    },
    users: {
      list: { useQuery: () => ({ data: state.usersError ? undefined : [], error: state.usersError, isLoading: false, refetch: state.refetchUsers }) },
      create: { useMutation: mutation }, update: { useMutation: mutation }, setActive: { useMutation: mutation },
      resetPassword: { useMutation: mutation }, setTransferPermission: { useMutation: mutation },
    },
    invites: {
      list: { useQuery: () => ({ data: state.invitesError ? undefined : [], error: state.invitesError, isLoading: false, refetch: state.refetchInvites }) },
      create: { useMutation: mutation },
    },
    useUtils: () => ({ units: { list: cache }, productCategories: { listForStore: cache }, users: { list: cache } }),
  } };
});

import UnitsPage from "@/app/(app)/settings/units/page";
import CategoriesPage from "@/app/(app)/settings/categories/page";
import UsersPage from "@/app/(app)/settings/users/page";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  state.role = "ADMIN";
  state.unitError = state.storeError = state.categoryError = null;
  state.usersError = state.invitesError = null;
  state.stores = [{ id: "assigned-store", name: "Assigned store", code: "QA" }];
  state.categories = [];
});

describe("settings list recovery and existing access", () => {
  it("does not describe failed user loading as an empty organization and retries it", () => {
    state.usersError = { message: "serviceUnavailable", data: { code: "INTERNAL_SERVER_ERROR" } };
    render(<UsersPage />);
    expect(screen.queryByText("users.noUsers")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("errors.serviceUnavailable");
    fireEvent.click(screen.getByRole("button", { name: "errors.tryAgain" }));
    expect(state.refetchUsers).toHaveBeenCalledOnce();
    expect(state.mutate).not.toHaveBeenCalled();
  });
  it("does not claim there are no invitations when their query fails", () => {
    state.invitesError = { message: "serviceUnavailable", data: { code: "INTERNAL_SERVER_ERROR" } };
    render(<UsersPage />);
    expect(screen.queryByText("users.inviteEmpty")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("errors.serviceUnavailable");
    fireEvent.click(screen.getByRole("button", { name: "errors.tryAgain" }));
    expect(state.refetchInvites).toHaveBeenCalledOnce();
    expect(state.mutate).not.toHaveBeenCalled();
  });
  it("does not describe a failed unit query as empty and retries that query", () => {
    state.unitError = { message: "serviceUnavailable", data: { code: "INTERNAL_SERVER_ERROR" } };
    render(<UnitsPage />);
    expect(screen.queryByText("units.empty")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("errors.serviceUnavailable");
    fireEvent.click(screen.getByRole("button", { name: "errors.tryAgain" }));
    expect(state.refetchUnits).toHaveBeenCalledOnce();
  });
  it("shows the successful empty units state", () => {
    render(<UnitsPage />);
    expect(screen.getByText("units.empty")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it.each(["STAFF", "CASHIER"])("preserves the units restriction for %s", (role) => {
    state.role = role;
    render(<UnitsPage />);
    expect(screen.getByText("errors.forbidden")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "units.create" })).toBeNull();
    expect(state.mutate).not.toHaveBeenCalled();
  });
  it("does not describe a failed category query as empty and retries it", () => {
    state.categoryError = { message: "storeAccessDenied", data: { code: "FORBIDDEN" } };
    render(<CategoriesPage />);
    expect(screen.queryByText("categorySettings.empty")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("errors.storeAccessDenied");
    fireEvent.click(screen.getByRole("button", { name: "errors.tryAgain" }));
    expect(state.refetchCategories).toHaveBeenCalledOnce();
    expect(state.mutate).not.toHaveBeenCalled();
  });
  it("offers store-query recovery before claiming anything about categories", () => {
    state.storeError = { message: "serviceUnavailable", data: { code: "INTERNAL_SERVER_ERROR" } };
    render(<CategoriesPage />);
    expect(screen.queryByText("categorySettings.empty")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("errors.serviceUnavailable");
    fireEvent.click(screen.getByRole("button", { name: "errors.tryAgain" }));
    expect(state.refetchStores).toHaveBeenCalledOnce();
    expect(state.refetchCategories).not.toHaveBeenCalled();
  });
  it("shows an empty category list only after a successful store-scoped query and names its controls", () => {
    render(<CategoriesPage />);
    expect(screen.getByText("categorySettings.empty")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "categorySettings.store" })).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: "categorySettings.search" })).toBeTruthy();
  });
  it("requests a store instead of spinning forever when none are available", () => {
    state.stores = [];
    render(<CategoriesPage />);
    expect(screen.queryByText("common.loading")).toBeNull();
    expect(screen.getAllByText("categorySettings.storePlaceholder").length).toBeGreaterThan(0);
    expect(screen.queryByText("categorySettings.empty")).toBeNull();
  });
  it("keeps category changes unavailable to a manager", () => {
    state.role = "MANAGER";
    state.categories = [{ name: "Stationery", normalizedName: "stationery", isVisibleInForms: true, isArchived: false, productCount: 2 }];
    render(<CategoriesPage />);
    expect(screen.getByText("categorySettings.adminOnly")).toBeTruthy();
    expect(screen.getByRole("button", { name: "categorySettings.actions.hide" }).hasAttribute("disabled")).toBe(true);
    expect(state.mutate).not.toHaveBeenCalled();
  });
});
