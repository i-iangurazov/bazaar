import { spawnSync } from "node:child_process";

const productionOnly = process.argv.includes("--prod");
const audit = spawnSync("pnpm", ["audit", ...(productionOnly ? ["--prod"] : []), "--json"], {
  encoding: "utf8",
  maxBuffer: 50 * 1024 * 1024,
});

if (!audit.stdout.trim()) {
  process.stderr.write(audit.stderr || "pnpm audit returned no JSON output.\n");
  process.exit(2);
}

let report;
try {
  report = JSON.parse(audit.stdout);
} catch (error) {
  process.stderr.write(`Unable to parse pnpm audit JSON: ${String(error)}\n`);
  process.exit(2);
}

const modules = new Map();
for (const advisory of Object.values(report.advisories ?? {})) {
  const name = advisory.module_name ?? advisory.name ?? "unknown";
  const moduleSummary = modules.get(name) ?? {
    advisories: 0,
    severities: {},
    patchedVersions: new Set(),
    paths: new Set(),
  };
  moduleSummary.advisories += 1;
  moduleSummary.severities[advisory.severity] =
    (moduleSummary.severities[advisory.severity] ?? 0) + 1;
  if (advisory.patched_versions) {
    moduleSummary.patchedVersions.add(advisory.patched_versions);
  }
  for (const finding of advisory.findings ?? []) {
    for (const path of finding.paths ?? []) moduleSummary.paths.add(path);
  }
  modules.set(name, moduleSummary);
}

const normalizedModules = Object.fromEntries(
  [...modules.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, module]) => [
      name,
      {
        advisories: module.advisories,
        severities: module.severities,
        patchedVersions: [...module.patchedVersions].sort(),
        paths: [...module.paths].sort(),
      },
    ]),
);

process.stdout.write(
  `${JSON.stringify(
    {
      scope: productionOnly ? "production" : "all",
      vulnerabilities: report.metadata?.vulnerabilities ?? null,
      dependencyCounts: {
        production: report.metadata?.dependencies ?? null,
        development: report.metadata?.devDependencies ?? null,
        optional: report.metadata?.optionalDependencies ?? null,
        total: report.metadata?.totalDependencies ?? null,
      },
      modules: normalizedModules,
    },
    null,
    2,
  )}\n`,
);

process.exitCode = audit.status === 0 ? 0 : 1;
