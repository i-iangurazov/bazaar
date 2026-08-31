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
  it("reproduces the frozen 230-requirement audit baseline exactly", () => {
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

    expect(result.overallReadiness).toBe(47.8);
    expect(result.rawOverallReadiness).toBe(47.8);
    expect(result.applicationOwnedReadiness).toBe(48.5);
    expect(result.counts).toEqual({
      PASS: 54,
      PARTIAL: 107,
      FAIL: 25,
      BLOCKED: 44,
      N_A: 0,
    });
    expect(result.coverage).toMatchObject({
      applicable: 230,
      executed: 186,
      passed: 54,
      executionPercent: 80.9,
      verifiedPassPercent: 23.5,
    });
    expect(result.criticalWorkflowCoverage).toEqual({
      total: 67,
      executed: 49,
      passed: 21,
      executionPercent: 73.1,
      verifiedPassPercent: 31.3,
    });
    expect(result.defectCounts).toEqual({
      BLOCKER: 0,
      CRITICAL: 1,
      HIGH: 2,
      MEDIUM: 18,
      LOW: 5,
      total: 26,
    });
    expect(result.appliedCap).toEqual({
      value: 49,
      reason: "Unresolved BLOCKER or CRITICAL defect",
    });
  });

  it("is byte-for-byte deterministic for an unchanged tracker", () => {
    expect(runCalculator()).toBe(runCalculator());
  });
});
