import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();
const updater = path.resolve("scripts/production-readiness/update-readiness.mjs");
const calculator = path.resolve("scripts/production-readiness/calculate-readiness.mjs");
const baseline = path.resolve("docs/production-readiness/readiness-baseline.json");
const current = path.resolve("docs/production-readiness/readiness-current.json");
const timestamp = "2099-01-01T00:00:00.000Z";
const testFile = "tests/unit/readiness-updater.test.ts";

type FileEvidence = {
  type: "file";
  path: string;
  description: string;
};

type CommandEvidence = {
  type: "command";
  command: string;
  exitCode: number;
  summary: string;
};

type Evidence = FileEvidence | CommandEvidence;

type RequirementPatch = {
  id: string;
  currentStatus: string;
  currentExecuted: boolean;
  currentNotes: string;
  statusJustification: string;
  verificationTimestampSource: string;
  evidence: Evidence[];
  validation?: {
    commands: string[];
    tests: string[];
    manualProcedure: string | null;
  };
};

type DefectPatch = {
  id: string;
  currentStatus: string;
  resolutionEvidence: Evidence[];
};

type SupportingMetrics = {
  routes: {
    exact: Record<"PASS" | "PARTIAL" | "FAIL" | "BLOCKED" | "total", number>;
    canonical: Record<"PASS" | "PARTIAL" | "FAIL" | "BLOCKED" | "total", number>;
  };
  roles: {
    credentialed: number;
    expected: number;
    credentialedRoleNames: string[];
    blockedRoleNames: string[];
    lowerRoleBoundaryAssertions: { passed: number; total: number };
    crossTenantIsolationVerified: boolean;
  };
  [key: string]: unknown;
};

type Manifest = {
  schemaVersion: number;
  timestamp: string;
  requirements: RequirementPatch[];
  defects: DefectPatch[];
  supportingMetrics?: {
    value: Record<string, unknown>;
    evidence: Evidence[];
  };
};

const fileEvidence = (): FileEvidence => ({
  type: "file",
  path: testFile,
  description: "Synthetic updater regression fixture; never applied to the readiness tracker",
});

const commandEvidence = (): CommandEvidence => ({
  type: "command",
  command: "pnpm exec vitest run tests/unit/readiness-updater.test.ts",
  exitCode: 0,
  summary: "Synthetic updater contract verification completed successfully",
});

const validManifest = (): Manifest => ({
  schemaVersion: 1,
  timestamp,
  requirements: [
    {
      id: "BZR-REQ-0001",
      currentStatus: "PARTIAL",
      currentExecuted: true,
      currentNotes: "Synthetic updater regression downgrade; not a production-readiness finding.",
      statusJustification:
        "Exercises deterministic status history without asserting a new production PASS mapping.",
      verificationTimestampSource: "Synthetic readiness updater unit-test manifest",
      evidence: [fileEvidence(), commandEvidence()],
      validation: {
        commands: ["pnpm exec vitest run tests/unit/readiness-updater.test.ts"],
        tests: [testFile],
        manualProcedure: null,
      },
    },
  ],
  defects: [
    {
      id: "PUBLIC-002",
      currentStatus: "RESOLVED",
      resolutionEvidence: [fileEvidence(), commandEvidence()],
    },
  ],
});

const runUpdater = ({
  manifest,
  output,
  sourceCurrent = current,
}: {
  manifest: string;
  output: string;
  sourceCurrent?: string;
}) =>
  spawnSync(
    process.execPath,
    [
      updater,
      "--baseline",
      baseline,
      "--current",
      sourceCurrent,
      "--manifest",
      manifest,
      "--output",
      output,
    ],
    { cwd: repositoryRoot, encoding: "utf8" },
  );

