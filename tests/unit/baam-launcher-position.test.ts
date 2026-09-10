import { describe, expect, it } from "vitest";
import { launcherBottom, type LauncherObstacle } from "@/lib/baam/launcher-position";
import { baamLauncherLift } from "@/lib/baamLauncherPosition";

describe("BAAM launcher control avoidance", () => {
  const base = { left: 318, right: 374, top: 698, bottom: 754 };
  it("retains the bottom-right anchor when nearby controls do not overlap", () => {
    expect(baamLauncherLift(base, [{ left: 16, right: 300, top: 700, bottom: 740 }])).toBe(0);
  });
  it("lifts above full-width buttons, fields and stacked links with an eight-pixel gap", () => {
    expect(
      baamLauncherLift(base, [
        { left: 16, right: 374, top: 672.5, bottom: 740 },
        { left: 16, right: 374, top: 748, bottom: 815.5 },
      ]),
    ).toBe(89.5);
    expect(
      baamLauncherLift(base, [
        { left: 33, right: 357, top: 714.5, bottom: 754.5 },
        { left: 33, right: 357, top: 640, bottom: 680 },
      ]),
    ).toBe(122);
  });
  it("does not move into the app header or outside the viewport when no gap exists", () => {
    expect(baamLauncherLift(base, [{ left: 0, right: 390, top: 0, bottom: 850 }])).toBe(0);
  });
});

const action: LauncherObstacle = {
  top: 950,
  bottom: 990,
  left: 1150,
  right: 1400,
  action: true,
  fixed: false,
};
describe("BAAM action clearance", () => {
  it("clears a desktop checkout button and a second action immediately above it", () => {
    expect(launcherBottom(1440, 1000, [action])).toBe(62);
    expect(launcherBottom(1440, 1000, [action, { ...action, top: 900, bottom: 940 }])).toBe(112);
  });
  it("ignores ordinary table content, left-side actions and actions outside the viewport", () => {
    expect(launcherBottom(1440, 1000, [{ ...action, action: false }])).toBe(24);
    expect(launcherBottom(1440, 1000, [{ ...action, right: 600, left: 300 }])).toBe(24);
    expect(launcherBottom(1440, 1000, [{ ...action, top: 1100, bottom: 1140 }])).toBe(24);
  });
  it("keeps the existing mobile navigation and fixed save-bar clearance", () => {
    expect(launcherBottom(390, 844, [])).toBe(96);
    expect(
      launcherBottom(390, 844, [
        { ...action, fixed: true, top: 700, bottom: 755, left: 12, right: 378 },
      ]),
    ).toBe(156);
  });
});
