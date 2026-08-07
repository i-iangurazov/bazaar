// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ContextualHelpButton } from "@/components/help/ContextualHelpButton";

vi.mock("next/navigation", () => ({ usePathname: () => "/pos/sell" }));
vi.mock("next-intl", () => ({
  useLocale: () => "ru",
  useTranslations: () => (key: string) =>
    key === "tipsButton" ? "Подсказки" : key === "close" ? "Закрыть" : key,
}));

describe("fullscreen contextual help", () => {
  it("opens the POS quick guide without requiring GuidanceProvider", () => {
    render(<ContextualHelpButton />);

    fireEvent.click(screen.getByRole("button", { name: "Подсказки" }));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Продажа на кассе" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Открыть инструкцию/ }).getAttribute("href")).toBe(
      "/help/pos/make-sale?from=%2Fpos%2Fsell",
    );
  });
});
