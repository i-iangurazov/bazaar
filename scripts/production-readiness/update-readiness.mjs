import { execFile } from "node:child_process";
import { lstat, mkdtemp, open, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "../..");
const CALCULATOR = path.join(SCRIPT_DIRECTORY, "calculate-readiness.mjs");
const DEFAULT_BASELINE = path.join(
  REPOSITORY_ROOT,
  "docs/production-readiness/readiness-baseline.json",
);
const DEFAULT_CURRENT = path.join(
  REPOSITORY_ROOT,
  "docs/production-readiness/readiness-current.json",
);

const ALLOWED_STATUSES = new Set(["PASS", "PARTIAL", "FAIL", "BLOCKED", "N_A"]);
const REQUIREMENT_MUTABLE_FIELDS = new Set([
  "currentStatus",
  "currentExecuted",
  "validation",
  "evidence",
  "currentNotes",
  "statusJustification",
  "lastVerificationTimestamp",
  "verificationTimestampSource",
  "history",
]);
const DEFECT_MUTABLE_FIELDS = new Set(["currentStatus", "resolvedAt", "resolutionEvidence"]);
const TOP_LEVEL_MUTABLE_FIELDS = new Set([
  "supportingMetrics",
  "defects",
  "requirements",
  "snapshotKind",
  "generatedAt",
  "immutable",
]);
const REQUIREMENT_PATCH_FIELDS = new Set([
  "id",
  "currentStatus",
  "currentExecuted",
  "currentNotes",
  "statusJustification",
  "verificationTimestampSource",
  "evidence",
  "validation",
]);
const REQUIRED_REQUIREMENT_PATCH_FIELDS = new Set([
  "id",
  "currentStatus",
  "currentExecuted",
  "currentNotes",
  "statusJustification",
  "verificationTimestampSource",
  "evidence",
]);
const DEFECT_PATCH_FIELDS = new Set(["id", "currentStatus", "resolutionEvidence"]);
const HISTORY_FIELDS = new Set([
  "timestamp",
  "fromStatus",
  "toStatus",
  "fromExecuted",
  "toExecuted",
  "reason",
  "evidence",
]);
const VALIDATION_FIELDS = new Set(["commands", "tests", "manualProcedure"]);
const SUPPORTING_METRICS_PATCH_FIELDS = new Set(["value", "evidence"]);
const SUPPORTING_METRICS_FIELDS = new Set([
  "routes",
  "workflows",
  "roles",
  "responsive",
  "localization",
]);
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const compareStrings = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

const USAGE = `Usage:
  node scripts/production-readiness/update-readiness.mjs \\
    --manifest <repo-relative-manifest.json> \\
    --output <new-output.json> \\
    [--baseline <baseline.json>] [--current <current.json>]

Manifest contract:
  {
    "schemaVersion": 1,
    "timestamp": "<canonical UTC ISO timestamp with milliseconds>",
    "requirements": [{
      "id": "BZR-REQ-0001",
      "currentStatus": "PASS|PARTIAL|FAIL|BLOCKED|N_A",
      "currentExecuted": true,
      "currentNotes": "...",
      "statusJustification": "...",
      "verificationTimestampSource": "...",
      "evidence": [
        { "type": "file", "path": "repo/relative/file", "description": "..." },
        { "type": "command", "command": "pnpm ...", "exitCode": 0, "summary": "..." }
      ],
      "validation": {
        "commands": ["pnpm ..."],
        "tests": ["repo/relative/test"],
        "manualProcedure": null
      }
    }],
    "defects": [{
      "id": "DEFECT-ID",
      "currentStatus": "RESOLVED",
      "resolutionEvidence": [<typed evidence as above>]
    }],
    "supportingMetrics": {
      "value": { "routes": {}, "workflows": {}, "roles": {}, "responsive": {}, "localization": {} },
      "evidence": [<typed evidence as above>]
    }
  }

The output path is mandatory and must not already exist. The source tracker is never overwritten.`;

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const fail = (message) => {
  throw new Error(message);
};

const parseArguments = () => {
  const args = process.argv.slice(2);
  const result = {
    baseline: DEFAULT_BASELINE,
    current: DEFAULT_CURRENT,
    manifest: null,
    output: null,
    help: false,
  };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === "--") continue;
    if (option === "--help" || option === "-h") {
      result.help = true;
      continue;
    }
    if (!["--baseline", "--current", "--manifest", "--output"].includes(option)) {
      fail(`Unknown argument: ${option}`);
    }
    if (seen.has(option)) fail(`Duplicate argument: ${option}`);
    seen.add(option);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) fail(`Missing value for ${option}`);
    result[option.slice(2)] = path.resolve(value);
    index += 1;
  }
  if (!result.help && (!result.manifest || !result.output)) {
    fail("Both --manifest and --output are required");
  }
  return result;
};

