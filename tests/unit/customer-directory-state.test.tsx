// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CustomerDatabasePage from "@/app/(app)/customers/page";

const state = vi.hoisted(() => ({
  role: "MANAGER",
  params: new URLSearchParams(),
  error: null as null | { message: string; data: { code: string } },
  stores: [{ id: "assigned-store", name: "Assigned store" }],
  refetch: vi.fn(),
  mutate: vi.fn(),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { role: state.role } }, status: "authenticated" }),
}));
vi.mock("next-intl", () => ({
  useLocale: () => "ru",
  useTranslations: (namespace: string) =>
    Object.assign((key: string) => `${namespace}.${key}`, { has: () => true }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/customers",
  useSearchParams: () => state.params,
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/trpc", () => {
  const mutation = () => ({ mutate: state.mutate, isLoading: false });
  return {
    trpc: {
      stores: { list: { useQuery: () => ({ data: state.stores, isLoading: false }) } },
      customers: {
        list: {
          useQuery: () => ({
            data: state.error ? undefined : { items: [], total: 0 },
            error: state.error,
            isLoading: false,
            isFetching: false,
            refetch: state.refetch,
          }),
        },
        exportRows: { useQuery: () => ({ refetch: state.refetch }) },
        detail: { useQuery: () => ({ data: undefined }) },
        create: { useMutation: mutation },
        update: { useMutation: mutation },
        delete: { useMutation: mutation },
      },
      useUtils: () => ({ customers: { list: { invalidate: vi.fn() } } }),
    },
  };
});

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  state.role = "MANAGER";
  state.params = new URLSearchParams("storeId=assigned-store");
  state.error = null;
});

describe("customer directory access and recovery", () => {
  it("reports an inaccessible store without claiming its customer list is empty and supports retry", async () => {
    const user = userEvent.setup();
    state.params = new URLSearchParams("storeId=unassigned-store");
    state.error = { message: "storeAccessDenied", data: { code: "FORBIDDEN" } };
    render(<CustomerDatabasePage />);

    expect(screen.getByRole("alert").textContent).toContain("errors.storeAccessDenied");
    expect(screen.queryByText("customers.empty")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("button", { name: "customers.actions.add" }).hasAttribute("disabled")).toBe(true);
    await user.click(screen.getByRole("button", { name: "errors.tryAgain" }));
    expect(state.refetch).toHaveBeenCalledTimes(1);
  });

  it.each(["STAFF", "CASHIER"])("keeps the add alias and actions unavailable to %s", (role) => {
    state.role = role;
    state.params = new URLSearchParams("storeId=assigned-store&add=1");
    state.error = { message: "forbidden", data: { code: "FORBIDDEN" } };
    render(<CustomerDatabasePage />);

    expect(screen.getByRole("alert").textContent).toContain("errors.forbidden");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "customers.actions.add" }).hasAttribute("disabled")).toBe(true);
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it.each(["ADMIN", "MANAGER"])("opens the add alias once for %s and preserves the store and filters", async (role) => {
    const user = userEvent.setup();
    state.role = role;
    state.params = new URLSearchParams("storeId=assigned-store&add=1&search=Existing");
    window.history.replaceState(null, "", `/customers?${state.params}`);
    const view = render(<CustomerDatabasePage />);

    expect(screen.getByRole("dialog", { name: "customers.modal.addTitle" })).toBeTruthy();
    const query = new URLSearchParams(window.location.search);
    expect(query.get("add")).toBeNull();
    expect(query.get("storeId")).toBe("assigned-store");
    expect(query.get("search")).toBe("Existing");
    await user.click(screen.getByRole("button", { name: "common.cancel" }));
    query.set("search", "Changed filter");
    state.params = query;
    view.rerender(<CustomerDatabasePage />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(state.mutate).not.toHaveBeenCalled();
  });
});
