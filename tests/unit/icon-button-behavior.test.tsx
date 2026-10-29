// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { IconButton } from "@/components/ui/icon-button";
import { EditIcon } from "@/components/icons";
import { TooltipProvider } from "@/components/ui/tooltip";
afterEach(cleanup);
it("keeps the accessible action and callback without visible button text", () => {
  const action = vi.fn();
  render(
    <TooltipProvider>
      <IconButton icon={EditIcon} label="Edit customer" onClick={action} />
    </TooltipProvider>,
  );
  const button = screen.getByRole("button", { name: "Edit customer" });
  expect(button.textContent).toBe("");
  fireEvent.click(button);
  expect(action).toHaveBeenCalledOnce();
});
it("keeps loading and disabled state and blocks activation", () => {
  const action = vi.fn();
  render(
    <TooltipProvider>
      <IconButton icon={EditIcon} label="Save" onClick={action} loading disabled />
    </TooltipProvider>,
  );
  const button = screen.getByRole("button", { name: "Save" });
  expect(button.getAttribute("aria-busy")).toBe("true");
  fireEvent.click(button);
  expect(action).not.toHaveBeenCalled();
});
it("does not turn a disabled action into an active link", () => {
  render(
    <TooltipProvider>
      <IconButton icon={EditIcon} label="Edit" href="/products/p" disabled />
    </TooltipProvider>,
  );
  expect(screen.queryByRole("link")).toBeNull();
  expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
});
it("preserves new-tab entity links and protects their opener", () => {
  render(
    <TooltipProvider>
      <IconButton icon={EditIcon} label="Edit" href="/products/p?storeId=s" openInNewTab />
    </TooltipProvider>,
  );
  const link = screen.getByRole("link", { name: "Edit" });
  expect(link.getAttribute("href")).toBe("/products/p?storeId=s");
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toContain("noopener");
});
