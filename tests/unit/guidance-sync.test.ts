import { describe, expect, it, vi } from "vitest";

import {
  completeTourOptimistic,
  createGuidanceSyncScheduler,
  dismissAutoTourOptimistic,
} from "@/lib/guidance-sync";

describe("guidance optimistic helpers", () => {
  it("dismisses auto tour instantly in local state", () => {
    const current = new Set<string>(["dashboard-tour"]);
    const next = dismissAutoTourOptimistic(current, "products-tour");

    expect(next.has("dashboard-tour")).toBe(true);
    expect(next.has("products-tour")).toBe(true);
    expect(next).not.toBe(current);
  });

  it("completes tour instantly in local state", () => {
    const current = new Set<string>(["dashboard-tour"]);
    const next = completeTourOptimistic(current, "products-tour");

    expect(next.has("dashboard-tour")).toBe(true);
    expect(next.has("products-tour")).toBe(true);
    expect(next).not.toBe(current);
  });
});

describe("guidance sync scheduler", () => {
  it("debounces persistence and sends latest payload", async () => {
    vi.useFakeTimers();
    const persist = vi.fn().mockResolvedValue(undefined);
    const scheduler = createGuidanceSyncScheduler({ delayMs: 200, persist });

    scheduler.enqueue({
      dismissedAutoTours: ["dashboard-tour"],
      completedTours: [],
      toursDisabled: false,
    });
    scheduler.enqueue({
      dismissedAutoTours: ["dashboard-tour", "products-tour"],
      completedTours: ["dashboard-tour"],
      toursDisabled: true,
    });

    await vi.advanceTimersByTimeAsync(201);

    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith({
      dismissedAutoTours: ["dashboard-tour", "products-tour"],
      completedTours: ["dashboard-tour"],
      toursDisabled: true,
    });

    scheduler.dispose();
    vi.useRealTimers();
  });
});
