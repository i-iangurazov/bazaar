import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// A read-only audit policy, not permission to deploy/apply these migrations.
export const IOS_BILLING_MIGRATIONS = {
  "20261111120000_ios_apple_billing_privacy": "734e62c89a76aaedb153eb0b8029021f7713074b4526ca5501dac9abd41e2f38",
  "20261111130000_apple_lifecycle_recovery": "4d43cb3a27d30016fde92eb2465ff9f6ec8f148faf8d41495be89063fde2dc10",
  "20261111140000_apple_native_attempt_recovery": "1b3d22538c669d7f940e45dc14127842c25fe14accbe753c8a2b7e3efed32d0b",
  "20261111150000_apple_temporary_upgrades": "a13faf83ce11ad2c39480fbce1791299b82fd4fa58971bf3548f905c629a714f",
  "20261111160000_apple_deferred_outcomes": "66437a9da6224b1cfcc3a3c7d4ddc3be695119c7a00547a1256fa76f7c14201e",
  "20261111170000_apple_completion_utc_clock": "5b2bdce206b878ba9c616fbaf661c2c585acf81384de54ce2da334fd6f41016e",
} as const;
export const IOS_BILLING_MIGRATION_PREREQUISITES = {
  "20261111020000_manual_subscription_refunds": "800cd487fb2d4b0ecd5501e5edc7182c4a06b851f68b0b02c18e40d795370b87",
} as const;
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
export const IOS_PREFLIGHT_SQL = resolve(scriptDirectory, "ios-billing-preflight.sql");
const repositoryRoot = resolve(scriptDirectory, "../..");
const argumentNames = new Set(["--url-env", "--expect-host", "--expect-port", "--expect-database", "--expect-user", "--expect-stage", "--psql"]);
export class PreflightError extends Error {
  constructor(readonly code: string) { super(code); this.name = "PreflightError"; }
}
export type PreflightTarget = {
  host: string; port: string; database: string; user: string; password: string;
  sslmode: string; channelBinding: string;
};
export type PreflightOptions = { target: PreflightTarget; psql: string; expectedStage?: string };
export type PreflightCheck = { name: string; severity: "blocker" | "warning" | "info"; count: number | null; skipped: boolean; errorCode?: string };
export type PreflightReport = {
  reportVersion: 1; transactionReadOnly: true;
  schemaStage: "PRE_APPLE" | "POST_PRIVACY" | "POST_LIFECYCLE" | "POST_NATIVE_ATTEMPT" | "POST_TEMPORARY_UPGRADES" | "POST_DEFERRED_OUTCOMES" | "POST_COMPLETION_UTC" | "PARTIAL" | "UNBASELINED";
  checks: PreflightCheck[]; blockerChecks: number; warningChecks: number; skippedChecks: number; ok: boolean;
};

