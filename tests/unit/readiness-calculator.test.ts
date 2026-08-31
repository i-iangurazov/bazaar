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

    expect(result.overallReadiness).toBe(49);
    expect(result.rawOverallReadiness).toBe(51.4);
    expect(result.applicationOwnedReadiness).toBe(52.2);
    expect(result.counts).toEqual({
      PASS: 58,
      PARTIAL: 114,
      FAIL: 16,
      BLOCKED: 42,
      N_A: 0,
    });
    expect(result.coverage).toMatchObject({
      applicable: 230,
      executed: 188,
      passed: 58,
      executionPercent: 81.7,
      verifiedPassPercent: 25.2,
    });
    expect(result.criticalWorkflowCoverage).toEqual({
      total: 67,
      executed: 51,
      passed: 23,
      executionPercent: 76.1,
      verifiedPassPercent: 34.3,
    });
    expect(result.defectCounts).toEqual({
      BLOCKER: 0,
      CRITICAL: 1,
      HIGH: 2,
      MEDIUM: 18,
      LOW: 3,
      total: 24,
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
