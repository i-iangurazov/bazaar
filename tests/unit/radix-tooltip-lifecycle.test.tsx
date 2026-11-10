// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
afterEach(cleanup);

const HelpTooltip = () => (
  <Tooltip>
    <TooltipTrigger asChild><button>Explain price</button></TooltipTrigger>
    <TooltipContent>The price applies to the selected store.</TooltipContent>
  </Tooltip>
);

describe("Radix tooltip focus scope compatibility", () => {
  it("opens a real keyboard tooltip and closes it without losing the action focus", async () => {
    render(<TooltipProvider delayDuration={0}><HelpTooltip /></TooltipProvider>);
    const trigger = screen.getByRole("button", { name: "Explain price" });
    await act(async () => trigger.focus());
    expect(await screen.findByRole("tooltip")).toBeTruthy();
    fireEvent.keyDown(trigger, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
    expect(trigger.getAttribute("aria-describedby")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("releases tooltip, modal focus and body interaction when a real dialog closes", async () => {
    render(
      <TooltipProvider delayDuration={0}>
        <Dialog>
          <DialogTrigger>Open editor</DialogTrigger>
          <DialogContent>
            <DialogTitle>Price editor</DialogTitle>
            <DialogDescription>Change the selected store price.</DialogDescription>
            <HelpTooltip />
          </DialogContent>
        </Dialog>
      </TooltipProvider>,
    );
    const launcher = screen.getByRole("button", { name: "Open editor" });
    fireEvent.click(launcher);
    const trigger = screen.getByRole("button", { name: "Explain price" });
    await act(async () => trigger.focus());
    expect(await screen.findByRole("tooltip")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByRole("tooltip")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(launcher));
    expect(document.body.style.pointerEvents).not.toBe("none");
  });
});
