import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// OSV's two old npm advisories have unbounded SEMVER ranges even though their
// own descriptions limit them to <0.19.3 and <0.20.2. This exception applies
// only to these reviewed publisher bytes, never to npm xlsx or another release.
export const sheetjsPolicy = Object.freeze({
  name: "xlsx",
  version: "0.20.3",
  url: "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz",
  archivePath: "vendor/xlsx-0.20.3.tgz",
  sourcePath: "vendor/xlsx-source.json",
  integrity: "sha512-oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA==",
  sha256: "8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8",
  advisoryIds: ["GHSA-4r6h-8v6p-xvw6", "GHSA-5pgg-2g8v-p4x9"],
});

function lockfileSection(lockfile, name) {
  const lines = lockfile.split(/\r?\n/);
  const starts = lines.flatMap((line, index) => line === `${name}:` ? [index] : []);
  assert.equal(starts.length, 1, `Expected exactly one ${name} lockfile section`);
  const start = starts[0] + 1;
  let end = start;
  while (end < lines.length && !/^\S/.test(lines[end])) end += 1;
  return lines.slice(start, end);
}

function sheetjsEntries(lines) {
  const entries = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^ {2}(['"]?)(xlsx@.*?)\1:(?:\s*\{\})?\s*$/);
    if (!match) continue;
    let end = index + 1;
    while (end < lines.length && !/^ {2}\S/.test(lines[end])) end += 1;
    entries.push({ key: match[2], body: lines.slice(index + 1, end).join("\n") });
  }
  return entries;
}

function reviewedExceptionIds(configuration) {
  const exceptions = [];
  let current;
  for (const line of configuration.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("[")) {
      assert.match(trimmed, /^\[\[\s*IgnoredVulns\s*\]\]\s*(?:#.*)?$/,
        "Only reviewed advisory tables are allowed; no whole-package suppression");
      current = {};
      exceptions.push(current);
      continue;
    }
    const entry = trimmed.match(/^(id|reason)\s*=\s*("(?:[^"\\]|\\.)*")\s*(?:#.*)?$/);
    assert(entry && current, "Unreviewed OSV configuration field or value");
    assert.equal(current[entry[1]], undefined, "Duplicate OSV exception field");
    current[entry[1]] = JSON.parse(entry[2]);
  }
  assert(exceptions.every(exception => typeof exception.id === "string" &&
    typeof exception.reason === "string" && exception.reason.trim().length > 0),
  "Every exception needs an ID and a written justification");
  return exceptions.map(exception => exception.id);
}

export function assertDependencyPolicy({ manifest, lockfile, report, source, archive, configuration }) {
  const fileSpecifier = `file:${sheetjsPolicy.archivePath}`;
  assert.equal(manifest?.dependencies?.xlsx, fileSpecifier,
    "SheetJS must use the reviewed vendored publisher archive");
  assert.equal(manifest?.devDependencies?.xlsx, undefined,
    "An additional development SheetJS dependency needs a new review");
  for (const key of ["name", "version", "url", "integrity", "sha256"]) {
    assert.equal(source?.[key], sheetjsPolicy[key], `Unreviewed SheetJS source ${key}`);
  }
  assert(Buffer.isBuffer(archive) && archive.length > 0, "The reviewed SheetJS archive is missing");
  const integrity = `sha512-${createHash("sha512").update(archive).digest("base64")}`;
  assert.equal(integrity, sheetjsPolicy.integrity, "The actual SheetJS archive bytes changed");
  assert.equal(createHash("sha256").update(archive).digest("hex"), sheetjsPolicy.sha256,
    "The actual SheetJS archive SHA256 changed");

  assert.equal(typeof lockfile, "string", "A real pnpm lockfile is required");
  assert.match(lockfile, /^lockfileVersion: ['"]?9\.0['"]?\s*$/m,
    "A new lockfile format needs a dependency-policy review");
  const packages = sheetjsEntries(lockfileSection(lockfile, "packages"));
  assert.equal(packages.length, 1, "Expected one SheetJS package, with no second old copy");
  assert.equal(packages[0].key, `xlsx@${fileSpecifier}`, "Unreviewed SheetJS lockfile package");
  const integrityValues = [...packages[0].body.matchAll(/\bintegrity:\s*['"]?([^\s,'"}]+)['"]?/g)];
  assert.equal(integrityValues.length, 1, "SheetJS lockfile must pin one SHA512 integrity");
  assert.equal(integrityValues[0][1], integrity, "SheetJS lockfile integrity differs from the actual archive");
  const tarballValues = [...packages[0].body.matchAll(/\btarball:\s*['"]?([^\s,'"}]+)['"]?/g)];
  assert.equal(tarballValues.length, 1, "SheetJS lockfile must resolve one vendored archive");
  assert.equal(tarballValues[0][1], fileSpecifier, "SheetJS lockfile tarball source changed");
  assert.match(packages[0].body, /^ {4}version: ['"]?0\.20\.3['"]?\s*$/m,
    "SheetJS lockfile version must be exactly the reviewed release");
  const snapshots = sheetjsEntries(lockfileSection(lockfile, "snapshots"));
  assert.equal(snapshots.length, 1, "Expected one SheetJS dependency snapshot");
  assert.equal(snapshots[0].key, `xlsx@${fileSpecifier}`, "Unreviewed SheetJS dependency snapshot");

  assert(Array.isArray(report?.results), "OSV did not produce a results array");
  const scanned = report.results.filter(result => result.source?.type === "lockfile" &&
    typeof result.source.path === "string" && path.basename(result.source.path) === "pnpm-lock.yaml");
  assert.equal(scanned.length, 1, "Expected exactly one real pnpm lockfile scan result");
  const inventory = scanned[0].packages;
  assert(Array.isArray(inventory) && inventory.length > 0, "OSV inventory is empty or malformed");
  assert(inventory.every(result => typeof result.package?.name === "string" &&
    typeof result.package.version === "string"), "OSV package inventory is malformed");
  const sheetjs = inventory.filter(result => result.package.name === "xlsx");
  assert.equal(sheetjs.length, 1, "OSV must inventory the one reviewed SheetJS package");
  assert.equal(sheetjs[0].package.ecosystem, "npm", "SheetJS OSV ecosystem changed");
  assert.equal(sheetjs[0].package.version, sheetjsPolicy.version,
    "OSV found an unreviewed or old SheetJS version");

  assert.equal(typeof configuration, "string", "OSV exception configuration is required");
  const ignoredIds = reviewedExceptionIds(configuration);
  assert.deepEqual(ignoredIds.sort(), [...sheetjsPolicy.advisoryIds].sort(),
    "Only the two reviewed SheetJS advisory exceptions are allowed");

  // Do not filter or mutate report.vulnerabilities here. The official reporter
  // remains mandatory and must fail for every other present or future finding.
  return { scannedPackages: inventory.length, sheetjsVersion: sheetjsPolicy.version, integrity };
}

export function checkDependencyPolicy(root, reportPath) {
  return assertDependencyPolicy({
    manifest: JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")),
    lockfile: fs.readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8"),
    report: JSON.parse(fs.readFileSync(path.resolve(root, reportPath), "utf8")),
    source: JSON.parse(fs.readFileSync(path.join(root, sheetjsPolicy.sourcePath), "utf8")),
    archive: fs.readFileSync(path.join(root, sheetjsPolicy.archivePath)),
    configuration: fs.readFileSync(path.join(root, "osv-scanner.toml"), "utf8"),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let root = process.cwd();
  let reportPath;
  while (args.length > 0) {
    const flag = args.shift();
    const value = args.shift();
    assert(value, `Missing value for ${flag}`);
    if (flag === "--root") root = path.resolve(value);
    else if (flag === "--report") reportPath = value;
    else throw new Error(`Unknown option ${flag}`);
  }
  assert(reportPath, "Usage: node scripts/deployment/dependency-policy.mjs --report osv-results.json [--root directory]");
  console.log(JSON.stringify(checkDependencyPolicy(root, reportPath)));
}
