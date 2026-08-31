import { execFileSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

const runCalculator = () =>
  execFileSync(
    process.execPath,
    [path.resolve("scripts/production-readiness/calculate-readiness.mjs"), "--json"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  );

describe("production readiness calculator", () => {
  it("reproduces the current immutable 230-requirement audit snapshot exactly", () => {
    const output = runCalculator();
    const result = JSON.parse(output) as {
      overallReadiness: number;
      rawOverallReadiness: number;
      applicationOwnedReadiness: number;
      counts: Record<string, number>;
      coverage: Record<string, number>;
      criticalWorkflowCoverage: Record<string, number>;
      defectCounts: Record<string, number>;
      appliedCap: { value: number; reason: string } | null;
    };

    expect(result.overallReadiness).toBe(95.6);
    expect(result.rawOverallReadiness).toBe(95.6);
    expect(result.applicationOwnedReadiness).toBe(97.2);
    expect(result.counts).toEqual({
      PASS: 209,
      PARTIAL: 16,
      FAIL: 0,
      BLOCKED: 5,
      N_A: 0,
    });
    expect(result.coverage).toMatchObject({
      applicable: 230,
      executed: 225,
      passed: 209,
      executionPercent: 97.8,
      verifiedPassPercent: 90.9,
    });
    expect(result.criticalWorkflowCoverage).toEqual({
      total: 67,
      executed: 64,
      passed: 64,
      executionPercent: 95.5,
      verifiedPassPercent: 95.5,
    });
    expect(result.defectCounts).toEqual({
      BLOCKER: 0,
      CRITICAL: 0,
      HIGH: 0,
      MEDIUM: 6,
      LOW: 2,
      total: 8,
    });
    expect(result.appliedCap).toBeNull();
  });

  it("is byte-for-byte deterministic for an unchanged tracker", () => {
    expect(runCalculator()).toBe(runCalculator());
  });
});
