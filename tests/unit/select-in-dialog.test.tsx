// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
afterEach(cleanup);
it("Escape closes the nested select first and returns focus through the dialog to its launcher", async () => {
  Element.prototype.scrollIntoView = vi.fn();
  render(
    <Dialog>
      <DialogTrigger>Open assistant</DialogTrigger>
      <DialogContent>
        <DialogTitle>Assistant</DialogTitle>
        <DialogDescription>Choose a store</DialogDescription>
        <Select defaultValue="one">
          <SelectTrigger aria-label="Store">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="one">Store one</SelectItem>
            <SelectItem value="two">Store two</SelectItem>
          </SelectContent>
        </Select>
      </DialogContent>
    </Dialog>,
  );
  const launcher = screen.getByRole("button", { name: "Open assistant" });
  fireEvent.click(launcher);
  const trigger = screen.getByRole("combobox", { name: "Store" });
  fireEvent.keyDown(trigger, { key: "Enter" });
  await screen.findByRole("listbox");
  await waitFor(() => expect(document.activeElement?.getAttribute("role")).toBe("option"));
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  expect(screen.getByRole("dialog", { name: "Assistant" })).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  fireEvent.keyDown(trigger, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(launcher));
});
