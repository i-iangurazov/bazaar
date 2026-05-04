// @vitest-environment jsdom

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GuidanceCloseButton, GuidanceTipsTriggerButton } from "@/components/guidance/GuidanceButtons";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("guidance buttons", () => {
  it("renders the tips button as a fixed square icon button", () => {
    render(<GuidanceTipsTriggerButton pendingCount={2} onClick={() => undefined} />);

    const button = screen.getByRole("button", { name: "tipsButton" });
    expect(button.className).toContain("h-10");
    expect(button.className).toContain("w-10");
    expect(button.className).toContain("shrink-0");
  });

  it("renders the close button as a fixed square icon button with an accessible label", () => {
    render(<GuidanceCloseButton label="Close tips" onClick={() => undefined} />);

    const button = screen.getByRole("button", { name: "Close tips" });
    expect(button.className).toContain("h-10");
    expect(button.className).toContain("w-10");
    expect(button.className).toContain("shrink-0");
  });
});
