// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import messages from "../../messages/en.json";
import { BaamLauncher } from "@/components/baam-launcher";

const launcher = (role = "ADMIN", pathname = "/dashboard") => <NextIntlClientProvider
  locale="en" messages={{ baam: { title: messages.baam.title, assistant: messages.baam.assistant }, common: { close: messages.common.close } }}
><BaamLauncher access={{ role, isOrgOwner: true, isPlatformOwner: true }} pathname={pathname}>
  <button type="button">Ask a supported question</button>
</BaamLauncher></NextIntlClientProvider>;

afterEach(cleanup);

describe("BAAM assistant launcher", () => {
  it.each(["ADMIN", "MANAGER"])("lets %s open an accessible assistant dialog and full workspace link", role => {
    render(launcher(role));
    fireEvent.click(screen.getByRole("button", { name: "Open BAAM assistant" }));
    expect(screen.getByRole("dialog", { name: "BAAM" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open full workspace" }).getAttribute("href")).toBe("/baam");
    expect(screen.getByRole("button", { name: "Ask a supported question" })).toBeTruthy();
  });

  it.each(["STAFF", "CASHIER", "UNKNOWN"])("does not elevate %s through ownership flags", role => {
    render(launcher(role));
    expect(screen.queryByRole("button", { name: "Open BAAM assistant" })).toBeNull();
  });

  it.each([
    "/pos", "/pos/sell", "/inventory", "/inventory/overview",
    "/reports/receipts", "/printing/receipt", "/cash", "/finance/income", "/finance/expense", "/help/pos",
  ])("hides the launcher at %s", pathname => {
    render(launcher("ADMIN", pathname));
    expect(screen.queryByRole("button", { name: "Open BAAM assistant" })).toBeNull();
  });

  it.each(["ADMIN", "MANAGER"])("keeps the workspace circle visible for %s and focuses the existing question", role => {
    render(<>
      <section data-baam-workspace tabIndex={-1}>
        <textarea aria-label="Your BAAM question" defaultValue="My draft" />
      </section>
      {launcher(role, "/baam")}
    </>);
    const question = screen.getByRole("textbox", { name: "Your BAAM question" });
    question.scrollIntoView = vi.fn();
    fireEvent.click(screen.getByRole("button", { name: "Open BAAM assistant" }));
    expect(document.activeElement).toBe(question);
    expect(question.scrollIntoView).toHaveBeenCalled();
    expect((question as HTMLTextAreaElement).value).toBe("My draft");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("focuses the workspace when its question box is unavailable", () => {
    render(<>
      <section data-baam-workspace tabIndex={-1} aria-label="BAAM workspace">
        <textarea aria-label="Your BAAM question" disabled />
      </section>
      {launcher("ADMIN", "/baam")}
    </>);
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
