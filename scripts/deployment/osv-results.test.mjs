import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const workflow = fs.readFileSync(
  new URL("../../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);
const gate = workflow.match(
  /name: Require a real lockfile scan result[\s\S]*?node --input-type=module <<'NODE'\n([\s\S]*?)\n +NODE/,
)?.[1];
assert(gate, "The actual CI workflow must contain a fail-closed OSV result gate");

function runGate(report) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bazaar-osv-gate-"));
  try {
    if (report !== undefined) {
      fs.writeFileSync(path.join(dir, "osv-results.json"), report);
    }
    return spawnSync(process.execPath, ["--input-type=module"], {
      cwd: dir,
      input: gate,
      encoding: "utf8",
      timeout: 5_000,
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const scanned = (packages) => ({
  results: [{ source: { type: "lockfile", path: "/checkout/pnpm-lock.yaml" }, packages }],
});
const cleanPackage = { package: { name: "is-number", version: "7.0.0", ecosystem: "npm" } };

test("accepts the official all-packages clean result without requiring vulnerabilities", () => {
  assert.equal(runGate(JSON.stringify(scanned([cleanPackage]))).status, 0);
});

test("passes genuine findings to the mandatory fail-on-vulnerability reporter", () => {
  const report = scanned([{ ...cleanPackage, vulnerabilities: [{ id: "SYNTHETIC-TEST-ONLY" }] }]);
  assert.equal(runGate(JSON.stringify(report)).status, 0);
  assert.match(workflow, /--fail-on-vuln=true/);
});

for (const [name, input] of [
  ["missing output after scanner failure", undefined],
  ["empty output after invalid configuration", ""],
  ["truncated output", '{"results":'],
  ["empty wrapper report without evidence of scanning", '{"results":[]}'],
  ["an error object", '{"error":"scanner failed"}'],
  [
    "a different lockfile",
    JSON.stringify({
      results: [
        {
          source: { type: "lockfile", path: "/other/package-lock.json" },
          packages: [cleanPackage],
        },
      ],
    }),
  ],
  ["an empty package inventory", JSON.stringify(scanned([]))],
  ["a malformed package inventory", JSON.stringify(scanned([{}]))],
]) {
  test(`rejects ${name}`, () => {
    assert.notEqual(runGate(input).status, 0);
  });
}
