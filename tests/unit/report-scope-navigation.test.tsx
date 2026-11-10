// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const scope = vi.hoisted(() => ({
  userId: "owner", organizationId: "organization-a", role: "ADMIN", status: "authenticated",
  stores: [{ id: "allowed-store", name: "Store" }],
  storeError: null as null | { message: string; data: { code: string } },
  navigate: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => window.location.pathname,
  useRouter: () => ({ replace: scope.navigate }),
  // Next integrates native history with this hook. The browser regression verifies
  // that integration; this unit explicitly rerenders after replacing its URL.
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: scope.userId, organizationId: scope.organizationId, role: scope.role } }, status: scope.status }),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/trpc", () => ({ trpc: { stores: { list: { useQuery: () => ({
  data: scope.stores, error: scope.storeError, isFetching: false,
}) } } } }));

import { useReportScope } from "@/components/reports/report-controls";

beforeEach(() => {
  scope.userId = "owner"; scope.organizationId = "organization-a";
  scope.role = "ADMIN"; scope.status = "authenticated"; scope.storeError = null;
  scope.navigate.mockClear();
  window.history.replaceState(null, "", "/reports/analytics?dateFrom=2026-09-02&dateTo=2026-09-03&storeId=allowed-store&search=coffee&page=3");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("report client filter navigation", () => {
  it("replaces only the current URL entry while preserving scope/date/search and resetting pagination", () => {
    const historyLength = window.history.length;
    const replace = vi.spyOn(window.history, "replaceState");
    const { result, rerender } = renderHook(() => useReportScope("sales"));
    act(() => result.current.update({ view: "categories", sort: "name" }));
    expect(replace).toHaveBeenCalledTimes(1);
    expect(scope.navigate).not.toHaveBeenCalled();
    // Passing the existing __NA state would bypass Next's URL-hook integration.
    expect(replace.mock.calls[0]?.slice(0, 2)).toEqual([null, ""]);
    expect(window.history.length).toBe(historyLength);
    expect(window.location.pathname).toBe("/reports/analytics");
    const params = new URLSearchParams(window.location.search);
    expect(Object.fromEntries(params)).toMatchObject({ dateFrom: "2026-09-02", dateTo: "2026-09-03", storeId: "allowed-store", search: "coffee", view: "categories", sort: "name" });
    expect(params.has("page")).toBe(false);
    expect(params.has("valid")).toBe(false);
    expect(params.has("report")).toBe(false);
    rerender();
    expect(result.current.state).toMatchObject({ view: "categories", sort: "name", page: 1, storeId: "allowed-store" });
  });

  it("applies the latest search draft, supports clearing filters, and invalidates the previous export guard", () => {
    const { result, rerender } = renderHook(() => useReportScope("sales"));
    const before = result.current.exportGuard();
    expect(before()).toBe(true);
    act(() => result.current.setSearch("tea"));
    expect(before()).toBe(false);
    const draft = result.current.exportGuard();
    act(() => result.current.update({ storeId: undefined, direction: "asc" }));
    rerender();
    expect(draft()).toBe(false);
    expect(result.current.search).toBe("tea");
    expect(result.current.state).toMatchObject({ direction: "asc", page: 1 });
    expect(result.current.state.storeId).toBeUndefined();
    expect(new URLSearchParams(window.location.search).get("search")).toBe("tea");
  });

  it("restores a deep-linked query on remount without rewriting history or dropping its filters", () => {
    window.history.replaceState(null, "", "/reports/analytics?dateFrom=2026-09-02&dateTo=2026-09-03&view=customers&sort=profit&direction=asc&page=2");
    const replace = vi.spyOn(window.history, "replaceState");
    const { result, unmount } = renderHook(() => useReportScope("sales"));
    expect(result.current.state).toMatchObject({ view: "customers", sort: "profit", direction: "asc", page: 2 });
    unmount();
    const restored = renderHook(() => useReportScope("sales"));
    expect(restored.result.current.state).toMatchObject({ view: "customers", sort: "profit", direction: "asc", page: 2 });
    expect(replace).not.toHaveBeenCalled();
  });

  it("invalidates an export across an account or role change and continues enforcing store access", () => {
    const { result, rerender } = renderHook(() => useReportScope("sales"));
    const guard = result.current.exportGuard();
    scope.userId = "cashier"; scope.organizationId = "organization-b"; scope.role = "CASHIER";
    rerender();
    expect(guard()).toBe(false);
    expect(result.current.enabled).toBe(false);
    expect(result.current.error).toBe("forbidden");
    scope.role = "ADMIN"; rerender();
    act(() => result.current.update({ storeId: "not-assigned" }));
    rerender();
    expect(result.current.enabled).toBe(false);
    expect(result.current.error).toBe("storeAccessDenied");
  });
});