/** No dotenv imports, implicit DATABASE_URL, pg_service or pgpass fallback. */
export function parsePreflightTarget(args: string[], env: Record<string, string | undefined>): PreflightOptions {
  try {
    const values = new Map<string, string>();
    for (let index = 0; index < args.length; index += 2) {
      const key = args[index], value = args[index + 1];
      if (!argumentNames.has(key) || !value || value.startsWith("--") || values.has(key)) throw new PreflightError("PREFLIGHT_ARGUMENTS_INVALID");
      values.set(key, value);
    }
    for (const required of ["--url-env", "--expect-host", "--expect-port", "--expect-database", "--expect-user"])
      if (!values.has(required)) throw new PreflightError("PREFLIGHT_EXPLICIT_TARGET_REQUIRED");
    const variable = values.get("--url-env")!;
    if (!/^[A-Z_][A-Z0-9_]{0,100}$/.test(variable) || !env[variable]) throw new PreflightError("PREFLIGHT_TARGET_ENV_MISSING");
    const url = new URL(env[variable]!);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hash || !url.username || !url.hostname || !url.pathname.slice(1))
      throw new PreflightError("PREFLIGHT_TARGET_INVALID");
    const host = url.hostname, port = url.port || "5432", database = decodeURIComponent(url.pathname.slice(1)), user = decodeURIComponent(url.username);
    // libpq treats a PGDATABASE containing '=' or a URI prefix as another
    // connection string. Restrict the name instead of allowing redirection.
    if (!/^[A-Za-z0-9_.-]+$/.test(database) || /[\u0000-\u001f\u007f]/.test(user) || !/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535 ||
      host !== values.get("--expect-host") || port !== values.get("--expect-port") ||
      database !== values.get("--expect-database") || user !== values.get("--expect-user"))
      throw new PreflightError("PREFLIGHT_TARGET_FINGERPRINT_MISMATCH");
    const permittedParameters = new Set(["sslmode", "channel_binding", "schema", "pgbouncer", "connection_limit", "pool_timeout", "connect_timeout"]);
    for (const [key] of url.searchParams) if (!permittedParameters.has(key)) throw new PreflightError("PREFLIGHT_TARGET_OPTIONS_UNSUPPORTED");
    if (url.searchParams.has("schema") && url.searchParams.get("schema") !== "public") throw new PreflightError("PREFLIGHT_PUBLIC_SCHEMA_REQUIRED");
    const local = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(host);
    const sslmode = url.searchParams.get("sslmode") || (local ? "disable" : "");
    if (!(["disable", "prefer", "require", "verify-ca", "verify-full"].includes(sslmode)) || (!local && !["require", "verify-ca", "verify-full"].includes(sslmode)))
      throw new PreflightError("PREFLIGHT_EXPLICIT_TLS_REQUIRED");
    const channelBinding = url.searchParams.get("channel_binding") || "prefer";
    if (!["disable", "prefer", "require"].includes(channelBinding)) throw new PreflightError("PREFLIGHT_TARGET_OPTIONS_UNSUPPORTED");
    const expectedStage = values.get("--expect-stage");
    if (expectedStage && !["PRE_APPLE", "POST_PRIVACY", "POST_LIFECYCLE", "POST_NATIVE_ATTEMPT", "POST_TEMPORARY_UPGRADES", "POST_DEFERRED_OUTCOMES", "POST_COMPLETION_UTC"].includes(expectedStage)) throw new PreflightError("PREFLIGHT_STAGE_INVALID");
    return { target: { host, port, database, user, password: decodeURIComponent(url.password), sslmode, channelBinding },
      psql: values.get("--psql") || "psql", ...(expectedStage ? { expectedStage } : {}) };
  } catch (error) {
    if (error instanceof PreflightError) throw error;
    // URL/parser errors can contain credentials: never forward their messages.
    throw new PreflightError("PREFLIGHT_TARGET_INVALID");
  }
}

