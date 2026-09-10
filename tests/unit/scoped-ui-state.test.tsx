// @vitest-environment jsdom
import { act, renderHook, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useScopedLocalStorageState } from "@/lib/useScopedLocalStorageState";
const defaultValue = { storeId: "", search: "" };
const parse = (raw: string): typeof defaultValue | null => {
  const data = JSON.parse(raw);
  return typeof data?.storeId === "string" && typeof data?.search === "string" ? data : null;
};
const useStateFor = (key: string | null) =>
  useScopedLocalStorageState({ storageKey: key, defaultValue, parse });
beforeEach(() => localStorage.clear());
afterEach(cleanup);
describe("UI preferences owned by user and organization", () => {
  it("hydrates each scope without writing the preceding organization's filters into it", () => {
    localStorage.setItem("org-a", JSON.stringify({ storeId: "a", search: "tea" }));
    localStorage.setItem("org-b", JSON.stringify({ storeId: "b", search: "coffee" }));
    const { result, rerender } = renderHook(({ scope }) => useStateFor(scope), {
      initialProps: { scope: "org-a" },
    });
    const oldSetter = result.current.setValue;
    rerender({ scope: "org-b" });
    expect(result.current.value).toEqual({ storeId: "b", search: "coffee" });
    expect(JSON.parse(localStorage.getItem("org-b")!)).toEqual({ storeId: "b", search: "coffee" });
    act(() => oldSetter({ storeId: "a", search: "late response" }));
    expect(result.current.value.search).toBe("coffee");
    rerender({ scope: "org-a" });
    expect(result.current.value).toEqual({ storeId: "a", search: "tea" });
  });
  it("keeps functional edits and ignores invalid stored preferences", () => {
    localStorage.setItem("invalid", '{"unexpected":true}');
    const { result } = renderHook(() => useStateFor("invalid"));
    expect(result.current.hasStoredValue).toBe(false);
    act(() => result.current.setValue((previous) => ({ ...previous, search: "rice" })));
    expect(JSON.parse(localStorage.getItem("invalid")!).search).toBe("rice");
  });
  it("drops private filters on sign-out and does not persist them without a scope", () => {
    const { result, rerender } = renderHook(
      ({ scope }: { scope: string | null }) => useStateFor(scope),
      { initialProps: { scope: "user" as string | null } },
    );
    act(() => result.current.setValue({ storeId: "store", search: "private" }));
    rerender({ scope: null });
    expect(result.current.value).toEqual(defaultValue);
    expect(localStorage.getItem("null")).toBeNull();
  });
});
