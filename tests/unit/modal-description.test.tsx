// @vitest-environment jsdom

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Modal } from "@/components/ui/modal";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Modal accessible description", () => {
  it("links the Radix dialog to its rendered subtitle without warnings", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    render(
      <Modal open onOpenChange={() => undefined} title="Create customer" subtitle="Contact data">
        <button type="button">Save</button>
      </Modal>,
    );

    const dialog = screen.getByRole("dialog", { name: "Create customer" });
    const descriptionId = dialog.getAttribute("aria-describedby");
    expect(descriptionId).toBeTruthy();
    expect(document.getElementById(descriptionId!)?.textContent).toBe("Contact data");
    await waitFor(() => expect(warning).not.toHaveBeenCalled());
  });

  it("explicitly opts out when no meaningful subtitle exists", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    render(
      <Modal open onOpenChange={() => undefined} title="Confirmation">
        <button type="button">Continue</button>
      </Modal>,
    );

    expect(
      screen.getByRole("dialog", { name: "Confirmation" }).getAttribute("aria-describedby"),
    ).toBeNull();
    await waitFor(() => expect(warning).not.toHaveBeenCalled());
  });
});
