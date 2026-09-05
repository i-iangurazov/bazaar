import { describe, expect, it } from "vitest";
import { baamLauncherLift } from "@/lib/baamLauncherPosition";

describe("BAAM launcher control avoidance", () => {
  const base = { left: 318, right: 374, top: 698, bottom: 754 };
  it("retains the bottom-right anchor when nearby controls do not overlap", () => {
    expect(baamLauncherLift(base, [{ left: 16, right: 300, top: 700, bottom: 740 }])).toBe(0);
  });
  it("lifts above full-width buttons, fields and stacked links with an eight-pixel gap", () => {
    expect(baamLauncherLift(base, [
      { left: 16, right: 374, top: 672.5, bottom: 740 },
      { left: 16, right: 374, top: 748, bottom: 815.5 },
    ])).toBe(89.5);
    expect(baamLauncherLift(base, [
      { left: 33, right: 357, top: 714.5, bottom: 754.5 },
      { left: 33, right: 357, top: 640, bottom: 680 },
    ])).toBe(122);
  });
  it("does not move into the app header or outside the viewport when no gap exists", () => {
    expect(baamLauncherLift(base, [{ left: 0, right: 390, top: 0, bottom: 850 }])).toBe(0);
  });
});