const assertPlainObject = (value, label) => {
  if (!isPlainObject(value)) fail(`${label} must be a JSON object`);
};

const assertObjectFields = (value, allowed, required, label) => {
  assertPlainObject(value, label);
  const keys = Object.keys(value);
  const unknown = keys.filter((key) => !allowed.has(key));
  if (unknown.length) fail(`${label} contains unsupported field(s): ${unknown.sort().join(", ")}`);
  const missing = [...required].filter((key) => !Object.hasOwn(value, key));
  if (missing.length) fail(`${label} is missing required field(s): ${missing.sort().join(", ")}`);
};

const assertSameKeys = (left, right, label) => {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (!isDeepStrictEqual(leftKeys, rightKeys)) fail(`${label} field set differs from the baseline`);
};

const assertNonEmptyString = (value, label, { singleLine = false } = {}) => {
  if (typeof value !== "string" || value.trim() !== value || !value.length) {
    fail(`${label} must be a non-empty, trimmed string`);
  }
  if (value.length > 2_000) fail(`${label} exceeds 2,000 characters`);
  const unsupportedControlCharacters = singleLine
    ? /[\u0000-\u001f\u007f]/
    : /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
  if (unsupportedControlCharacters.test(value)) {
    fail(`${label} contains unsupported control characters`);
  }
};

const assertTimestamp = (value, label) => {
  assertNonEmptyString(value, label, { singleLine: true });
  if (
    !ISO_TIMESTAMP_PATTERN.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    fail(`${label} must be a canonical UTC ISO timestamp with milliseconds`);
  }
};

const assertNonNegativeInteger = (value, label) => {
  if (!Number.isInteger(value) || value < 0) fail(`${label} must be a non-negative integer`);
};

const assertBoolean = (value, label) => {
  if (typeof value !== "boolean") fail(`${label} must be a boolean`);
};

const assertUniqueStringList = (values, label) => {
  if (!Array.isArray(values)) fail(`${label} must be an array`);
  values.forEach((value, index) =>
    assertNonEmptyString(value, `${label}[${index}]`, { singleLine: true }),
  );
  if (new Set(values).size !== values.length) fail(`${label} contains duplicate entries`);
  return [...values];
};

const normalizeOutcomeMatrix = (value, statuses, label) => {
  const fields = new Set([...statuses, "total"]);
  assertObjectFields(value, fields, fields, label);
  for (const field of fields) assertNonNegativeInteger(value[field], `${label}.${field}`);
  const outcomeTotal = statuses.reduce((sum, status) => sum + value[status], 0);
  if (outcomeTotal !== value.total) {
    fail(`${label} outcomes must sum exactly to total`);
  }
  return Object.fromEntries([...statuses, "total"].map((field) => [field, value[field]]));
};

const normalizeExecutedTotal = (value, label) => {
  const fields = new Set(["executed", "total"]);
  assertObjectFields(value, fields, fields, label);
  assertNonNegativeInteger(value.executed, `${label}.executed`);
  assertNonNegativeInteger(value.total, `${label}.total`);
  if (value.executed > value.total) fail(`${label}.executed cannot exceed total`);
  return { executed: value.executed, total: value.total };
};

