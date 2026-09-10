// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import messages from "../../messages/en.json";
import { BaamLauncher, canShowBaamLauncher } from "@/components/baam-launcher";

const launcher = (role = "ADMIN", pathname = "/dashboard") => (
  <NextIntlClientProvider
    locale="en"
    messages={{
      baam: { title: messages.baam.title, assistant: messages.baam.assistant },
      common: { close: messages.common.close },
    }}
  >
    <div data-baam-desktop-slot />
    <div data-baam-mobile-slot />
    <BaamLauncher access={{ role, isOrgOwner: true, isPlatformOwner: true }} pathname={pathname}>
      <button type="button">Ask a supported question</button>
    </BaamLauncher>
  </NextIntlClientProvider>
);

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  },
);
afterEach(cleanup);

it("keeps a single launcher in its reserved header slot at mobile and desktop widths", async () => {
  const previousWidth = window.innerWidth;
  try {
    window.innerWidth = 390;
    const view = render(launcher());
    const slot = view.container.querySelector("[data-baam-mobile-slot]")!;
    await waitFor(() => expect(slot.querySelector("[data-baam-launcher]")).toBeTruthy());
    expect(document.querySelectorAll("[data-baam-launcher]")).toHaveLength(1);
    window.innerWidth = 1440;
    fireEvent(window, new Event("resize"));
    await waitFor(() => expect(slot.querySelector("[data-baam-launcher]")).toBeNull());
    expect(document.querySelector("[data-baam-launcher]")?.parentElement).toBe(
      view.container.querySelector("[data-baam-desktop-slot]"),
    );
    expect(document.querySelectorAll("[data-baam-launcher]")).toHaveLength(1);
    expect(document.querySelector("[data-baam-launcher]")?.classList.contains("fixed")).toBe(false);
  } finally {
    window.innerWidth = previousWidth;
  }
});

describe("BAAM assistant launcher", () => {
  it.each(["ADMIN", "MANAGER"])(
    "lets %s open an accessible assistant dialog and full workspace link",
    (role) => {
      render(launcher(role));
      fireEvent.click(screen.getByRole("button", { name: "Open BAAM assistant" }));
      expect(screen.getByRole("dialog", { name: "BAAM" })).toBeTruthy();
      expect(screen.getByRole("link", { name: "Open full page" }).getAttribute("href")).toBe(
        "/baam",
      );
      expect(screen.getByRole("button", { name: "Ask a supported question" })).toBeTruthy();
    },
  );

  it.each(["STAFF", "CASHIER", "UNKNOWN"])(
    "does not elevate %s through ownership flags",
    (role) => {
      render(launcher(role));
      expect(screen.queryByRole("button", { name: "Open BAAM assistant" })).toBeNull();
    },
  );

  it.each([
    "/pos",
    "/pos/",
    "/en/pos?store=one",
    "/pos/history",
    "/pos/receipts",
    "/pos/seller",
    "/products",
    "/inventory",
    "/inventory/overview",
    "/reports/receipts",
    "/cash",
    "/finance/income",
    "/finance/expense",
    "/help/pos",
  ])("shows the launcher at %s", (pathname) => {
    render(launcher("ADMIN", pathname));
    expect(screen.getByRole("button", { name: "Open BAAM assistant" })).toBeTruthy();
  });

  it.each([
    "/pos/sell",
    "/pos/sell/",
    "/pos/sell?registerId=one",
    "/pos/sell/?saleId=two#cart",
    "/ru/pos/sell",
    "/en/pos/sell/",
    "/kg/pos/sell?registerId=one",
    "/ky/pos/sell/",
  ])("excludes only the checkout route variant %s for both allowed roles", (pathname) => {
    for (const role of ["ADMIN", "MANAGER"]) {
      expect(canShowBaamLauncher({ role }, pathname)).toBe(false);
    }
  });

  it.each(["ADMIN", "MANAGER"])(
    "hides an open assistant on checkout and restores its launcher after leaving for %s",
    async (role) => {
      const view = render(launcher(role, "/pos"));
      fireEvent.click(screen.getByRole("button", { name: "Open BAAM assistant" }));
      expect(screen.getByRole("dialog")).toBeTruthy();
      view.rerender(launcher(role, "/ru/pos/sell/?registerId=one"));
      expect(screen.queryByRole("button", { name: "Open BAAM assistant" })).toBeNull();
      expect(screen.queryByRole("dialog")).toBeNull();
      view.rerender(launcher(role, "/inventory"));
      expect(screen.queryByRole("dialog")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Open BAAM assistant" }));
      expect(screen.getByRole("button", { name: "Ask a supported question" })).toBeTruthy();
    },
  );

  it("hides the launcher on printed documents", () => {
    render(launcher("ADMIN", "/printing/receipt"));
    expect(screen.queryByRole("button", { name: "Open BAAM assistant" })).toBeNull();
  });

  it.each(["ADMIN", "MANAGER"])(
    "keeps the workspace circle visible for %s and focuses the existing question",
    (role) => {
      render(
        <>
          <section data-baam-workspace tabIndex={-1}>
            <textarea data-baam-input aria-label="Your BAAM question" defaultValue="My draft" />
          </section>
          {launcher(role, "/baam")}
        </>,
      );
      const question = screen.getByRole("textbox", { name: "Your BAAM question" });
      question.scrollIntoView = vi.fn();
      fireEvent.click(screen.getByRole("button", { name: "Open BAAM assistant" }));
      expect(document.activeElement).toBe(question);
      expect(question.scrollIntoView).toHaveBeenCalled();
      expect((question as HTMLTextAreaElement).value).toBe("My draft");
      expect(screen.queryByRole("dialog")).toBeNull();
    },
  );

  it("focuses the workspace when its question box is unavailable", () => {
    render(
      <>
        <section data-baam-workspace tabIndex={-1} aria-label="BAAM workspace">
          <textarea data-baam-input aria-label="Your BAAM question" disabled />
        </section>
        {launcher("ADMIN", "/baam")}
      </>,
    );
    const workspace = screen.getByRole("region", { name: "BAAM workspace" });
    workspace.scrollIntoView = vi.fn();
    fireEvent.click(screen.getByRole("button", { name: "Open BAAM assistant" }));
    expect(document.activeElement).toBe(workspace);
    expect(workspace.scrollIntoView).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on Escape and returns keyboard focus to the launcher", async () => {
    render(launcher());
    const trigger = screen.getByRole("button", { name: "Open BAAM assistant" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("closes an open assistant when the application route changes", async () => {
    const view = render(launcher());
    fireEvent.click(screen.getByRole("button", { name: "Open BAAM assistant" }));
    view.rerender(launcher("ADMIN", "/customers"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
