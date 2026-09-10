// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { commonListFields, readListUrl, useScopedListState } from "@/lib/useScopedListState";

const defaults = {
  storeId: "",
  search: "",
  page: 1,
  pageSize: 25,
  sort: { key: "name", direction: "asc" },
  viewMode: "table",
  readiness: "all",
};
const schema = z.object({
  storeId: z.string(),
  search: z.string(),
  page: z.number().int().positive(),
  pageSize: z.number().int().min(1).max(200),
  sort: z.object({ key: z.enum(["name", "price"]), direction: z.enum(["asc", "desc"]) }),
  viewMode: z.enum(["table", "grid"]),
  readiness: z.enum(["all", "missingPrice"]),
});
const parse = (raw: string): typeof defaults | null => {
  const result = schema.safeParse(JSON.parse(raw));
  return result.success ? result.data : null;
};
const fields = [...commonListFields, { key: "readiness", param: "readiness" }];
const navigate = (url: string) => {
  window.history.pushState({}, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
};
beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, "", "/products");
});
afterEach(cleanup);
describe("durable, organization-scoped list navigation", () => {
  it("waits for a client navigation to commit instead of adopting the previous page as its owner", () => {
    navigate("/dashboard?storeId=a");
    const { result } = renderHook(() =>
      useScopedListState({
        pathname: "/products",
        storageKey: "a",
        defaultValue: defaults,
        fields,
        parse,
      }),
    );
    expect(result.current.isReady).toBe(false);
    expect(window.location.pathname).toBe("/dashboard");
    act(() => navigate("/products?storeId=a&readiness=missingPrice"));
    expect(result.current.isReady).toBe(true);
    expect(result.current.value).toMatchObject({ storeId: "a", readiness: "missingPrice" });
    act(() => result.current.setValue((value) => ({ ...value, search: "tea" })));
    expect(new URLSearchParams(window.location.search).get("q")).toBe("tea");
  });
  it("opens dashboard filters without inheriting hidden search from an older list", () => {
    expect(
      readListUrl(
        new URLSearchParams("storeId=shop&readiness=missingPrice"),
        { ...defaults, search: "hidden", page: 5, pageSize: 50 },
        defaults,
        fields,
        parse,
      ),
    ).toMatchObject({
      storeId: "shop",
      readiness: "missingPrice",
      search: "",
      page: 1,
      pageSize: 50,
    });
  });
  it("rejects invalid page/sort values independently, preserving valid filters", () => {
    expect(
      readListUrl(
        new URLSearchParams("page=-1&sortBy=unknown&readiness=missingPrice&query=tea"),
        defaults,
        defaults,
        fields,
        parse,
      ),
    ).toMatchObject({ page: 1, sort: defaults.sort, search: "tea", readiness: "missingPrice" });
  });
  it("clears a deep-linked filter, persists it and restores browser navigation", () => {
    navigate("/products?storeId=a&readiness=missingPrice&returnTo=%2Fdashboard");
    const { result } = renderHook(() =>
      useScopedListState({
        pathname: "/products",
        storageKey: "org-a:user",
        defaultValue: defaults,
        parse,
        fields,
      }),
    );
    expect(result.current.value.readiness).toBe("missingPrice");
    act(() =>
      result.current.setValue((current) => ({
        ...current,
        readiness: "all",
        search: "tea",
        page: 3,
      })),
    );
    expect(result.current.value).toMatchObject({ readiness: "all", search: "tea", page: 3 });
    expect(new URLSearchParams(window.location.search).get("returnTo")).toBe("/dashboard");
    expect(JSON.parse(localStorage.getItem("org-a:user")!).search).toBe("tea");
    act(() => navigate("/products?storeId=a&readiness=missingPrice"));
    expect(result.current.value).toMatchObject({ readiness: "missingPrice", search: "", page: 1 });
  });
  it("never carries a previous organization's URL or a delayed setter into the next one", () => {
    navigate("/products?storeId=a&query=private");
    localStorage.setItem("b", JSON.stringify({ ...defaults, storeId: "b", search: "own" }));
    const { result, rerender } = renderHook(
      ({ scope }) =>
        useScopedListState({
          pathname: "/products",
          storageKey: scope,
          defaultValue: defaults,
          parse,
          fields,
        }),
      { initialProps: { scope: "a" } },
    );
    const delayed = result.current.setValue;
    rerender({ scope: "b" });
    expect(result.current.value).toMatchObject({ storeId: "b", search: "own" });
    act(() => delayed({ ...defaults, storeId: "a", search: "late" }));
    expect(result.current.value.search).toBe("own");
    expect(new URLSearchParams(window.location.search).get("storeId")).toBe("b");
  });
});
