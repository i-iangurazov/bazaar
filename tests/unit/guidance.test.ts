import { describe, expect, it } from "vitest";

import {
  filterGuidanceTips,
  filterGuidanceTours,
  guidanceTips,
  guidanceTours,
  shouldAutoRunTour,
} from "@/lib/guidance";

describe("guidance access filtering", () => {
  it("filters admin-only guidance for staff", () => {
    const tips = filterGuidanceTips(guidanceTips, { role: "STAFF", features: [] });
    const tours = filterGuidanceTours(guidanceTours, { role: "STAFF", features: [] });

    expect(tips.some((tip) => tip.id === "users:invite")).toBe(false);
    expect(tips.some((tip) => tip.id === "exports:generate")).toBe(false);
    expect(tours.some((tour) => tour.id === "users-tour")).toBe(false);
    expect(tours.some((tour) => tour.id === "exports-tour")).toBe(false);
  });

  it("keeps feature-gated guidance when feature is enabled", () => {
    const tips = filterGuidanceTips(guidanceTips, {
      role: "MANAGER",
      features: ["exports", "analytics"],
    });
    const tours = filterGuidanceTours(guidanceTours, {
      role: "MANAGER",
      features: ["exports", "analytics"],
    });

    expect(tips.some((tip) => tip.id === "exports:generate")).toBe(true);
    expect(tours.some((tour) => tour.id === "exports-tour")).toBe(true);
    expect(tours.some((tour) => tour.id === "users-tour")).toBe(false);
  });

  it("auto-runs tours only when not completed, not dismissed, and not disabled", () => {
    expect(
      shouldAutoRunTour(
        {
          completedTours: new Set<string>(),
          dismissedAutoTours: new Set<string>(),
          toursDisabled: false,
        },
        "dashboard-tour",
      ),
    ).toBe(true);

    expect(
      shouldAutoRunTour(
        {
          completedTours: new Set<string>(["dashboard-tour"]),
          dismissedAutoTours: new Set<string>(),
          toursDisabled: false,
        },
        "dashboard-tour",
      ),
    ).toBe(false);

    expect(
      shouldAutoRunTour(
        {
          completedTours: new Set<string>(),
          dismissedAutoTours: new Set<string>(["dashboard-tour"]),
          toursDisabled: false,
        },
        "dashboard-tour",
      ),
    ).toBe(false);

    expect(
      shouldAutoRunTour(
        {
          completedTours: new Set<string>(),
          dismissedAutoTours: new Set<string>(),
          toursDisabled: true,
        },
        "dashboard-tour",
      ),
    ).toBe(false);
  });
});