const normalizeSupportingMetrics = (value, label) => {
  assertObjectFields(value, SUPPORTING_METRICS_FIELDS, SUPPORTING_METRICS_FIELDS, label);

  const routeFields = new Set(["exact", "canonical"]);
  assertObjectFields(value.routes, routeFields, routeFields, `${label}.routes`);
  const exact = normalizeOutcomeMatrix(
    value.routes.exact,
    ["PASS", "PARTIAL", "FAIL", "BLOCKED"],
    `${label}.routes.exact`,
  );
  const canonical = normalizeOutcomeMatrix(
    value.routes.canonical,
    ["PASS", "PARTIAL", "FAIL", "BLOCKED"],
    `${label}.routes.canonical`,
  );
  if (exact.total !== 132 || canonical.total !== 116) {
    fail(`${label}.routes must preserve the audited totals of 132 exact and 116 canonical forms`);
  }

  const workflowFields = new Set(["total", "executed", "outcomes"]);
  assertObjectFields(value.workflows, workflowFields, workflowFields, `${label}.workflows`);
  assertNonNegativeInteger(value.workflows.total, `${label}.workflows.total`);
  assertNonNegativeInteger(value.workflows.executed, `${label}.workflows.executed`);
  const workflowOutcomes = normalizeOutcomeMatrix(
    { ...value.workflows.outcomes, total: value.workflows.total },
    ["PASS", "PARTIAL", "FAIL", "BLOCKED"],
    `${label}.workflows.outcomes`,
  );
  const executedWorkflowOutcomes =
    workflowOutcomes.PASS + workflowOutcomes.PARTIAL + workflowOutcomes.FAIL;
  if (value.workflows.executed !== executedWorkflowOutcomes) {
    fail(`${label}.workflows.executed must equal PASS + PARTIAL + FAIL`);
  }

  const roleFields = new Set([
    "credentialed",
    "expected",
    "credentialedRoleNames",
    "blockedRoleNames",
    "lowerRoleBoundaryAssertions",
    "crossTenantIsolationVerified",
  ]);
  assertObjectFields(value.roles, roleFields, roleFields, `${label}.roles`);
  assertNonNegativeInteger(value.roles.credentialed, `${label}.roles.credentialed`);
  assertNonNegativeInteger(value.roles.expected, `${label}.roles.expected`);
  const credentialedRoleNames = assertUniqueStringList(
    value.roles.credentialedRoleNames,
    `${label}.roles.credentialedRoleNames`,
  );
  const blockedRoleNames = assertUniqueStringList(
    value.roles.blockedRoleNames,
    `${label}.roles.blockedRoleNames`,
  );
  if (credentialedRoleNames.length !== value.roles.credentialed) {
    fail(`${label}.roles.credentialed must equal credentialedRoleNames.length`);
  }
  if (value.roles.credentialed + blockedRoleNames.length !== value.roles.expected) {
    fail(`${label}.roles credentialed and blocked names must account for every expected role`);
  }
  const allRoleNames = [...credentialedRoleNames, ...blockedRoleNames];
  if (new Set(allRoleNames).size !== allRoleNames.length) {
    fail(`${label}.roles credentialed and blocked names must be disjoint`);
  }
  const lowerRoleBoundaryAssertions = normalizeExecutedTotal(
    {
      executed: value.roles.lowerRoleBoundaryAssertions.passed,
      total: value.roles.lowerRoleBoundaryAssertions.total,
    },
    `${label}.roles.lowerRoleBoundaryAssertions`,
  );
  assertObjectFields(
    value.roles.lowerRoleBoundaryAssertions,
    new Set(["passed", "total"]),
    new Set(["passed", "total"]),
    `${label}.roles.lowerRoleBoundaryAssertions`,
  );
  assertBoolean(
    value.roles.crossTenantIsolationVerified,
    `${label}.roles.crossTenantIsolationVerified`,
  );

  const responsiveFields = new Set([
    "desktopExactForms",
    "tabletExactForms",
    "mobileExactForms",
    "publicViewportChecks",
    "adminViewportChecks",
  ]);
  assertObjectFields(value.responsive, responsiveFields, responsiveFields, `${label}.responsive`);
  const responsive = Object.fromEntries(
    [...responsiveFields].map((field) => [
      field,
      normalizeExecutedTotal(value.responsive[field], `${label}.responsive.${field}`),
    ]),
  );
  for (const field of ["desktopExactForms", "tabletExactForms", "mobileExactForms"]) {
    if (responsive[field].total !== 132) {
      fail(`${label}.responsive.${field}.total must preserve the 132 exact route forms`);
    }
  }

  const localizationFields = new Set([
    "supportedLocales",
    "compatibilityPrefixes",
    "representativePrefixAssertions",
    "fullRouteLocaleCrossProductVerified",
  ]);
  assertObjectFields(
    value.localization,
    localizationFields,
    localizationFields,
    `${label}.localization`,
  );
  const supportedLocales = assertUniqueStringList(
    value.localization.supportedLocales,
    `${label}.localization.supportedLocales`,
  );
  const compatibilityPrefixes = assertUniqueStringList(
    value.localization.compatibilityPrefixes,
    `${label}.localization.compatibilityPrefixes`,
  );
  const representativePrefixAssertions = normalizeExecutedTotal(
    {
      executed: value.localization.representativePrefixAssertions.passed,
      total: value.localization.representativePrefixAssertions.total,
    },
    `${label}.localization.representativePrefixAssertions`,
  );
  assertObjectFields(
    value.localization.representativePrefixAssertions,
    new Set(["passed", "total"]),
    new Set(["passed", "total"]),
    `${label}.localization.representativePrefixAssertions`,
  );
  assertBoolean(
    value.localization.fullRouteLocaleCrossProductVerified,
    `${label}.localization.fullRouteLocaleCrossProductVerified`,
  );

  return {
    routes: { exact, canonical },
    workflows: {
      total: value.workflows.total,
      executed: value.workflows.executed,
      outcomes: Object.fromEntries(
        ["PASS", "PARTIAL", "FAIL", "BLOCKED"].map((status) => [status, workflowOutcomes[status]]),
      ),
    },
    roles: {
      credentialed: value.roles.credentialed,
      expected: value.roles.expected,
      credentialedRoleNames,
      blockedRoleNames,
      lowerRoleBoundaryAssertions: {
        passed: lowerRoleBoundaryAssertions.executed,
        total: lowerRoleBoundaryAssertions.total,
      },
      crossTenantIsolationVerified: value.roles.crossTenantIsolationVerified,
    },
    responsive,
    localization: {
      supportedLocales,
      compatibilityPrefixes,
      representativePrefixAssertions: {
        passed: representativePrefixAssertions.executed,
        total: representativePrefixAssertions.total,
      },
      fullRouteLocaleCrossProductVerified: value.localization.fullRouteLocaleCrossProductVerified,
    },
  };
};

