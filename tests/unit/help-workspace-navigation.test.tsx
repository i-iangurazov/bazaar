// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { buildHelpHomeData } from "@/content/help/home-data";
import { localizedUi } from "@/content/help/ui";
import type { Locale } from "@/lib/locales";

const state = vi.hoisted(() => ({ locale: "ru", refresh: vi.fn(), fetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock("next-intl", () => ({
  useLocale: () => state.locale,
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock("next/image", () => ({
  default: ({
    fill: _fill,
    priority: _priority,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; priority?: boolean }) => (
    <img {...props} />
  ),
}));
vi.mock("@/components/help/help-analytics", () => ({ trackHelpEvent: vi.fn() }));
import { HelpHome } from "@/components/help/HelpHome";
import { HelpLocaleSwitcher } from "@/components/help/HelpLocaleSwitcher";

beforeEach(() => {
  vi.clearAllMocks();
  state.locale = "ru";
  localStorage.clear();
  vi.stubGlobal("fetch", state.fetch);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each(["ru", "kg", "en"] as Locale[])("public guide navigation in %s", (locale) => {
  const setup = () => {
    state.locale = locale;
    const data = buildHelpHomeData(locale);
    render(<HelpHome locale={locale} data={data} />);
    return { data, ui: localizedUi(locale) };
  };
  it("links employee creation and the first getting-started step to the correct instructions", () => {
    setup();
    const employee = { ru: "Добавить сотрудника", kg: "Кызматкер кошуу", en: "Add an employee" }[
      locale
    ];
    expect(
      screen.getByRole("link", { name: new RegExp(`^${employee} `) }).getAttribute("href"),
    ).toBe("/help/settings/add-employee");
    const first = document.querySelector("[data-help-journey-step]")!;
    expect(
      within(first as HTMLElement)
        .getByRole("link")
        .getAttribute("href"),
    ).toBe("/help/getting-started/choose-store");
  });
  it("clears an unsuccessful search with Escape and removes dangling popup relationships", () => {
    const { ui } = setup();
    const search = screen.getByRole("combobox", { name: ui.searchLabel });
    expect(search.getAttribute("aria-activedescendant")).toBeNull();
    expect(search.getAttribute("aria-controls")).toBeNull();
    fireEvent.change(search, { target: { value: "ZZZ-UNMATCHED-79342" } });
    expect(screen.getByText(ui.noResults)).toBeTruthy();
    fireEvent.keyDown(search, { key: "Escape" });
    expect((search as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("listbox")).toBeNull();
  });
  it("focuses the search using the advertised Ctrl/Command K shortcut", () => {
    const { ui } = setup();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(document.activeElement).toBe(screen.getByRole("combobox", { name: ui.searchLabel }));
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(document.activeElement).toBe(screen.getByRole("combobox", { name: ui.searchLabel }));
  });
  it("moves through role tabs using arrows, Home and End with one tab stop", () => {
    setup();
    const tabs = screen.getAllByRole("tab");
    tabs[0].focus();
    for (const [key, index] of [
      ["ArrowRight", 1],
      ["End", 3],
      ["ArrowRight", 0],
      ["Home", 0],
    ] as const) {
      fireEvent.keyDown(document.activeElement!, { key });
      expect(document.activeElement).toBe(tabs[index]);
      expect(tabs[index].getAttribute("aria-selected")).toBe("true");
      expect(tabs.filter((tab) => tab.tabIndex === 0)).toHaveLength(1);
      expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(tabs[index].id);
    }
  });
  it("keeps progress usable when the browser refuses local storage writes", () => {
    const { ui } = setup();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    fireEvent.click(screen.getAllByRole("button", { name: ui.markDone })[0]);
    expect(screen.getByRole("button", { name: ui.completed }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: ui.resetProgress }));
    expect(screen.queryByRole("button", { name: ui.completed })).toBeNull();
  });
});

describe("public help language recovery", () => {
  it.each(["network", "http"])(
    "keeps the current language and offers retry after a %s failure",
    async (failure) => {
      if (failure === "network") state.fetch.mockRejectedValueOnce(new Error("Offline"));
      else state.fetch.mockResolvedValueOnce({ ok: false });
      state.fetch.mockResolvedValue({ ok: true });
      render(<HelpLocaleSwitcher />);
      fireEvent.click(screen.getByRole("button", { name: "EN" }));
      expect((await screen.findByRole("alert")).textContent).toBe("errors.genericMessage");
      expect(state.refresh).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "RU" }).getAttribute("aria-pressed")).toBe("true");
      fireEvent.click(screen.getByRole("button", { name: "EN" }));
      await waitFor(() => expect(state.refresh).toHaveBeenCalledOnce());
      expect(screen.queryByRole("alert")).toBeNull();
      expect(JSON.parse(state.fetch.mock.calls[1][1].body)).toEqual({ locale: "en" });
    },
  );
});
