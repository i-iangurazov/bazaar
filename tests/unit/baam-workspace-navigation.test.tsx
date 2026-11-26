// @vitest-environment jsdom
import { useState, type ComponentProps, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../messages/en.json";
import ru from "../../messages/ru.json";
import kg from "../../messages/kg.json";
import BaamPage from "@/app/(app)/baam/page";
import styles from "@/components/baam-native-workspace.module.css";
import { baamPathname, baamWorkspaceHref, baamWorkspaceReturnHref } from "@/lib/baam/workspaceNavigation";

const native = vi.hoisted(() => ({ ios: true, search: "" }));
vi.mock("@/lib/native/platform", () => ({ isIOS: () => native.ios }));
vi.mock("next/navigation", () => ({ usePathname: () => "/baam", useSearchParams: () => new URLSearchParams(native.search) }));
vi.mock("next/link", () => ({ default: ({ href, replace, prefetch: _prefetch, ...props }: ComponentProps<"a"> & { href: string; replace?: boolean; prefetch?: boolean }) =>
  <a {...props} href={href} data-replaces-route={replace ? "true" : undefined} /> }));
vi.mock("@/components/baam-assistant", () => ({ BaamAssistant: function Assistant({ nativeViewport, workspaceHeader }: { nativeViewport?: boolean; workspaceHeader?: ReactNode }) {
  const [draft, setDraft] = useState("");
  return <div data-testid="existing-baam-assistant" data-native-viewport={nativeViewport ? "true" : "false"}>
    {workspaceHeader}
    Existing history/composer surface
    <input aria-label="Workspace draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
  </div>;
} }));

const translations = { en, ru, kg };
beforeEach(() => { native.ios = true; native.search = ""; });
afterEach(() => {
  cleanup();
  document.querySelectorAll("[data-native-bottom-nav]").forEach(element => element.remove());
  delete document.documentElement.dataset.nativeKeyboard;
  document.documentElement.style.removeProperty("--native-available-height");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("native BAAM workspace navigation", () => {
  it("carries only a valid explicit store hint and an internal return destination", () => {
    const href = baamWorkspaceHref({ pathname: "/kg/inventory", search: "?storeId=store_1&page=3", hash: "#product" });
    const url = new URL(href, "https://bazaar.invalid");
    expect(url.pathname).toBe("/baam");
    expect(url.searchParams.get("storeId")).toBe("store_1");
    expect(url.searchParams.get("returnTo")).toBe("/kg/inventory?storeId=store_1&page=3#product");
    const invalid = new URL(baamWorkspaceHref({ pathname: "/products", search: "?storeId=%2Funsafe", hash: "" }), "https://bazaar.invalid");
    expect(invalid.searchParams.has("storeId")).toBe(false);
  });

  it.each([undefined, "", "https://outside.invalid", "//outside.invalid", "/\\outside.invalid", "/baam", "/kg/baam/?returnTo=other"])(
    "uses a safe dashboard fallback for unsupported return target %s", (value) => {
      expect(baamWorkspaceReturnHref(value)).toBe("/dashboard");
    },
  );

  it.each(["/baam", "/ru/baam/", "/en/baam?storeId=a", "/ky/baam#question"])("recognizes the existing localized workspace %s", (pathname) => {
    expect(baamPathname(pathname)).toBe("/baam");
  });

  it.each(["en", "ru", "kg"] as const)("shows a localized iOS back action to the original filtered page in %s", (locale) => {
    native.search = new URLSearchParams({ returnTo: "/inventory?storeId=store_1&page=3#product" }).toString();
    render(<NextIntlClientProvider locale={locale} messages={translations[locale]}><BaamPage /></NextIntlClientProvider>);
    const back = screen.getByRole("link", { name: translations[locale].common.back });
    expect(back.getAttribute("href")).toBe("/inventory?storeId=store_1&page=3#product");
    expect(back.getAttribute("data-replaces-route")).toBe("true");
    expect(screen.getByTestId("existing-baam-assistant")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps direct iOS entries safe when there is no previous app page", () => {
    native.search = "returnTo=https%3A%2F%2Foutside.invalid";
    render(<NextIntlClientProvider locale="en" messages={en}><BaamPage /></NextIntlClientProvider>);
    expect(screen.getByRole("link", { name: en.common.back }).getAttribute("href")).toBe("/dashboard");
  });

  it("preserves the existing web full page without the native back action", () => {
    native.ios = false;
    render(<NextIntlClientProvider locale="en" messages={en}><BaamPage /></NextIntlClientProvider>);
    expect(screen.queryByRole("link", { name: en.common.back })).toBeNull();
    expect(screen.getByTestId("existing-baam-assistant")).toBeTruthy();
    expect(screen.getByTestId("existing-baam-assistant").getAttribute("data-native-viewport")).toBe("false");
    expect(screen.getByTestId("baam-page").style.getPropertyValue("--baam-workspace-top")).toBe("");
  });

  it("fits a mobile browser's keyboard viewport and keeps its typed draft focused", () => {
    native.ios = false;
    let height = 844;
    let top = 0;
    const viewport = new EventTarget();
    Object.defineProperties(viewport, {
      height: { get: () => height },
      offsetTop: { get: () => top },
    });
    vi.stubGlobal("visualViewport", viewport);
    vi.stubGlobal("matchMedia", () => ({
      matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute("data-native-bottom-nav")) return new DOMRect(0, 780, 390, 64);
      return new DOMRect(0, 96, 390, 0);
    });
    const nav = document.createElement("nav");
    nav.setAttribute("data-native-bottom-nav", "");
    document.body.append(nav);
    render(<NextIntlClientProvider locale="en" messages={en}><BaamPage /></NextIntlClientProvider>);
    const workspace = screen.getByTestId("baam-page");
    const draft = screen.getByRole("textbox", { name: "Workspace draft" });
    expect(workspace.style.getPropertyValue("--baam-visible-height")).toBe("844px");
    expect(workspace.style.getPropertyValue("--baam-workspace-bottom")).toBe("72px");
    fireEvent.change(draft, { target: { value: "Mobile draft" } });
    draft.focus();
    act(() => {
      height = 360;
      top = 30;
      viewport.dispatchEvent(new Event("resize"));
    });
    expect(workspace.style.getPropertyValue("--baam-visible-height")).toBe("360px");
    expect(workspace.style.getPropertyValue("--baam-workspace-top")).toBe("66px");
    expect(workspace.style.getPropertyValue("--baam-workspace-bottom")).not.toBe("72px");
    expect(document.activeElement).toBe(draft);
    expect((draft as HTMLInputElement).value).toBe("Mobile draft");
  });

  it("shows the in-app return from a mobile web workspace opened by the launcher", () => {
    native.ios = false;
    native.search = new URLSearchParams({ returnTo: "/products?storeId=store_1#items" }).toString();
    vi.stubGlobal("matchMedia", () => ({
      matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    render(<NextIntlClientProvider locale="en" messages={en}><BaamPage /></NextIntlClientProvider>);
    const back = screen.getByRole("link", { name: en.common.back });
    expect(back.getAttribute("href")).toBe("/products?storeId=store_1#items");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("tracks the actual iOS workspace top and visible navigation without remounting a focused draft", async () => {
    let top = 124, navHeight = 84;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return new DOMRect(0, this.hasAttribute("data-baam-workspace") ? top : 0, 390,
        this.hasAttribute("data-native-bottom-nav") ? navHeight : 0);
    });
    const nav = document.createElement("nav");
    nav.setAttribute("data-native-bottom-nav", "");
    document.body.append(nav);
    const view = render(<NextIntlClientProvider locale="en" messages={en}><BaamPage /></NextIntlClientProvider>);
    const workspace = screen.getByTestId("baam-page");
    const draft = screen.getByRole("textbox", { name: "Workspace draft" });
    expect(workspace.style.getPropertyValue("--baam-workspace-top")).toBe("124px");
    expect(workspace.style.getPropertyValue("--baam-workspace-bottom")).toBe("92px");
    expect(screen.getByTestId("existing-baam-assistant").getAttribute("data-native-viewport")).toBe("true");
    fireEvent.change(draft, { target: { value: "Keep this draft while typing" } });
    draft.focus();
    await act(async () => {
      top = 100; navHeight = 0;
      document.documentElement.dataset.nativeKeyboard = "visible";
      document.documentElement.style.setProperty("--native-available-height", "460px");
      fireEvent.resize(window);
    });
    expect(workspace.style.getPropertyValue("--baam-workspace-top")).toBe("100px");
    expect(workspace.style.getPropertyValue("--baam-workspace-bottom")).toBe("8px");
    expect(screen.getByRole("textbox", { name: "Workspace draft" })).toBe(draft);
    expect((draft as HTMLInputElement).value).toBe("Keep this draft while typing");
    expect(document.activeElement).toBe(draft);
    view.unmount();
    await act(async () => {
      top = 300;
      document.documentElement.dataset.nativeKeyboard = "hidden";
      fireEvent.resize(window);
    });
    expect(workspace.style.getPropertyValue("--baam-workspace-top")).toBe("");
    expect(workspace.style.getPropertyValue("--baam-workspace-bottom")).toBe("");
  });

  it("does not grow the iPhone chat if keyboard focus briefly scrolls the document", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    vi.stubGlobal("scrollY", 0);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return new DOMRect(0, this.hasAttribute("data-baam-workspace") ? 96 - window.scrollY : 0, 390, 0);
    });
    const view = render(<NextIntlClientProvider locale="en" messages={en}><BaamPage /></NextIntlClientProvider>);
    const workspace = screen.getByTestId("baam-page");
    const draft = screen.getByRole("textbox", { name: "Workspace draft" });
    expect(workspace.style.getPropertyValue("--baam-workspace-top")).toBe("96px");
    expect(document.documentElement.classList.contains(styles.nativeWorkspace)).toBe(true);

    fireEvent.change(draft, { target: { value: "Unsent question" } });
    draft.focus();
    vi.stubGlobal("scrollY", 48);
    fireEvent.scroll(window);
    expect(workspace.style.getPropertyValue("--baam-workspace-top")).toBe("96px");
    expect((draft as HTMLInputElement).value).toBe("Unsent question");
    expect(document.activeElement).toBe(draft);
    view.unmount();
    expect(document.documentElement.classList.contains(styles.nativeWorkspace)).toBe(false);
  });

  it("moves real title/back navigation into short native content without replacing the focused draft", async () => {
    let height = 500;
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute("data-baam-workspace") ? height : 0;
    });
    render(<NextIntlClientProvider locale="en" messages={en}><BaamPage /></NextIntlClientProvider>);
    const assistant = screen.getByTestId("existing-baam-assistant");
    const draft = screen.getByRole("textbox", { name: "Workspace draft" });
    const normalBack = screen.getByRole("link", { name: en.common.back });
    expect(assistant.contains(normalBack)).toBe(false);
    fireEvent.change(draft, { target: { value: "Keep the landscape draft" } });
    draft.focus();
    await act(async () => { height = 120; fireEvent.resize(window); });
    const compactBack = screen.getByRole("link", { name: en.common.back });
    expect(assistant.contains(compactBack)).toBe(true);
    expect(assistant.contains(screen.getByRole("heading", { level: 1, name: en.baam.title }))).toBe(true);
    expect(compactBack.getAttribute("href")).toBe("/dashboard");
    expect(screen.getByRole("textbox", { name: "Workspace draft" })).toBe(draft);
    expect(document.activeElement).toBe(draft);
    expect((draft as HTMLInputElement).value).toBe("Keep the landscape draft");
    await act(async () => { height = 500; fireEvent.resize(window); });
    expect(assistant.contains(screen.getByRole("link", { name: en.common.back }))).toBe(false);
    expect(screen.getByRole("textbox", { name: "Workspace draft" })).toBe(draft);
    expect(document.activeElement).toBe(draft);
    expect((draft as HTMLInputElement).value).toBe("Keep the landscape draft");
  });
});