const readJson = async (filePath, label) => {
  let contents;
  try {
    contents = await readFile(filePath, "utf8");
  } catch (error) {
    fail(`Unable to read ${label} at ${filePath}: ${error.message}`);
  }
  try {
    return JSON.parse(contents);
  } catch (error) {
    fail(`Unable to parse ${label} at ${filePath}: ${error.message}`);
  }
};

const assertRegularFile = async (filePath, label) => {
  let details;
  try {
    details = await stat(filePath);
  } catch (error) {
    fail(`${label} does not exist at ${filePath}: ${error.message}`);
  }
  if (!details.isFile()) fail(`${label} must be a regular file: ${filePath}`);
};

const isWithin = (parent, child) => {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
};

const assertRepoFile = async (relativePath, label, { requireExistingFile = true } = {}) => {
  assertNonEmptyString(relativePath, label, { singleLine: true });
  if (
    path.isAbsolute(relativePath) ||
    relativePath.includes("\\") ||
    path.posix.normalize(relativePath) !== relativePath ||
    relativePath.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    fail(`${label} must be a normalized repository-relative path`);
  }
  if (!requireExistingFile) return;
  const repositoryRealPath = await realpath(REPOSITORY_ROOT);
  const candidate = path.resolve(REPOSITORY_ROOT, relativePath);
  let candidateRealPath;
  try {
    candidateRealPath = await realpath(candidate);
  } catch (error) {
    fail(`${label} does not resolve to an existing repository file: ${error.message}`);
  }
  if (!isWithin(repositoryRealPath, candidateRealPath)) {
    fail(`${label} resolves outside the repository`);
  }
  await assertRegularFile(candidateRealPath, label);
};

const assertManifestLocation = async (manifestPath) => {
  await assertRegularFile(manifestPath, "Manifest");
  const [repositoryRealPath, manifestRealPath] = await Promise.all([
    realpath(REPOSITORY_ROOT),
    realpath(manifestPath),
  ]);
  if (!isWithin(repositoryRealPath, manifestRealPath)) {
    fail("Manifest must be an existing file inside the repository");
  }
};

const normalizeEvidence = async (value, label, { requireExistingFiles = true } = {}) => {
  assertPlainObject(value, label);
  if (value.type === "file") {
    assertObjectFields(
      value,
      new Set(["type", "path", "description"]),
      new Set(["type", "path", "description"]),
      label,
    );
    await assertRepoFile(value.path, `${label}.path`, {
      requireExistingFile: requireExistingFiles,
    });
    assertNonEmptyString(value.description, `${label}.description`, { singleLine: true });
    return { type: "file", path: value.path, description: value.description };
  }
  if (value.type === "command") {
    assertObjectFields(
      value,
      new Set(["type", "command", "exitCode", "summary"]),
      new Set(["type", "command", "exitCode", "summary"]),
      label,
    );
    assertNonEmptyString(value.command, `${label}.command`, { singleLine: true });
    if (!Number.isInteger(value.exitCode) || value.exitCode < 0 || value.exitCode > 255) {
      fail(`${label}.exitCode must be an integer from 0 through 255`);
    }
    assertNonEmptyString(value.summary, `${label}.summary`, { singleLine: true });
    return {
      type: "command",
      command: value.command,
      exitCode: value.exitCode,
      summary: value.summary,
    };
  }
  fail(`${label}.type must be either "file" or "command"`);
};

const normalizeEvidenceList = async (values, label, { requireExistingFiles = true } = {}) => {
  if (!Array.isArray(values) || values.length === 0) {
    fail(`${label} must be a non-empty evidence array`);
  }
  if (values.length > 100) fail(`${label} cannot contain more than 100 entries`);
  const normalized = await Promise.all(
    values.map((value, index) =>
      normalizeEvidence(value, `${label}[${index}]`, { requireExistingFiles }),
    ),
  );
  normalized.sort((left, right) => compareStrings(JSON.stringify(left), JSON.stringify(right)));
  const serialized = normalized.map((value) => JSON.stringify(value));
  if (new Set(serialized).size !== serialized.length) fail(`${label} contains duplicate entries`);
  return normalized;
};

