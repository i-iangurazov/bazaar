// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import {
  DisplayScaleProvider,
  DisplayScaleSettings,
  displayScaleKey,
} from "@/components/display-scale";
import en from "../../messages/en.json";
const Fixture = ({ enabled = true }: { enabled?: boolean }) => (
  <NextIntlClientProvider locale="en" messages={{ profile: en.profile }}>
    <DisplayScaleProvider enabled={enabled}>
      <DisplayScaleSettings />
    </DisplayScaleProvider>
  </NextIntlClientProvider>
);
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});
describe("saved desktop scale", () => {
  it("defaults to automatic and cleans up when leaving the app", () => {
    const view = render(<Fixture />);
    expect(document.documentElement.dataset.bazaarScale).toBe("auto");
    view.unmount();
    expect(document.documentElement.dataset.bazaarScale).toBeUndefined();
  });
  it("restores saved preference and ignores invalid values", () => {
    localStorage.setItem(displayScaleKey, "125");
    const view = render(<Fixture />);
    expect(document.documentElement.dataset.bazaarScale).toBe("125");
    view.unmount();
    localStorage.setItem(displayScaleKey, "999");
    render(<Fixture />);
    expect(document.documentElement.dataset.bazaarScale).toBe("auto");
  });
  it("applies a keyboard-selected scale immediately and persists it", async () => {
    Element.prototype.scrollIntoView ??= () => {};
    const user = userEvent.setup();
    render(<Fixture />);
    const select = screen.getByRole("combobox", { name: "Large-screen scale" });
    select.focus();
    await user.keyboard("{Enter}");
    await user.click(await screen.findByRole("option", { name: "125%" }));
    expect(localStorage.getItem(displayScaleKey)).toBe("125");
    await waitFor(() => expect(document.documentElement.dataset.bazaarScale).toBe("125"));
  });
  it("synchronizes preference changes from another tab", () => {
    render(<Fixture />);
    fireEvent(window, new StorageEvent("storage", { key: displayScaleKey, newValue: "110" }));
    expect(document.documentElement.dataset.bazaarScale).toBe("110");
  });
  it("does not scale document/print routes when disabled", () => {
    localStorage.setItem(displayScaleKey, "125");
    render(<Fixture enabled={false} />);
    expect(document.documentElement.dataset.bazaarScale).toBeUndefined();
  });
  it("survives unavailable storage and explains the limitation", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw Error("blocked");
    });
    render(<Fixture />);
    expect(screen.getByRole("status").textContent).toContain("cannot save");
    expect(document.documentElement.dataset.bazaarScale).toBe("auto");
  });
});
