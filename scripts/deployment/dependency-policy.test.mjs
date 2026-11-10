import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { assertDependencyPolicy, sheetjsPolicy } from "./dependency-policy.mjs";

const archive = fs.readFileSync(new URL(`../../${sheetjsPolicy.archivePath}`, import.meta.url));
const source = JSON.parse(fs.readFileSync(new URL(`../../${sheetjsPolicy.sourcePath}`, import.meta.url), "utf8"));
const fileSpecifier = `file:${sheetjsPolicy.archivePath}`;

function fixture() {
  return {
    manifest: { dependencies: { xlsx: fileSpecifier } },
    source: { ...source },
    archive,
    lockfile: `lockfileVersion: '9.0'

packages:

  xlsx@${fileSpecifier}:
    resolution: {integrity: ${sheetjsPolicy.integrity}, tarball: ${fileSpecifier}}
    version: 0.20.3

snapshots:

  xlsx@${fileSpecifier}: {}
`,
    report: {
      results: [{ source: { type: "lockfile", path: "/checkout/pnpm-lock.yaml" }, packages: [
        { package: { name: "xlsx", version: "0.20.3", ecosystem: "npm" } },
        { package: { name: "other-package", version: "1.0.0", ecosystem: "npm" } },
      ] }],
    },
    configuration: sheetjsPolicy.advisoryIds.map(id =>
      `[[IgnoredVulns]]\nid = "${id}"\nreason = "Reviewed exact publisher release; guarded bytes and inventory."`,
    ).join("\n\n"),
  };
}

test("accepts the reviewed publisher bytes, pinned lock integrity and complete scanned inventory", () => {
  const input = fixture();
  assert.deepEqual(assertDependencyPolicy(input), {
    scannedPackages: 2, sheetjsVersion: "0.20.3", integrity: sheetjsPolicy.integrity,
  });
});

test("leaves every other advisory intact for the mandatory official vulnerability reporter", () => {
  const input = fixture();
  input.report.results[0].packages[1].vulnerabilities = [{ id: "TEST-UNRESOLVED-ADVISORY" }];
  const before = JSON.stringify(input.report);
  assertDependencyPolicy(input);
  assert.equal(JSON.stringify(input.report), before);
});

const negativeCases = [
  ["npm release instead of the reviewed archive", input => { input.manifest.dependencies.xlsx = "^0.18.5"; }],
  ["an unreviewed external tarball", input => { input.manifest.dependencies.xlsx = sheetjsPolicy.url; }],
  ["a second development dependency", input => { input.manifest.devDependencies = { xlsx: "0.18.5" }; }],
  ["a changed publisher URL", input => { input.source.url = "https://unreviewed.example/xlsx.tgz"; }],
  ["a changed source version", input => { input.source.version = "0.18.5"; }],
  ["a changed archive hash in metadata", input => { input.source.integrity = "sha512-unreviewed"; }],
  ["corrupted actual archive bytes", input => { input.archive = Buffer.from("changed archive"); }],
  ["missing archive bytes", input => { input.archive = undefined; }],
  ["a future unreviewed lockfile format", input => { input.lockfile = input.lockfile.replace("'9.0'", "'10.0'"); }],
  ["a missing lockfile integrity", input => { input.lockfile = input.lockfile.replace(`integrity: ${sheetjsPolicy.integrity}, `, ""); }],
  ["a different lockfile integrity", input => { input.lockfile = input.lockfile.replace(sheetjsPolicy.integrity, "sha512-unreviewed"); }],
  ["an unreviewed lockfile tarball source", input => { input.lockfile = input.lockfile.replace(`tarball: ${fileSpecifier}`, "tarball: https://unreviewed.example/xlsx.tgz"); }],
  ["a second old SheetJS package", input => { input.lockfile = input.lockfile.replace("snapshots:", "  xlsx@0.18.5:\n    resolution: {integrity: old}\n\nsnapshots:"); }],
  ["a second old dependency snapshot", input => { input.lockfile += "\n  xlsx@0.18.5: {}\n"; }],
  ["a missing OSV report", input => { input.report = undefined; }],
  ["an empty scan result", input => { input.report.results = []; }],
  ["an empty package inventory", input => { input.report.results[0].packages = []; }],
  ["a malformed package inventory", input => { input.report.results[0].packages = [{}]; }],
  ["a scan of a different lockfile", input => { input.report.results[0].source.path = "/checkout/package-lock.json"; }],
  ["missing SheetJS from the scanner inventory", input => { input.report.results[0].packages.shift(); }],
  ["an old scanned SheetJS release", input => { input.report.results[0].packages[0].package.version = "0.18.5"; }],
  ["a second old scanned SheetJS copy", input => { input.report.results[0].packages.push({ package: { name: "xlsx", version: "0.18.5", ecosystem: "npm" } }); }],
  ["an unexpected package ecosystem", input => { input.report.results[0].packages[0].package.ecosystem = "generic"; }],
  ["an additional unreviewed advisory exclusion", input => { input.configuration += '\n[[IgnoredVulns]]\nid = "GHSA-OTHER"\nreason = "not reviewed"\n'; }],
  ["a broad package exclusion", input => { input.configuration += '\n[[PackageOverrides]]\nname = "xlsx"\nignore = true\n'; }],
  ["an indented broad package exclusion", input => { input.configuration += '\n  [[PackageOverrides]]\n  name = "xlsx"\n  vulnerability.ignore = true\n'; }],
  ["a whitespace-obscured broad package exclusion", input => { input.configuration += '\n[[ PackageOverrides ]]\n name = "xlsx"\n ignore = true\n'; }],
  ["an unreviewed top-level configuration key", input => { input.configuration = 'ignore = true\n' + input.configuration; }],
  ["duplicate exception keys", input => { input.configuration += '\nreason = "duplicate"\n'; }],
  ["an exception without justification", input => { input.configuration = input.configuration.replace(/reason = [^\n]+/, 'reason = ""'); }],
];

for (const [name, mutate] of negativeCases) {
  test(`rejects ${name}`, () => {
    const input = fixture();
    mutate(input);
    assert.throws(() => assertDependencyPolicy(input));
  });
}

test("the executable gate checks files before installing project dependencies", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bazaar-dependency-policy-"));
  const input = fixture();
  try {
    fs.mkdirSync(path.join(directory, "vendor"));
    fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify(input.manifest));
    fs.writeFileSync(path.join(directory, "pnpm-lock.yaml"), input.lockfile);
    fs.writeFileSync(path.join(directory, "osv-scanner.toml"), input.configuration);
    fs.writeFileSync(path.join(directory, "vendor/xlsx-source.json"), JSON.stringify(input.source));
    fs.writeFileSync(path.join(directory, sheetjsPolicy.archivePath), archive);
    fs.writeFileSync(path.join(directory, "report.json"), JSON.stringify(input.report));
    const script = new URL("./dependency-policy.mjs", import.meta.url);
    const run = () => spawnSync(process.execPath, [fileURLToPath(script), "--root", directory, "--report", "report.json"], {
      encoding: "utf8", timeout: 5_000,
    });
    assert.equal(run().status, 0);
    fs.writeFileSync(path.join(directory, sheetjsPolicy.archivePath), "corrupted");
    assert.notEqual(run().status, 0);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