const normalizeStringArray = (
  values,
  label,
  { paths = false, requireExistingFiles = true } = {},
) => {
  if (!Array.isArray(values)) fail(`${label} must be an array`);
  const normalized = values.map((value, index) => {
    assertNonEmptyString(value, `${label}[${index}]`, { singleLine: true });
    return value;
  });
  normalized.sort();
  if (new Set(normalized).size !== normalized.length) fail(`${label} contains duplicate entries`);
  if (paths) {
    return Promise.all(
      normalized.map(async (value, index) => {
        await assertRepoFile(value, `${label}[${index}]`, {
          requireExistingFile: requireExistingFiles,
        });
        return value;
      }),
    );
  }
  return normalized;
};

const normalizeValidation = async (value, label, { requireExistingFiles = true } = {}) => {
  assertObjectFields(value, VALIDATION_FIELDS, VALIDATION_FIELDS, label);
  const commands = normalizeStringArray(value.commands, `${label}.commands`);
  const tests = await normalizeStringArray(value.tests, `${label}.tests`, {
    paths: true,
    requireExistingFiles,
  });
  if (value.manualProcedure !== null) {
    assertNonEmptyString(value.manualProcedure, `${label}.manualProcedure`);
  }
  return { commands, tests, manualProcedure: value.manualProcedure };
};

const validateStoredEvidence = async (values, label, { allowEmpty = true } = {}) => {
  if (!Array.isArray(values) || (!allowEmpty && values.length === 0)) {
    fail(`${label} must be ${allowEmpty ? "an" : "a non-empty"} evidence array`);
  }
  if (values.length === 0) return [];
  // Historical evidence may live in retained CI/audit storage rather than in a
  // clean source checkout. Keep strict path-shape validation here; new manifest
  // evidence is still required to exist when it is promoted.
  const normalized = await normalizeEvidenceList(values, label, {
    requireExistingFiles: false,
  });
  if (!isDeepStrictEqual(values, normalized)) {
    fail(`${label} is not in canonical evidence order or shape`);
  }
  return normalized;
};

const validateHistory = async (history, label) => {
  if (!Array.isArray(history)) fail(`${label} must be an array`);
  let previousTimestamp = null;
  for (let index = 0; index < history.length; index += 1) {
    const entry = history[index];
    const entryLabel = `${label}[${index}]`;
    assertObjectFields(entry, HISTORY_FIELDS, HISTORY_FIELDS, entryLabel);
    assertTimestamp(entry.timestamp, `${entryLabel}.timestamp`);
    if (previousTimestamp && entry.timestamp <= previousTimestamp) {
      fail(`${label} timestamps must be strictly increasing`);
    }
    previousTimestamp = entry.timestamp;
    if (!ALLOWED_STATUSES.has(entry.fromStatus) || !ALLOWED_STATUSES.has(entry.toStatus)) {
      fail(`${entryLabel} contains an invalid status`);
    }
    if (typeof entry.fromExecuted !== "boolean" || typeof entry.toExecuted !== "boolean") {
      fail(`${entryLabel} execution fields must be booleans`);
    }
    assertNonEmptyString(entry.reason, `${entryLabel}.reason`);
    await validateStoredEvidence(entry.evidence, `${entryLabel}.evidence`, { allowEmpty: false });
  }
};

