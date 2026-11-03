// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProductListSearch } from "@/components/products/product-list-search";
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/camera-scan-button", () => ({
  CameraScanButton: ({ onScan }: { onScan: (value: string) => void }) => (
    <button onClick={() => onScan("9900000000012")}>scan</button>
  ),
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const setup = (value = "") => {
  vi.useFakeTimers();
  const change = vi.fn();
  const props = {
    value,
    onChange: change,
    scopeKey: "org:store-a",
    label: "Search",
    cameraScan: true,
  };
  const view = render(<ProductListSearch {...props} />);
  return { ...view, props, change, input: view.getByRole("searchbox") as HTMLInputElement };
};
it("shows every character immediately and commits one search after a typing burst", () => {
  const { input, change } = setup();
  for (const value of ["к", "кр", "кра", "кран", "кран фланцевый"])
    fireEvent.change(input, { target: { value } });
  expect(input.value).toBe("кран фланцевый");
  expect(change).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(249));
  expect(change).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(change.mock.calls).toEqual([["кран фланцевый"]]);
});
it("Enter, camera scan, blur and clear commit immediately without a duplicate delayed request", () => {
  const v = setup();
  fireEvent.change(v.input, { target: { value: "кран" } });
  fireEvent.keyDown(v.input, { key: "Enter" });
  expect(v.change.mock.calls).toEqual([["кран"]]);
  fireEvent.click(v.getByRole("button", { name: "scan" }));
  expect(v.change).toHaveBeenLastCalledWith("9900000000012");
  fireEvent.change(v.input, { target: { value: "paste" } });
  fireEvent.blur(v.input);
  expect(v.change).toHaveBeenLastCalledWith("paste");
  fireEvent.click(v.getByRole("button", { name: "clearSearch" }));
  expect(v.input.value).toBe("");
  expect(v.change).toHaveBeenLastCalledWith("");
  act(() => vi.runOnlyPendingTimers());
  expect(v.change).toHaveBeenCalledTimes(4);
});
it("does not search an unfinished IME composition or submit its Enter", () => {
  const v = setup();
  fireEvent.compositionStart(v.input);
  fireEvent.change(v.input, { target: { value: "кран" } });
  fireEvent.keyDown(v.input, { key: "Enter", isComposing: true });
  act(() => vi.advanceTimersByTime(1000));
  expect(v.change).not.toHaveBeenCalled();
  fireEvent.compositionEnd(v.input, { data: "кран" });
  act(() => vi.advanceTimersByTime(250));
  expect(v.change).toHaveBeenCalledWith("кран");
});
it("cancels pending text on external navigation, scope change, disable and unmount", () => {
  const v = setup("old");
  fireEvent.change(v.input, { target: { value: "pending" } });
  v.rerender(<ProductListSearch {...v.props} value="from-back" />);
  expect(v.input.value).toBe("from-back");
  act(() => vi.advanceTimersByTime(300));
  expect(v.change).not.toHaveBeenCalled();
  fireEvent.change(v.input, { target: { value: "private" } });
  v.rerender(<ProductListSearch {...v.props} value="other" scopeKey="org-b:store-b" />);
  act(() => vi.advanceTimersByTime(300));
  expect(v.input.value).toBe("other");
  expect(v.change).not.toHaveBeenCalled();
  fireEvent.change(v.input, { target: { value: "disabled" } });
  v.rerender(<ProductListSearch {...v.props} disabled />);
  act(() => vi.advanceTimersByTime(300));
  expect(v.change).not.toHaveBeenCalled();
  v.rerender(<ProductListSearch {...v.props} />);
  fireEvent.change(v.input, { target: { value: "unmounted" } });
  v.unmount();
  act(() => vi.advanceTimersByTime(300));
  expect(v.change).not.toHaveBeenCalled();
});
it("does not overwrite a newer local draft when its own earlier commit is acknowledged", () => {
  const v = setup();
  fireEvent.change(v.input, { target: { value: "кран" } });
  act(() => vi.advanceTimersByTime(250));
  fireEvent.change(v.input, { target: { value: "кран ф" } });
  v.rerender(<ProductListSearch {...v.props} value="кран" />);
  expect(v.input.value).toBe("кран ф");
  act(() => vi.advanceTimersByTime(250));
  expect(v.change).toHaveBeenLastCalledWith("кран ф");
});
