import { afterEach, describe, expect, it, vi } from "vitest";

describe("runtime observability helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("enables hot-path timing logs only for observed production paths above threshold", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("HOT_PATH_LOG_THRESHOLD_MS", "200");

    vi.resetModules();
    const {
      getRuntimeHotPathThresholdMs,
      shouldElevateRuntimeSectionLog,
      shouldLogRuntimeHotPathTiming,
    } = await import("@/server/profiling/perf");

    expect(getRuntimeHotPathThresholdMs()).toBe(200);
    expect(
      shouldLogRuntimeHotPathTiming({
        path: "products.bootstrap",
        durationMs: 220,
      }),
    ).toBe(true);
    expect(
      shouldLogRuntimeHotPathTiming({
        path: "products.list",
        durationMs: 220,
      }),
    ).toBe(false);
    expect(
      shouldLogRuntimeHotPathTiming({
        path: "search.global",
        durationMs: 150,
      }),
    ).toBe(false);
    expect(shouldElevateRuntimeSectionLog("dashboard.summary")).toBe(true);
    expect(shouldElevateRuntimeSectionLog("inventory.list")).toBe(false);
  });
});