const validateSnapshotAlignment = (current, baseline) => {
  assertPlainObject(baseline, "Baseline");
  assertPlainObject(current, "Current tracker");
  if (baseline.schemaVersion !== 1 || current.schemaVersion !== 1) {
    fail("Baseline and current tracker must both use readiness schema version 1");
  }
  if (baseline.snapshotKind !== "baseline" || baseline.immutable !== true) {
    fail("Baseline must be marked as an immutable baseline snapshot");
  }
  if (current.snapshotKind !== "current" || current.immutable !== false) {
    fail("Current tracker must be marked as a mutable current snapshot");
  }
  assertSameKeys(current, baseline, "Top-level tracker");
  for (const key of Object.keys(baseline)) {
    if (!TOP_LEVEL_MUTABLE_FIELDS.has(key) && !isDeepStrictEqual(current[key], baseline[key])) {
      fail(`Immutable top-level field drift: ${key}`);
    }
  }
  if (!Array.isArray(baseline.requirements) || !Array.isArray(current.requirements)) {
    fail("Baseline and current requirements must be arrays");
  }
  if (!Array.isArray(baseline.defects) || !Array.isArray(current.defects)) {
    fail("Baseline and current defects must be arrays");
  }

  const baselineRequirements = new Map(
    baseline.requirements.map((requirement) => [requirement.id, requirement]),
  );
  const currentRequirementIds = new Set(current.requirements.map((requirement) => requirement.id));
  if (
    baselineRequirements.size !== baseline.requirements.length ||
    currentRequirementIds.size !== current.requirements.length ||
    current.requirements.length !== baseline.requirements.length
  ) {
    fail("Requirement IDs do not align with the immutable baseline");
  }
  for (const requirement of current.requirements) {
    const baselineRequirement = baselineRequirements.get(requirement.id);
    if (!baselineRequirement) fail(`Requirement ${requirement.id} is absent from the baseline`);
    assertSameKeys(requirement, baselineRequirement, `Requirement ${requirement.id}`);
    for (const key of Object.keys(baselineRequirement)) {
      if (REQUIREMENT_MUTABLE_FIELDS.has(key)) continue;
      if (!isDeepStrictEqual(requirement[key], baselineRequirement[key])) {
        fail(`Immutable requirement field drift for ${requirement.id}: ${key}`);
      }
    }
    assertSameKeys(
      requirement.evidence,
      baselineRequirement.evidence,
      `${requirement.id}.evidence`,
    );
    if (!isDeepStrictEqual(requirement.evidence.baseline, baselineRequirement.evidence.baseline)) {
      fail(`Immutable requirement field drift for ${requirement.id}: evidence.baseline`);
    }
  }

  const baselineDefects = new Map(baseline.defects.map((defect) => [defect.id, defect]));
  const currentDefectIds = new Set(current.defects.map((defect) => defect.id));
  if (
    baselineDefects.size !== baseline.defects.length ||
    currentDefectIds.size !== current.defects.length ||
    current.defects.length !== baseline.defects.length
  ) {
    fail("Defect IDs do not align with the immutable baseline");
  }
  for (const defect of current.defects) {
    const baselineDefect = baselineDefects.get(defect.id);
    if (!baselineDefect) fail(`Defect ${defect.id} is absent from the baseline`);
    assertSameKeys(defect, baselineDefect, `Defect ${defect.id}`);
    for (const key of Object.keys(baselineDefect)) {
      if (DEFECT_MUTABLE_FIELDS.has(key)) continue;
      if (!isDeepStrictEqual(defect[key], baselineDefect[key])) {
        fail(`Immutable defect field drift for ${defect.id}: ${key}`);
      }
    }
  }
};

const validateCurrentMutableState = async (tracker) => {
  assertTimestamp(tracker.generatedAt, "Current tracker generatedAt");
  const normalizedSupportingMetrics = normalizeSupportingMetrics(
    tracker.supportingMetrics,
    "Current tracker supportingMetrics",
  );
  if (!isDeepStrictEqual(tracker.supportingMetrics, normalizedSupportingMetrics)) {
    fail("Current tracker supportingMetrics are not in canonical shape");
  }
  for (const requirement of tracker.requirements) {
    if (!ALLOWED_STATUSES.has(requirement.currentStatus)) {
      fail(`${requirement.id} has invalid currentStatus ${requirement.currentStatus}`);
    }
    if (typeof requirement.currentExecuted !== "boolean") {
      fail(`${requirement.id}.currentExecuted must be a boolean`);
    }
    assertNonEmptyString(requirement.currentNotes, `${requirement.id}.currentNotes`);
    assertNonEmptyString(requirement.statusJustification, `${requirement.id}.statusJustification`);
    assertNonEmptyString(
      requirement.verificationTimestampSource,
      `${requirement.id}.verificationTimestampSource`,
    );
    assertTimestamp(
      requirement.lastVerificationTimestamp,
      `${requirement.id}.lastVerificationTimestamp`,
    );
    await normalizeValidation(requirement.validation, `${requirement.id}.validation`, {
      requireExistingFiles: false,
    });
    await validateStoredEvidence(
      requirement.evidence.current,
      `${requirement.id}.evidence.current`,
    );
    await validateHistory(requirement.history, `${requirement.id}.history`);
  }
  for (const defect of tracker.defects) {
    if (!["OPEN", "RESOLVED"].includes(defect.currentStatus)) {
      fail(`${defect.id} has unsupported currentStatus ${defect.currentStatus}`);
    }
    if (defect.currentStatus === "RESOLVED") {
      assertTimestamp(defect.resolvedAt, `${defect.id}.resolvedAt`);
      await validateStoredEvidence(defect.resolutionEvidence, `${defect.id}.resolutionEvidence`, {
        allowEmpty: false,
      });
    } else if (defect.resolvedAt !== null || defect.resolutionEvidence.length !== 0) {
      fail(`${defect.id} is OPEN but contains resolution metadata`);
    }
  }
};

const validateManifest = (manifest) => {
  assertObjectFields(
    manifest,
    new Set(["schemaVersion", "timestamp", "requirements", "defects", "supportingMetrics"]),
    new Set(["schemaVersion", "timestamp", "requirements", "defects"]),
    "Manifest",
  );
  if (manifest.schemaVersion !== 1) fail("Manifest schemaVersion must be 1");
  assertTimestamp(manifest.timestamp, "Manifest timestamp");
  if (!Array.isArray(manifest.requirements) || !Array.isArray(manifest.defects)) {
    fail("Manifest requirements and defects must be arrays");
  }
  if (
    manifest.requirements.length + manifest.defects.length === 0 &&
    !Object.hasOwn(manifest, "supportingMetrics")
  ) {
    fail("Manifest must contain at least one requirement or defect patch");
  }
};

