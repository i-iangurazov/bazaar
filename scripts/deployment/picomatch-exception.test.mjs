import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import {
  assertPicomatchException,
  chainsDigest,
  collectPicomatchChains,
  parseLockfileGraph,
  PICOMATCH_ADVISORY_ID,
  PICOMATCH_EXCEPTION_EXPIRES_AT,
} from "./picomatch-exception.mjs";

const validNow = new Date("2026-11-25T17:58:59.999Z");
const expiredNow = new Date("2026-11-25T17:59:00.000Z");
const validJustification = "Synthetic reviewed exception for tests; no untrusted glob patterns are passed.";

function lockfile(extra = false) {
  return `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      app:
        specifier: 1.0.0
        version: 1.0.0
    devDependencies:
      tool:
        specifier: 1.0.0
        version: 1.0.0
${extra ? "      extra:\n        specifier: 1.0.0\n        version: 1.0.0\n" : ""}
packages:

  app@1.0.0:
    resolution: {integrity: sha512-x}
  tool@1.0.0:
    resolution: {integrity: sha512-x}
  extra@1.0.0:
    resolution: {integrity: sha512-x}
  picomatch@2.3.2:
    resolution: {integrity: sha512-x}
  picomatch@4.0.7:
    resolution: {integrity: sha512-x}

snapshots:

  app@1.0.0:
    dependencies:
      picomatch: 4.0.7
  tool@1.0.0:
    dependencies:
      picomatch: 2.3.2
${extra ? "  extra@1.0.0:\n    dependencies:\n      picomatch: 4.0.7\n" : ""}
  picomatch@2.3.2: {}
  picomatch@4.0.7: {}
`;
}

function report({ omit = false, wrongVersion = false, wrongPackage = false, otherVuln = false } = {}) {
  const picomatch = [
    { package: { name: "picomatch", version: "2.3.2", ecosystem: "npm" }, vulnerabilities: [{ id: PICOMATCH_ADVISORY_ID }] },
    {
      package: {
        name: wrongPackage ? "micromatch" : "picomatch",
        version: wrongVersion ? "4.0.8" : "4.0.7",
        ecosystem: "npm",
      },
      vulnerabilities: [{ id: PICOMATCH_ADVISORY_ID }],
    },
  ];
  return {
    results: [{
      source: { path: "/github/workspace/pnpm-lock.yaml", type: "lockfile" },
      packages: [
        { package: { name: "app", version: "1.0.0", ecosystem: "npm" } },
        ...(omit ? [] : picomatch),
        ...(otherVuln ? [{
          package: { name: "other", version: "1.0.0", ecosystem: "npm" },
          vulnerabilities: [{ id: "GHSA-other" }],
        }] : []),
      ],
    }],
    experimental_config: {},
  };
}

function configFor(chains) {
  return {
    advisoryId: PICOMATCH_ADVISORY_ID,
    versions: ["2.3.2", "4.0.7"],
    expiresAt: PICOMATCH_EXCEPTION_EXPIRES_AT,
    expiresAtBishkek: "2026-11-25T23:59:00+06:00",
    justification: validJustification,
    chains: [...chains].sort(),
    chainsDigest: chainsDigest(chains),
  };
}

const baseChains = collectPicomatchChains(parseLockfileGraph(lockfile()));

const throwsCode = (fn, code) => assert.throws(fn, (error) => error?.code === code);

test("filters exactly the two reviewed findings and preserves the raw report", () => {
  const raw = report({ otherVuln: true });
  const result = assertPicomatchException({
    lockfile: lockfile(),
    report: raw,
    config: configFor(baseChains),
    now: validNow,
  });

  assert.equal(result.filteredFindings, 2);
  assert.equal(result.rawFindings, 3);
  assert.equal(result.remainingFindings, 1);
  assert.equal(result.chains, baseChains.length);
  assert.match(JSON.stringify(raw), new RegExp(PICOMATCH_ADVISORY_ID));
  assert.doesNotMatch(JSON.stringify(result.gatedReport), new RegExp(PICOMATCH_ADVISORY_ID));
  assert.match(JSON.stringify(result.gatedReport), /GHSA-other/);
  for (const entry of result.gatedReport.results[0].packages) {
    if (entry.package.name === "picomatch") {
      assert.equal(entry.vulnerabilities, undefined);
    }
  }
});

test("stops exactly at 2026-11-25 23:59 Bishkek", () => {
  throwsCode(() => assertPicomatchException({
    lockfile: lockfile(),
    report: report(),
    config: configFor(baseChains),
    now: expiredNow,
  }), "PICOMATCH_EXCEPTION_EXPIRED");
});

test("rejects an unlisted picomatch version", () => {
  throwsCode(() => assertPicomatchException({
    lockfile: lockfile(),
    report: report({ wrongVersion: true }),
    config: configFor(baseChains),
    now: validNow,
  }), "PICOMATCH_EXCEPTION_SCOPE_CHANGED");
});

test("rejects the advisory on a different package", () => {
  throwsCode(() => assertPicomatchException({
    lockfile: lockfile(),
    report: report({ wrongPackage: true }),
    config: configFor(baseChains),
    now: validNow,
  }), "PICOMATCH_EXCEPTION_SCOPE_CHANGED");
});

test("rejects a new dependency chain", () => {
  const changedLockfile = lockfile(true);
  throwsCode(() => assertPicomatchException({
    lockfile: changedLockfile,
    report: report(),
    config: configFor(baseChains),
    now: validNow,
  }), "PICOMATCH_EXCEPTION_SCOPE_CHANGED");
});

test("rejects a stale exception when the advisory disappears", () => {
  throwsCode(() => assertPicomatchException({
    lockfile: lockfile(),
    report: report({ omit: true }),
    config: configFor(baseChains),
    now: validNow,
  }), "PICOMATCH_EXCEPTION_STALE");
});

test("rejects malformed reports", () => {
  throwsCode(() => assertPicomatchException({
    lockfile: lockfile(),
    report: { results: [] },
    config: configFor(baseChains),
    now: validNow,
  }), "PICOMATCH_EXCEPTION_REPORT_INVALID");
});

test("rejects changed versions, expiry or digest in the reviewed config", () => {
  for (const change of [
    (config) => { config.versions = ["2.3.2"]; },
    (config) => { config.expiresAt = "2026-11-26T17:59:00.000Z"; },
    (config) => { config.expiresAtBishkek = "2026-11-26T23:59:00+06:00"; },
    (config) => { config.chainsDigest = "0".repeat(64); },
  ]) {
    const config = configFor(baseChains);
    change(config);
    throwsCode(() => assertPicomatchException({
      lockfile: lockfile(),
      report: report(),
      config,
      now: validNow,
    }), "PICOMATCH_EXCEPTION_CONFIG_INVALID");
  }
});

test("the committed lockfile and reviewed config still match", () => {
  const root = process.cwd();
  const currentLockfile = readFileSync(resolve(root, "pnpm-lock.yaml"), "utf8");
  const config = JSON.parse(readFileSync(resolve(root, "scripts/deployment/picomatch-exception.json"), "utf8"));
  const chains = collectPicomatchChains(parseLockfileGraph(currentLockfile));
  assert.equal(chains.length, 52);
  assert.deepEqual(chains, [...config.chains].sort());
  assert.equal(chainsDigest(chains), config.chainsDigest);
  assert.equal(config.advisoryId, PICOMATCH_ADVISORY_ID);
  assert.equal(config.expiresAt, PICOMATCH_EXCEPTION_EXPIRES_AT);
});
