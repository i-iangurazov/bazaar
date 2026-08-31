// @vitest-environment jsdom

import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EmptyState } from "@/components/ui/empty-state";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";

const navigationState = vi.hoisted(() => ({ pathname: "/products" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => (key === "close" ? "Close" : key),
}));

const ToastHarness = () => {
  const { toast } = useToast();
  return (
    <div>
      <button
        type="button"
        onClick={() => toast({ variant: "success", description: "Saved once." })}
      >
        Success
      </button>
      <button type="button" onClick={() => toast({ variant: "error", description: "Saved once." })}>
        Error
      </button>
    </div>
  );
};

const toastTree = () => (
  <TooltipProvider>
    <ToastProvider>
      <ToastHarness />
    </ToastProvider>
  </TooltipProvider>
);

describe("readiness feedback primitives", () => {
  it("deduplicates repeated feedback, replaces conflicting variants, and clears stale route feedback", async () => {
    navigationState.pathname = "/products";
    const view = render(toastTree());

    fireEvent.click(screen.getByRole("button", { name: "Success" }));
    fireEvent.click(screen.getByRole("button", { name: "Success" }));
    await waitFor(() => expect(screen.getAllByRole("status")).toHaveLength(1));
    expect(screen.getByRole("status").getAttribute("aria-atomic")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Error" }));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert").getAttribute("aria-atomic")).toBe("true");

    await act(async () => {
      navigationState.pathname = "/customers";
      view.rerender(toastTree());
    });
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Success" }));
    navigationState.pathname = "/orders";
    view.rerender(toastTree());
    await waitFor(() => expect(screen.getAllByRole("status")).toHaveLength(1));
  });

  it("announces empty-state guidance and retains its recovery action", () => {
    render(
      <EmptyState
        title="No matching products"
        description="Clear the filters or add a product to continue."
        action={<button type="button">Clear filters</button>}
      />,
    );

    const state = screen.getByRole("status");
    expect(state.textContent).toContain("No matching products");
    expect(state.textContent).toContain("Clear the filters or add a product to continue.");
    expect(
      (screen.getByRole("button", { name: "Clear filters" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});