const normalizeSupportingMetricsPatch = async (patch) => {
  if (patch === undefined) return null;
  assertObjectFields(
    patch,
    SUPPORTING_METRICS_PATCH_FIELDS,
    SUPPORTING_METRICS_PATCH_FIELDS,
    "Supporting metrics patch",
  );
  const value = normalizeSupportingMetrics(patch.value, "Supporting metrics patch.value");
  const evidence = await normalizeEvidenceList(patch.evidence, "Supporting metrics patch.evidence");
  return { value, evidence };
};

const assertUniquePatchIds = (patches, label) => {
  const ids = new Set();
  for (const patch of patches) {
    assertPlainObject(patch, `${label} patch`);
    if (typeof patch.id !== "string" || !patch.id.length) fail(`${label} patch requires an id`);
    if (ids.has(patch.id)) fail(`Duplicate ${label} patch ID: ${patch.id}`);
    ids.add(patch.id);
  }
};

const appendUniqueEvidence = (existing, additions, label) => {
  const seen = new Set(existing.map((entry) => JSON.stringify(entry)));
  for (const addition of additions) {
    const serialized = JSON.stringify(addition);
    if (seen.has(serialized)) fail(`${label} repeats evidence already present in the tracker`);
    seen.add(serialized);
  }
  return [...existing, ...additions].sort((left, right) =>
    compareStrings(JSON.stringify(left), JSON.stringify(right)),
  );
};

const applyRequirementPatches = async (tracker, patches, timestamp) => {
  assertUniquePatchIds(patches, "requirement");
  const requirements = new Map(
    tracker.requirements.map((requirement) => [requirement.id, requirement]),
  );
  for (const patch of [...patches].sort((left, right) => compareStrings(left.id, right.id))) {
    const label = `Requirement patch ${patch.id}`;
    assertObjectFields(patch, REQUIREMENT_PATCH_FIELDS, REQUIRED_REQUIREMENT_PATCH_FIELDS, label);
    const requirement = requirements.get(patch.id);
    if (!requirement) fail(`${label} does not match a tracker requirement`);
    if (!ALLOWED_STATUSES.has(patch.currentStatus)) {
      fail(`${label}.currentStatus is invalid: ${patch.currentStatus}`);
    }
    if (typeof patch.currentExecuted !== "boolean") {
      fail(`${label}.currentExecuted must be a boolean`);
    }
    if (patch.currentStatus === "BLOCKED" && patch.currentExecuted) {
      fail(`${label} cannot be BLOCKED and executed`);
    }
    if (patch.currentStatus !== "BLOCKED" && !patch.currentExecuted) {
      fail(`${label} must be executed for an outcome other than BLOCKED`);
    }
    assertNonEmptyString(patch.currentNotes, `${label}.currentNotes`);
    assertNonEmptyString(patch.statusJustification, `${label}.statusJustification`);
    assertNonEmptyString(
      patch.verificationTimestampSource,
      `${label}.verificationTimestampSource`,
      { singleLine: true },
    );
    if (
      patch.currentStatus === "N_A" &&
      !/not applicable|out of scope|not present/i.test(patch.currentNotes)
    ) {
      fail(`${label} needs a written N_A justification`);
    }
    if (timestamp <= requirement.lastVerificationTimestamp) {
      fail(`${label} timestamp must be later than its current verification timestamp`);
    }
    const evidence = await normalizeEvidenceList(patch.evidence, `${label}.evidence`);
    const currentEvidence = appendUniqueEvidence(
      requirement.evidence.current,
      evidence,
      `${label}.evidence`,
    );
    let validation = requirement.validation;
    if (Object.hasOwn(patch, "validation")) {
      validation = await normalizeValidation(patch.validation, `${label}.validation`);
    }
    const historyEntry = {
      timestamp,
      fromStatus: requirement.currentStatus,
      toStatus: patch.currentStatus,
      fromExecuted: requirement.currentExecuted,
      toExecuted: patch.currentExecuted,
      reason: patch.statusJustification,
      evidence,
    };
    requirement.currentStatus = patch.currentStatus;
    requirement.currentExecuted = patch.currentExecuted;
    requirement.currentNotes = patch.currentNotes;
    requirement.statusJustification = patch.statusJustification;
    requirement.verificationTimestampSource = patch.verificationTimestampSource;
    requirement.lastVerificationTimestamp = timestamp;
    requirement.validation = validation;
    requirement.evidence.current = currentEvidence;
    requirement.history = [...requirement.history, historyEntry];
  }
};

