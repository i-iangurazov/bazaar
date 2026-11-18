import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A reviewed, time-boxed exception for one OSV advisory in two exact picomatch
 * versions. The raw OSV report is never modified; this module writes a separate
 * gated report for the mandatory fail-on-vulnerability reporter.
 *
 * The exception is intentionally narrow:
 * - the advisory ID must match exactly;
 * - the report may contain it only for the two reviewed versions;
 * - the lockfile graph must match the reviewed chains exactly;
 * - the exception stops working before 2026-11-25 23:59 Bishkek (UTC+6);
 * - every other finding and every scanner error still blocks the release.
 */

export const PICOMATCH_ADVISORY_ID = "GHSA-fc5q-39xc-vjpf";
export const PICOMATCH_ALLOWED_VERSIONS = Object.freeze(["2.3.2", "4.0.7"]);
// 2026-11-25 23:59:00 Asia/Bishkek (UTC+6) is 2026-11-25 17:59:00 UTC.
export const PICOMATCH_EXCEPTION_EXPIRES_AT = "2026-11-25T17:59:00.000Z";
export const PICOMATCH_EXCEPTION_EXPIRES_AT_BISHKEK = "2026-11-25T23:59:00+06:00";

const stripQuotes = (value) => value.replace(/^['"]|['"]$/g, "");

const fail = (code, message) => {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
};

function parsePeers(key) {
  const peers = [];
  let depth = 0;
  let start = -1;
  for (let index = 0; index < key.length; index += 1) {
    const char = key[index];
    if (char === "(") {
      if (depth === 0) start = index + 1;
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        peers.push(key.slice(start, index));
        start = -1;
      }
    }
  }
  return peers;
}

/**
 * Parses the pnpm lockfile sections needed to prove the dependency chains.
 * It deliberately uses only Node built-ins so the dependency-security job can
 * run before `pnpm install`.
 */
export function parseLockfileGraph(lockfile) {
  const lines = lockfile.split(/\r?\n/);
  const snapshots = new Map();
  const importers = new Map();
  let section = null;
  let currentSnapshot = null;
  let currentSnapshotKind = null;
  let currentImporter = null;
  let currentImporterKind = null;
  let currentImporterDep = null;

  for (const line of lines) {
    if (/^importers:\s*$/.test(line)) { section = "importers"; continue; }
    if (/^packages:\s*$/.test(line)) { section = "packages"; continue; }
    if (/^snapshots:\s*$/.test(line)) { section = "snapshots"; continue; }
    if (/^\S/.test(line)) { section = null; continue; }

    if (section === "importers") {
      const importer = line.match(/^  (\S.*?):\s*$/);
      if (importer) {
        currentImporter = stripQuotes(importer[1]);
        importers.set(currentImporter, { prod: new Map(), dev: new Map(), optional: new Map() });
        currentImporterKind = null;
        currentImporterDep = null;
        continue;
      }
      const kind = line.match(/^    (dependencies|devDependencies|optionalDependencies):\s*$/);
      if (kind) {
        currentImporterKind = kind[1] === "dependencies" ? "prod" : kind[1] === "devDependencies" ? "dev" : "optional";
        continue;
      }
      if (/^    \S.*?:\s*$/.test(line)) {
        currentImporterKind = null;
        currentImporterDep = null;
        continue;
      }
      const dep = line.match(/^      (\S.*?):\s*$/);
      if (dep && currentImporter && currentImporterKind) {
        currentImporterDep = stripQuotes(dep[1]);
        continue;
      }
      const version = line.match(/^        version:\s*(.+?)\s*$/);
      if (version && currentImporter && currentImporterKind && currentImporterDep) {
        importers.get(currentImporter)[currentImporterKind].set(currentImporterDep, stripQuotes(version[1]));
        currentImporterDep = null;
        continue;
      }
    }

    if (section === "snapshots") {
      const snapshot = line.match(/^  (\S.*?):\s*(\{\})?\s*$/);
      if (snapshot) {
        currentSnapshot = stripQuotes(snapshot[1]);
        snapshots.set(currentSnapshot, { deps: new Map(), peers: parsePeers(currentSnapshot) });
        currentSnapshotKind = null;
        continue;
      }
      const kind = line.match(/^    (dependencies|optionalDependencies):\s*$/);
      if (kind) { currentSnapshotKind = kind[1]; continue; }
      if (/^    \S.*?:\s*$/.test(line)) {
        currentSnapshotKind = null;
        continue;
      }
      const dep = line.match(/^      (\S.*?):\s*(.+?)\s*$/);
      if (dep && currentSnapshot && currentSnapshotKind) {
        snapshots.get(currentSnapshot).deps.set(
          stripQuotes(dep[1]),
          stripQuotes(dep[2]),
        );
      }
    }
  }

  return { importers, snapshots };
}

function buildReverseGraph(graph) {
  const reverse = new Map();
  const addEdge = (parent, child) => {
    if (!reverse.has(child)) reverse.set(child, new Set());
    reverse.get(child).add(parent);
  };

  for (const [importer, kinds] of graph.importers) {
    for (const [kind, deps] of Object.entries(kinds)) {
      for (const [name, version] of deps) {
        const child = `${name}@${version}`;
        if (graph.snapshots.has(child)) addEdge(`root:${importer}:${kind}`, child);
      }
    }
  }

  for (const [key, value] of graph.snapshots) {
    for (const [name, version] of value.deps) {
      const child = `${name}@${version}`;
      if (graph.snapshots.has(child)) addEdge(key, child);
    }
    for (const peer of value.peers) {
      if (graph.snapshots.has(peer)) addEdge(key, peer);
    }
  }

  return reverse;
}

/** Returns every reviewed root-to-picomatch chain, sorted and deduplicated. */
export function collectPicomatchChains(graph) {
  const reverse = buildReverseGraph(graph);
  const targets = [...graph.snapshots.keys()].filter((key) => key.startsWith("picomatch@"));
  const paths = new Set();
  let unreachable = false;

  for (const target of targets) {
    let found = false;
    const walk = (node, path, seen) => {
      if (seen.has(node)) return;
      if (node.startsWith("root:")) {
        paths.add(path.join(" -> "));
        found = true;
        return;
      }
      const parents = reverse.get(node);
      if (!parents || parents.size === 0) return;
      const nextSeen = new Set(seen).add(node);
      for (const parent of parents) walk(parent, [parent, ...path], nextSeen);
    };
    walk(target, [target], new Set());
    if (!found) unreachable = true;
  }

  if (unreachable) {
    fail("PICOMATCH_EXCEPTION_UNREACHABLE", "A picomatch snapshot has no reviewed root dependency path.");
  }
  return [...paths].sort();
}

export function chainsDigest(chains) {
  return createHash("sha256").update(JSON.stringify([...chains].sort())).digest("hex");
}

function assertConfig(config) {
  if (!config || typeof config !== "object") {
    fail("PICOMATCH_EXCEPTION_CONFIG_INVALID", "The reviewed exception configuration is missing.");
  }
  if (config.advisoryId !== PICOMATCH_ADVISORY_ID) {
    fail("PICOMATCH_EXCEPTION_CONFIG_INVALID", "The exception advisory ID changed.");
  }
  if (JSON.stringify(config.versions) !== JSON.stringify(PICOMATCH_ALLOWED_VERSIONS)) {
    fail("PICOMATCH_EXCEPTION_CONFIG_INVALID", "The exception versions changed; re-review is required.");
  }
  if (config.expiresAt !== PICOMATCH_EXCEPTION_EXPIRES_AT ||
      config.expiresAtBishkek !== PICOMATCH_EXCEPTION_EXPIRES_AT_BISHKEK) {
    fail("PICOMATCH_EXCEPTION_CONFIG_INVALID", "The exception expiry changed; re-review is required.");
  }
  if (typeof config.justification !== "string" || config.justification.trim().length < 40) {
    fail("PICOMATCH_EXCEPTION_CONFIG_INVALID", "The exception needs a written justification.");
  }
  if (!Array.isArray(config.chains) || config.chains.length === 0) {
    fail("PICOMATCH_EXCEPTION_CONFIG_INVALID", "The reviewed dependency chains are missing.");
  }
  if (config.chainsDigest !== chainsDigest(config.chains)) {
    fail("PICOMATCH_EXCEPTION_CONFIG_INVALID", "The reviewed dependency-chain digest is stale.");
  }
}

function lockfileResults(report) {
  if (!report || !Array.isArray(report.results)) {
    fail("PICOMATCH_EXCEPTION_REPORT_INVALID", "The OSV report has no results array.");
  }
  const matches = report.results.filter((result) =>
    result?.source?.type === "lockfile" &&
    typeof result.source.path === "string" &&
    basename(result.source.path) === "pnpm-lock.yaml");
  if (matches.length !== 1) {
    fail("PICOMATCH_EXCEPTION_REPORT_INVALID", "Expected exactly one pnpm-lock.yaml scan result.");
  }
  const packages = matches[0].packages;
  if (!Array.isArray(packages) || packages.length === 0) {
    fail("PICOMATCH_EXCEPTION_REPORT_INVALID", "The pnpm-lock.yaml scan inventory is empty or malformed.");
  }
  return matches[0];
}

function countVulnerabilities(report) {
  const result = lockfileResults(report);
  return result.packages.reduce((total, entry) => {
    if (entry?.vulnerabilities === undefined) return total;
    if (!Array.isArray(entry.vulnerabilities)) {
      fail("PICOMATCH_EXCEPTION_REPORT_INVALID", "An OSV vulnerabilities field is malformed.");
    }
    return total + entry.vulnerabilities.length;
  }, 0);
}

/**
 * Validates the exception against the current lockfile, report and clock, then
 * returns a separate report for the reporter with only the reviewed advisory
 * removed. The input report is never mutated and remains the full scan record.
 */
export function assertPicomatchException({ lockfile, report, config, now = new Date() }) {
  assertConfig(config);

  const expiresAt = new Date(config.expiresAt);
  if (Number.isNaN(expiresAt.getTime())) {
    fail("PICOMATCH_EXCEPTION_CONFIG_INVALID", "The exception expiry is not a valid instant.");
  }
  if (now.getTime() >= expiresAt.getTime()) {
    fail("PICOMATCH_EXCEPTION_EXPIRED", `The picomatch exception expired at ${config.expiresAt}. Re-review is required.`);
  }

  const graph = parseLockfileGraph(lockfile);
  const actualChains = collectPicomatchChains(graph);
  const expectedChains = [...config.chains].sort();
  if (JSON.stringify(actualChains) !== JSON.stringify(expectedChains)) {
    const added = actualChains.filter((chain) => !expectedChains.includes(chain));
    const missing = expectedChains.filter((chain) => !actualChains.includes(chain));
    fail("PICOMATCH_EXCEPTION_SCOPE_CHANGED",
      `The dependency scope changed. Added: ${added.join(" | ") || "none"}. Missing: ${missing.join(" | ") || "none"}.`);
  }

  const result = lockfileResults(report);
  const allowed = new Set(PICOMATCH_ALLOWED_VERSIONS);
  const findings = [];
  for (const entry of result.packages) {
    const pkg = entry?.package;
    if (!pkg || typeof pkg.name !== "string" || typeof pkg.version !== "string") {
      fail("PICOMATCH_EXCEPTION_REPORT_INVALID", "The OSV package inventory is malformed.");
    }
    if (entry.vulnerabilities === undefined) continue;
    if (!Array.isArray(entry.vulnerabilities)) {
      fail("PICOMATCH_EXCEPTION_REPORT_INVALID", "An OSV vulnerabilities field is malformed.");
    }
    for (const vulnerability of entry.vulnerabilities) {
      if (vulnerability?.id === PICOMATCH_ADVISORY_ID) {
        findings.push({ package: pkg, vulnerability });
      }
    }
  }

  if (findings.length === 0) {
    fail("PICOMATCH_EXCEPTION_STALE", "The reviewed advisory is no longer reported; remove the exception.");
  }
  for (const finding of findings) {
    if (finding.package.name !== "picomatch" || !allowed.has(finding.package.version)) {
      fail("PICOMATCH_EXCEPTION_SCOPE_CHANGED",
        `The advisory appeared on ${finding.package.name}@${finding.package.version}, outside the reviewed scope.`);
    }
  }
  for (const version of PICOMATCH_ALLOWED_VERSIONS) {
    const count = findings.filter((finding) => finding.package.version === version).length;
    if (count !== 1) {
      fail("PICOMATCH_EXCEPTION_SCOPE_CHANGED", `Expected exactly one reviewed finding for picomatch@${version}, got ${count}.`);
    }
  }

  const gatedReport = structuredClone(report);
  const gatedResult = lockfileResults(gatedReport);
  for (const entry of gatedResult.packages) {
    if (entry.package?.name !== "picomatch" || !allowed.has(entry.package.version)) continue;
    if (!Array.isArray(entry.vulnerabilities)) continue;
    entry.vulnerabilities = entry.vulnerabilities.filter((vulnerability) => vulnerability?.id !== PICOMATCH_ADVISORY_ID);
    if (entry.vulnerabilities.length === 0) delete entry.vulnerabilities;
  }

  const rawFindings = countVulnerabilities(report);
  const remainingFindings = countVulnerabilities(gatedReport);
  if (rawFindings - remainingFindings !== PICOMATCH_ALLOWED_VERSIONS.length) {
    fail("PICOMATCH_EXCEPTION_REPORT_INVALID", "The gated report removed an unexpected number of findings.");
  }
  if (remainingFindings !== rawFindings - PICOMATCH_ALLOWED_VERSIONS.length) {
    fail("PICOMATCH_EXCEPTION_REPORT_INVALID", "The gated report did not preserve unrelated findings.");
  }

  return {
    gatedReport,
    advisoryId: PICOMATCH_ADVISORY_ID,
    expiresAt: config.expiresAt,
    chains: actualChains.length,
    filteredFindings: findings.length,
    rawFindings,
    remainingFindings,
  };
}

/** Only the two reviewed versions may be removed; all other findings remain. */
export function filterPicomatchReport({ lockfile, report, config, now = new Date() }) {
  return assertPicomatchException({ lockfile, report, config, now });
}

function usage() {
  console.error("Usage: node scripts/deployment/picomatch-exception.mjs --report <raw.json> --output <gated.json> [--config <config.json>] [--root <dir>]");
  process.exit(2);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let root = process.cwd();
  let reportPath;
  let outputPath;
  let configPath = "scripts/deployment/picomatch-exception.json";
  while (args.length > 0) {
    const flag = args.shift();
    const value = args.shift();
    if (!value) usage();
    if (flag === "--root") root = resolve(value);
    else if (flag === "--report") reportPath = value;
    else if (flag === "--output") outputPath = value;
    else if (flag === "--config") configPath = value;
    else usage();
  }
  if (!reportPath || !outputPath) usage();
  if (resolve(root, reportPath) === resolve(root, outputPath)) {
    fail("PICOMATCH_EXCEPTION_REPORT_INVALID", "The gated output must be a separate file from the raw report.");
  }

  const lockfile = readFileSync(resolve(root, "pnpm-lock.yaml"), "utf8");
  const report = JSON.parse(readFileSync(resolve(root, reportPath), "utf8"));
  const config = JSON.parse(readFileSync(resolve(root, configPath), "utf8"));
  const result = assertPicomatchException({ lockfile, report, config, now: new Date() });
  writeFileSync(resolve(root, outputPath), `${JSON.stringify(result.gatedReport, null, 2)}\n`);
  console.log(JSON.stringify({
    advisoryId: result.advisoryId,
    expiresAt: result.expiresAt,
    chains: result.chains,
    filteredFindings: result.filteredFindings,
    rawFindings: result.rawFindings,
    remainingFindings: result.remainingFindings,
  }, null, 2));
}
