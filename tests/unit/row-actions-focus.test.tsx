// @vitest-environment jsdom

import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RowActions } from "@/components/row-actions";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);
const ActionIcon = () => <span aria-hidden />;

describe("row action menu keyboard focus", () => {
  it("returns Escape focus to the actual More button so the row remains keyboard accessible", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <TooltipProvider>
        <RowActions
          actions={[{ key: "edit", label: "Edit", icon: ActionIcon, onSelect }]}
          maxInline={0}
          moreLabel="More actions"
        />
      </TooltipProvider>,
    );
    const trigger = screen.getByRole("button", { name: "More actions" });
    act(() => trigger.focus());
    await user.keyboard("{Enter}");
    await screen.findByRole("menuitem", { name: "Edit" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(onSelect).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("menuitem", { name: "Edit" })).toBeTruthy();
  });

  it("opens a confirmation with focus inside it and returns to More after cancellation", async () => {
    const user = userEvent.setup();
    const remove = vi.fn();
    const Harness = () => {
      const { confirm, confirmDialog } = useConfirmDialog();
      return (
        <TooltipProvider>
          <RowActions
            moreLabel="More actions"
            maxInline={0}
            actions={[{
              key: "delete",
              label: "Delete",
              icon: ActionIcon,
              onSelect: async () => {
                if (await confirm({
                  title: "Confirm deletion",
                  description: "Remove the test row?",
                  cancelLabel: "Cancel",
                  confirmLabel: "Delete",
                  confirmVariant: "danger",
                })) remove();
              },
            }]}
          />
          {confirmDialog}
        </TooltipProvider>
      );
    };
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "More actions" });
    await user.click(trigger);
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Confirm deletion" });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(remove).not.toHaveBeenCalled();
  });
});