export type PreflightChildEnvironment = Record<string, string> & { NODE_ENV: "development" };
export function preflightProcessEnvironment(target: PreflightTarget, source: Record<string, string | undefined> = process.env): PreflightChildEnvironment {
  const env: Record<string, string> = {};
  // Do not inherit PGHOST/PGSERVICE/PGOPTIONS, or any application/provider secrets.
  for (const key of ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "SYSTEMROOT"])
    if (source[key]) env[key] = source[key]!;
  return { ...env, NODE_ENV: "development", PGHOST: target.host, PGPORT: target.port, PGDATABASE: target.database, PGUSER: target.user,
    PGPASSWORD: target.password, PGSSLMODE: target.sslmode, PGCHANNELBINDING: target.channelBinding,
    PGPASSFILE: "/dev/null", PGCONNECT_TIMEOUT: "10", PGAPPNAME: "bazaar-ios-apple-readonly-preflight" };
}
export type PreflightExecutor = (file: string, args: string[], env: PreflightChildEnvironment) => Promise<string>;
const executor: PreflightExecutor = (file, args, env) => new Promise((done, fail) => {
  execFile(file, args, { env, timeout: 45_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
    if (error) fail(new PreflightError("PREFLIGHT_READONLY_AUDIT_FAILED"));
    else done(stdout);
  });
});
export async function assertReviewedPreflightMigrations() {
  for (const [name, expected] of Object.entries({ ...IOS_BILLING_MIGRATION_PREREQUISITES, ...IOS_BILLING_MIGRATIONS })) {
    const content = await readFile(resolve(repositoryRoot, "prisma/migrations", name, "migration.sql"));
    if (createHash("sha256").update(content).digest("hex") !== expected) throw new PreflightError("PREFLIGHT_REVIEWED_SQL_CHANGED");
  }
}
export function parsePreflightReport(stdout: string, expectedStage?: string): PreflightReport {
  try {
    const input = JSON.parse(stdout.trim()) as PreflightReport;
    if (!input || input.reportVersion !== 1 || input.transactionReadOnly !== true || !Array.isArray(input.checks) || input.checks.length < 1 || input.checks.length > 100 ||
      !["PRE_APPLE", "POST_PRIVACY", "POST_LIFECYCLE", "POST_NATIVE_ATTEMPT", "POST_TEMPORARY_UPGRADES", "POST_DEFERRED_OUTCOMES", "POST_COMPLETION_UTC", "PARTIAL", "UNBASELINED"].includes(input.schemaStage) ||
      input.checks.some((c) => !c || !/^[a-z][a-z0-9_]{1,100}$/.test(c.name) || !["blocker", "warning", "info"].includes(c.severity) ||
        typeof c.skipped !== "boolean" || (c.count !== null && (!Number.isSafeInteger(c.count) || c.count < 0)) ||
        (c.errorCode !== undefined && !/^[0-9A-Z]{5}$/.test(c.errorCode))))
      throw new Error();
    // Reconstruct the public report so unexpected fields can never forward
    // query details, customer rows or credentials to logs.
    const result: PreflightReport = { reportVersion: 1, transactionReadOnly: true, schemaStage: input.schemaStage,
      checks: input.checks.map((c) => ({ name: c.name, severity: c.severity, count: c.count, skipped: c.skipped,
        ...(c.errorCode ? { errorCode: c.errorCode } : {}) })), blockerChecks: 0, warningChecks: 0, skippedChecks: 0, ok: false };
    if (expectedStage && result.schemaStage !== expectedStage) result.checks.push({ name: "expected_schema_stage_mismatch", severity: "blocker", count: 1, skipped: false });
    result.blockerChecks = result.checks.filter((c) => c.severity === "blocker" && !c.skipped && (c.count === null || c.count > 0)).length;
    result.warningChecks = result.checks.filter((c) => c.severity === "warning" && !c.skipped && (c.count === null || c.count > 0)).length;
    result.skippedChecks = result.checks.filter((c) => c.skipped).length;
    result.ok = result.blockerChecks === 0;
    return result;
  } catch { throw new PreflightError("PREFLIGHT_REPORT_INVALID"); }
}
export async function runIosBillingPreflight(options: PreflightOptions, sourceEnv: Record<string, string | undefined> = process.env,
  execute: PreflightExecutor = executor): Promise<PreflightReport> {
  await assertReviewedPreflightMigrations();
  let stdout: string;
  try { stdout = await execute(options.psql, ["-X", "--no-password", "--quiet", "--tuples-only", "--no-align", "--set", "ON_ERROR_STOP=1", "--file", IOS_PREFLIGHT_SQL],
    preflightProcessEnvironment(options.target, sourceEnv)); }
  catch { throw new PreflightError("PREFLIGHT_READONLY_AUDIT_FAILED"); }
  return parsePreflightReport(stdout, options.expectedStage);
}

async function main() {
  try {
    const options = parsePreflightTarget(process.argv.slice(2), process.env);
    const report = await runIosBillingPreflight(options);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) process.exitCode = 2;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ reportVersion: 1, ok: false, issues: [{ code: error instanceof PreflightError ? error.code : "PREFLIGHT_FAILED" }] })}\n`);
    process.exitCode = 2;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