describe("production readiness updater", () => {
  let directory: string;

  beforeEach(async () => {
    const temporaryRoot = path.join(repositoryRoot, "tmp");
    await mkdir(temporaryRoot, { recursive: true });
    directory = await mkdtemp(path.join(temporaryRoot, "readiness-updater-test-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const writeManifest = async (manifest: unknown, filename = "manifest.json") => {
    const manifestPath = path.join(directory, filename);
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return manifestPath;
  };

  it("documents the manifest contract through the package-manager argument separator", () => {
    const result = spawnSync(process.execPath, [updater, "--", "--help"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Manifest contract:");
    expect(result.stdout).toContain("The source tracker is never overwritten.");
  });

  it("writes deterministic calculator-valid output without mutating its inputs", async () => {
    const manifestPath = await writeManifest(validManifest());
    const firstOutput = path.join(directory, "first-output.json");
    const secondOutput = path.join(directory, "second-output.json");
    const currentBefore = await readFile(current, "utf8");

    const firstRun = runUpdater({ manifest: manifestPath, output: firstOutput });
    const secondRun = runUpdater({ manifest: manifestPath, output: secondOutput });

    expect(firstRun.status, firstRun.stderr).toBe(0);
    expect(secondRun.status, secondRun.stderr).toBe(0);
    const firstContents = await readFile(firstOutput, "utf8");
    expect(await readFile(secondOutput, "utf8")).toBe(firstContents);
    expect(await readFile(current, "utf8")).toBe(currentBefore);

    const updated = JSON.parse(firstContents) as {
      generatedAt: string;
      requirements: Array<{
        id: string;
        currentStatus: string;
        currentExecuted: boolean;
        lastVerificationTimestamp: string;
        history: Array<Record<string, unknown>>;
        evidence: { current: Evidence[] };
      }>;
      defects: Array<{
        id: string;
        currentStatus: string;
        resolvedAt: string | null;
        resolutionEvidence: Evidence[];
      }>;
    };
    const requirement = updated.requirements.find(({ id }) => id === "BZR-REQ-0001");
    const defect = updated.defects.find(({ id }) => id === "PUBLIC-002");
    expect(updated.generatedAt).toBe(timestamp);
    expect(requirement).toMatchObject({
      currentStatus: "PARTIAL",
      currentExecuted: true,
      lastVerificationTimestamp: timestamp,
    });
    expect(requirement?.evidence.current).toHaveLength(2);
    expect(requirement?.history).toEqual([
      {
        timestamp,
        fromStatus: "PASS",
        toStatus: "PARTIAL",
        fromExecuted: true,
        toExecuted: true,
        reason:
          "Exercises deterministic status history without asserting a new production PASS mapping.",
        evidence: [commandEvidence(), fileEvidence()],
      },
    ]);
    expect(defect).toMatchObject({
      currentStatus: "RESOLVED",
      resolvedAt: timestamp,
      resolutionEvidence: [commandEvidence(), fileEvidence()],
    });

    const calculation = spawnSync(
      process.execPath,
      [calculator, "--tracker", firstOutput, "--baseline", baseline, "--json"],
      { cwd: repositoryRoot, encoding: "utf8" },
    );
    expect(calculation.status, calculation.stderr).toBe(0);
  });

  it("updates supporting metrics only through a validated evidence-bearing patch", async () => {
    const currentTracker = JSON.parse(await readFile(current, "utf8")) as {
      supportingMetrics: SupportingMetrics;
    };
    const metrics = structuredClone(currentTracker.supportingMetrics);
    metrics.routes.exact = { PASS: 132, PARTIAL: 0, FAIL: 0, BLOCKED: 0, total: 132 };
    metrics.routes.canonical = { PASS: 116, PARTIAL: 0, FAIL: 0, BLOCKED: 0, total: 116 };
    metrics.roles = {
      credentialed: 6,
      expected: 6,
      credentialedRoleNames: [
        "ADMIN",
        "MANAGER",
        "STAFF",
        "CASHIER",
        "ORGANIZATION_OWNER",
        "PLATFORM_OWNER",
      ],
      blockedRoleNames: [],
      lowerRoleBoundaryAssertions: { passed: 300, total: 300 },
      crossTenantIsolationVerified: true,
    };
    const manifestPath = await writeManifest({
      schemaVersion: 1,
      timestamp,
      requirements: [],
      defects: [],
      supportingMetrics: { value: metrics, evidence: [fileEvidence(), commandEvidence()] },
    } satisfies Manifest);
    const output = path.join(directory, "supporting-metrics-output.json");

    const result = runUpdater({ manifest: manifestPath, output });

    expect(result.status, result.stderr).toBe(0);
    const updated = JSON.parse(await readFile(output, "utf8")) as {
      supportingMetrics: typeof metrics;
    };
    expect(updated.supportingMetrics).toEqual(metrics);
    expect(JSON.parse(result.stdout)).toMatchObject({ supportingMetricsPatched: true });
  });

  it("rejects supporting metrics whose outcome counts do not preserve audited totals", async () => {
    const currentTracker = JSON.parse(await readFile(current, "utf8")) as {
      supportingMetrics: SupportingMetrics;
    };
    const metrics = structuredClone(currentTracker.supportingMetrics);
    metrics.routes.canonical.PASS += 1;
    const manifestPath = await writeManifest({
      schemaVersion: 1,
      timestamp,
      requirements: [],
      defects: [],
      supportingMetrics: { value: metrics, evidence: [fileEvidence()] },
    } satisfies Manifest);

    const result = runUpdater({
      manifest: manifestPath,
      output: path.join(directory, "invalid-supporting-metrics-output.json"),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("outcomes must sum exactly to total");
  });

  it("refuses to overwrite an existing output file", async () => {
    const manifestPath = await writeManifest(validManifest());
    const output = path.join(directory, "existing.json");
    await writeFile(output, "sentinel\n");

    const result = runUpdater({ manifest: manifestPath, output });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Output already exists and will not be overwritten");
    expect(await readFile(output, "utf8")).toBe("sentinel\n");
  });

  it("rejects unknown mutable fields instead of drifting immutable requirement data", async () => {
    const manifest = validManifest();
    const requirementWithImmutableField = {
      ...manifest.requirements[0],
      riskWeight: 5,
    };
    const manifestPath = await writeManifest({
      ...manifest,
      requirements: [requirementWithImmutableField],
    });

    const result = runUpdater({
      manifest: manifestPath,
      output: path.join(directory, "unknown-field-output.json"),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("contains unsupported field(s): riskWeight");
  });

  it("rejects duplicate patch IDs", async () => {
    const manifest = validManifest();
    const manifestPath = await writeManifest({
      ...manifest,
      requirements: [manifest.requirements[0], structuredClone(manifest.requirements[0])],
    });

    const result = runUpdater({
      manifest: manifestPath,
      output: path.join(directory, "duplicate-output.json"),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Duplicate requirement patch ID: BZR-REQ-0001");
  });

  it.each([
    {
      name: "path traversal",
      evidence: {
        type: "file",
        path: "../outside.json",
        description: "Invalid traversal evidence",
      },
      expected: "must be a normalized repository-relative path",
    },
    {
      name: "multiline command",
      evidence: {
        type: "command",
        command: "pnpm test\nsecond command",
        exitCode: 0,
        summary: "Invalid multiline evidence",
      },
      expected: "contains unsupported control characters",
    },
    {
      name: "unsupported evidence type",
      evidence: {
        type: "url",
        path: "https://example.invalid/result",
        description: "Unverifiable remote evidence",
      },
      expected: 'type must be either "file" or "command"',
    },
  ])("rejects structurally invalid evidence: $name", async ({ evidence, expected }) => {
    const manifest = validManifest();
    const manifestPath = await writeManifest({
      ...manifest,
      requirements: [{ ...manifest.requirements[0], evidence: [evidence] }],
    });

    const result = runUpdater({
      manifest: manifestPath,
      output: path.join(directory, "invalid-evidence-output.json"),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(expected);
  });

  it("rejects status and execution combinations that violate calculator invariants", async () => {
    const manifest = validManifest();
    const manifestPath = await writeManifest({
      ...manifest,
      requirements: [
        {
          ...manifest.requirements[0],
          currentStatus: "BLOCKED",
          currentExecuted: true,
        },
      ],
    });

    const result = runUpdater({
      manifest: manifestPath,
      output: path.join(directory, "invalid-status-output.json"),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("cannot be BLOCKED and executed");
  });

  it("uses exactly one canonical, monotonic manifest timestamp", async () => {
    const manifestPath = await writeManifest({
      ...validManifest(),
      timestamp: "2026-08-30T19:22:30.825Z",
    });

    const result = runUpdater({
      manifest: manifestPath,
      output: path.join(directory, "stale-timestamp-output.json"),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Manifest timestamp must be later than the current tracker generatedAt timestamp",
    );
  });

  it("rejects immutable drift in the source tracker before applying a manifest", async () => {
    const driftedCurrent = JSON.parse(await readFile(current, "utf8")) as {
      requirements: Array<{ category: string }>;
    };
    driftedCurrent.requirements[0].category = "Drifted immutable category";
    const driftedCurrentPath = path.join(directory, "drifted-current.json");
    await writeFile(driftedCurrentPath, `${JSON.stringify(driftedCurrent, null, 2)}\n`);
    const manifestPath = await writeManifest(validManifest());

    const result = runUpdater({
      manifest: manifestPath,
      output: path.join(directory, "drift-output.json"),
      sourceCurrent: driftedCurrentPath,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Immutable requirement field drift for BZR-REQ-0001: category");
  });
});