const applyDefectPatches = async (tracker, patches, timestamp) => {
  assertUniquePatchIds(patches, "defect");
  const defects = new Map(tracker.defects.map((defect) => [defect.id, defect]));
  for (const patch of [...patches].sort((left, right) => compareStrings(left.id, right.id))) {
    const label = `Defect patch ${patch.id}`;
    assertObjectFields(patch, DEFECT_PATCH_FIELDS, DEFECT_PATCH_FIELDS, label);
    const defect = defects.get(patch.id);
    if (!defect) fail(`${label} does not match a tracker defect`);
    if (patch.currentStatus !== "RESOLVED") {
      fail(`${label}.currentStatus must be RESOLVED`);
    }
    if (defect.currentStatus === "RESOLVED") fail(`${label} is already resolved`);
    const evidence = await normalizeEvidenceList(
      patch.resolutionEvidence,
      `${label}.resolutionEvidence`,
    );
    defect.currentStatus = "RESOLVED";
    defect.resolvedAt = timestamp;
    defect.resolutionEvidence = appendUniqueEvidence(
      defect.resolutionEvidence,
      evidence,
      `${label}.resolutionEvidence`,
    );
  }
};

const validateWithCalculator = async (trackerPath, baselinePath, label) => {
  try {
    await execFileAsync(
      process.execPath,
      [CALCULATOR, "--tracker", trackerPath, "--baseline", baselinePath, "--json"],
      { cwd: REPOSITORY_ROOT, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
    );
  } catch (error) {
    const details = (error.stderr || error.stdout || error.message).trim();
    fail(`${label} failed the readiness calculator invariants: ${details}`);
  }
};

const assertOutputAvailable = async (outputPath, protectedPaths) => {
  if (protectedPaths.some((protectedPath) => path.resolve(protectedPath) === outputPath)) {
    fail("Output must be a new path and cannot replace an input file");
  }
  try {
    await lstat(outputPath);
    fail(`Output already exists and will not be overwritten: ${outputPath}`);
  } catch (error) {
    if (error.message.startsWith("Output already exists")) throw error;
    if (error.code !== "ENOENT") throw error;
  }
  const parent = path.dirname(outputPath);
  let parentDetails;
  try {
    parentDetails = await stat(parent);
  } catch (error) {
    fail(`Output parent directory does not exist: ${parent} (${error.message})`);
  }
  if (!parentDetails.isDirectory()) fail(`Output parent is not a directory: ${parent}`);
};

const writeExclusive = async (outputPath, contents) => {
  let handle;
  try {
    handle = await open(outputPath, "wx", 0o644);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle?.close();
  }
};

const main = async () => {
  const args = parseArguments();
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  await Promise.all([
    assertRegularFile(args.baseline, "Baseline"),
    assertRegularFile(args.current, "Current tracker"),
    assertManifestLocation(args.manifest),
  ]);
  await assertOutputAvailable(args.output, [args.baseline, args.current, args.manifest]);

  const [baseline, current, manifest] = await Promise.all([
    readJson(args.baseline, "baseline"),
    readJson(args.current, "current tracker"),
    readJson(args.manifest, "manifest"),
  ]);
  validateSnapshotAlignment(current, baseline);
  await validateCurrentMutableState(current);
  validateManifest(manifest);
  const supportingMetricsPatch = await normalizeSupportingMetricsPatch(manifest.supportingMetrics);
  if (manifest.timestamp <= current.generatedAt) {
    fail("Manifest timestamp must be later than the current tracker generatedAt timestamp");
  }
  await validateWithCalculator(args.current, args.baseline, "Input tracker");

  const updated = structuredClone(current);
  await applyRequirementPatches(updated, manifest.requirements, manifest.timestamp);
  await applyDefectPatches(updated, manifest.defects, manifest.timestamp);
  if (supportingMetricsPatch) {
    updated.supportingMetrics = supportingMetricsPatch.value;
  }
  updated.generatedAt = manifest.timestamp;

  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "bazaar-readiness-update-"));
  const temporaryTracker = path.join(temporaryDirectory, "readiness-updated.json");
  const contents = `${JSON.stringify(updated, null, 2)}\n`;
  try {
    await writeFile(temporaryTracker, contents, { flag: "wx" });
    await validateWithCalculator(temporaryTracker, args.baseline, "Updated tracker");
    await writeExclusive(args.output, contents);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  process.stdout.write(
    `${JSON.stringify({
      output: args.output,
      timestamp: manifest.timestamp,
      requirementPatches: manifest.requirements.length,
      defectPatches: manifest.defects.length,
      supportingMetricsPatched: Boolean(supportingMetricsPatch),
    })}\n`,
  );
};

main().catch((error) => {
  process.stderr.write(`Readiness update failed: ${error.message}\n`);
  process.exitCode = 1;
});
