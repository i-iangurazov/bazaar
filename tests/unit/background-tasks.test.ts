import { afterEach, describe, expect, it, vi } from "vitest";
const { waitUntil } = vi.hoisted(() => ({ waitUntil: vi.fn() }));
vi.mock("@vercel/functions", () => ({ waitUntil }));
import { keepBackgroundTaskAlive } from "@/server/jobs/background";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
describe("AI task lifetime", () => {
  it("retains the task after a Vercel response without awaiting it", () => {
    vi.stubEnv("VERCEL", "1");
    const task = Promise.resolve();
    expect(keepBackgroundTaskAlive(task)).toBeUndefined();
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(waitUntil).toHaveBeenCalledWith(task);
  });
  it("does not require a hosting request context for local jobs", () => {
    vi.stubEnv("VERCEL", "0");
    keepBackgroundTaskAlive(Promise.resolve());
    expect(waitUntil).not.toHaveBeenCalled();
  });
});
