// @vitest-environment jsdom

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GuidanceOverlay } from "@/components/guidance/guidance-overlay";

const useGuidanceMock = vi.hoisted(() => vi.fn());

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string) => {
    if (namespace === "common" && key === "close") {
      return "Close";
    }
    if (key === "tourProgress") {
      return "Tour progress 1 1";
    }
    if (key === "test.title") {
      return "Create stock count";
    }
    if (key === "test.body") {
      return "Choose a store and count its stock.";
    }
    return key;
  },
}));

vi.mock("@/components/guidance/guidance-provider", () => ({
  useGuidance: useGuidanceMock,
}));

describe("GuidanceOverlay accessibility", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(0), 0),
    );
    vi.stubGlobal("cancelAnimationFrame", (handle: number) => window.clearTimeout(handle));

    useGuidanceMock.mockReturnValue({
      pageTips: [],
      pageTours: [
        {
          id: "stock-counts-tour",
          pageKey: "stockCounts",
          path: "/inventory/counts",
          labelKey: "test.label",
          steps: [
            {
              id: "stock-count-create",
              selector: '[data-tour="stock-count-create"]',
              titleKey: "test.title",
              bodyKey: "test.body",
            },
          ],
        },
      ],
      toursDisabled: false,
      activeTourId: "stock-counts-tour",
      focusedTipId: null,
      startTour: vi.fn(),
      stopTour: vi.fn(),
      completeTour: vi.fn().mockResolvedValue(undefined),
      skipTour: vi.fn().mockResolvedValue(undefined),
      focusTip: vi.fn(),
    });
  });

  it("uses the visible tour-step heading as the dialog's accessible name", async () => {
    render(
      <>
        <button type="button" data-tour="stock-count-create">
          Create
        </button>
        <GuidanceOverlay />
      </>,
    );

    const dialog = await screen.findByRole("dialog", { name: "Create stock count" });
    const heading = screen.getByRole("heading", { level: 3, name: "Create stock count" });

    await waitFor(() => expect(dialog.getAttribute("aria-labelledby")).toBe(heading.id));
  });
});
