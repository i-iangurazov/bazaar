import { describe, expect, it, vi } from "vitest";
import {
  assertReviewedPreflightMigrations, IOS_PREFLIGHT_SQL, parsePreflightReport, parsePreflightTarget,
  preflightProcessEnvironment, runIosBillingPreflight,
} from "../../scripts/deployment/ios-billing-preflight";

const url = "postgresql://synthetic_user:synthetic%40password@127.0.0.1:55461/bazaar_hardening_ci?schema=public";
const args = ["--url-env", "EXPLICIT_AUDIT_URL", "--expect-host", "127.0.0.1", "--expect-port", "55461",
  "--expect-database", "bazaar_hardening_ci", "--expect-user", "synthetic_user"];
const options = () => parsePreflightTarget(args, { EXPLICIT_AUDIT_URL: url });
const report = (extra: object = {}) => JSON.stringify({ reportVersion: 1, transactionReadOnly: true, schemaStage: "POST_NATIVE_ATTEMPT",
  checks: [{ name: "source_binding_invalid", severity: "blocker", count: 0, skipped: false }], ...extra });

describe("explicit read-only iOS migration preflight", () => {
  it("requires an explicit connection source and complete target fingerprint even when DATABASE_URL exists", () => {
    expect(() => parsePreflightTarget([], { DATABASE_URL: url })).toThrow("PREFLIGHT_EXPLICIT_TARGET_REQUIRED");
    expect(() => parsePreflightTarget(args, { DATABASE_URL: url })).toThrow("PREFLIGHT_TARGET_ENV_MISSING");
    expect(() => parsePreflightTarget(args.slice(0, -2), { EXPLICIT_AUDIT_URL: url })).toThrow("PREFLIGHT_EXPLICIT_TARGET_REQUIRED");
    expect(() => parsePreflightTarget([...args, "--expect-user", "other"], { EXPLICIT_AUDIT_URL: url })).toThrow("PREFLIGHT_ARGUMENTS_INVALID");
  });

  it.each([
    url.replace("127.0.0.1", "other.example"), url.replace(":55461/", ":5432/"),
    url.replace("/bazaar_hardening_ci", "/another_database"), url.replace("synthetic_user:", "other_user:"),
  ])("refuses a mismatched host, port, database or role", (connection) => {
    expect(() => parsePreflightTarget(args, { EXPLICIT_AUDIT_URL: connection })).toThrow("PREFLIGHT_TARGET_FINGERPRINT_MISMATCH");
  });

  it("does not allow libpq connection redirection through database names or URL options", () => {
    const injected = url.replace("/bazaar_hardening_ci", `/${encodeURIComponent("host=other.example dbname=private")}`);
    const injectionArgs = args.map((arg) => arg === "bazaar_hardening_ci" ? "host=other.example dbname=private" : arg);
    expect(() => parsePreflightTarget(injectionArgs, { EXPLICIT_AUDIT_URL: injected })).toThrow("PREFLIGHT_TARGET_FINGERPRINT_MISMATCH");
    expect(() => parsePreflightTarget(args, { EXPLICIT_AUDIT_URL: `${url}&options=-c%20search_path=private` })).toThrow("PREFLIGHT_TARGET_OPTIONS_UNSUPPORTED");
    expect(() => parsePreflightTarget(args, { EXPLICIT_AUDIT_URL: url.replace("schema=public", "schema=private") })).toThrow("PREFLIGHT_PUBLIC_SCHEMA_REQUIRED");
  });

  it("requires explicitly configured TLS for a nonlocal target", () => {
    const remoteArgs = args.map((arg) => arg === "127.0.0.1" ? "isolated.example" : arg);
    const remote = url.replace("127.0.0.1", "isolated.example");
    expect(() => parsePreflightTarget(remoteArgs, { EXPLICIT_AUDIT_URL: remote })).toThrow("PREFLIGHT_EXPLICIT_TLS_REQUIRED");
    expect(() => parsePreflightTarget(remoteArgs, { EXPLICIT_AUDIT_URL: `${remote}&sslmode=disable` })).toThrow("PREFLIGHT_EXPLICIT_TLS_REQUIRED");
    expect(parsePreflightTarget(remoteArgs, { EXPLICIT_AUDIT_URL: `${remote}&sslmode=verify-full` }).target.sslmode).toBe("verify-full");
  });

  it("decodes credentials once and strips inherited connections, startup options and provider secrets", () => {
    const parsed = options();
    const env = preflightProcessEnvironment(parsed.target, { PATH: "/synthetic/bin", PGHOST: "other.example", PGDATABASE: "private",
      PGOPTIONS: "-c default_transaction_read_only=off", PGSERVICE: "production", PGPASSFILE: "/private/passwords",
      DATABASE_URL: "private", APPLE_IAP_PRIVATE_KEY: "private", GOPAY_API_SECRET: "private" });
    expect(env.PGPASSWORD).toBe("synthetic@password");
    expect(env).toMatchObject({ PGHOST: "127.0.0.1", PGDATABASE: "bazaar_hardening_ci", PGPASSFILE: "/dev/null", PATH: "/synthetic/bin" });
    expect(Object.keys(env)).not.toEqual(expect.arrayContaining(["PGOPTIONS", "PGSERVICE", "DATABASE_URL", "APPLE_IAP_PRIVATE_KEY", "GOPAY_API_SECRET"]));
    for (const key of ["PGOPTIONS", "PGSERVICE", "DATABASE_URL", "APPLE_IAP_PRIVATE_KEY", "GOPAY_API_SECRET"]) expect(env).not.toHaveProperty(key);
  });

  it("checks the exact reviewed pair and invokes psql without a startup file or interactive password prompt", async () => {
    await expect(assertReviewedPreflightMigrations()).resolves.toBeUndefined();
    const execute = vi.fn().mockResolvedValue(report());
    expect((await runIosBillingPreflight(options(), {}, execute)).ok).toBe(true);
    expect(execute).toHaveBeenCalledWith("psql", ["-X", "--no-password", "--quiet", "--tuples-only", "--no-align",
      "--set", "ON_ERROR_STOP=1", "--file", IOS_PREFLIGHT_SQL], expect.objectContaining({ PGDATABASE: "bazaar_hardening_ci" }));
  });

  it("redacts process and parser failures instead of printing connection strings or historical values", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("postgresql://private:secret@foreign/private row=person@example.com"));
    await expect(runIosBillingPreflight(options(), {}, execute)).rejects.toThrow(/^PREFLIGHT_READONLY_AUDIT_FAILED$/);
    expect(() => parsePreflightTarget(args, { EXPLICIT_AUDIT_URL: "private:secret is not a URL" })).toThrow(/^PREFLIGHT_TARGET_INVALID$/);
    expect(() => parsePreflightReport("ERROR: person@example.com")).toThrow(/^PREFLIGHT_REPORT_INVALID$/);
  });

  it("counts blockers separately from known historical warnings and checks the expected migration stage", () => {
    const parsed = parsePreflightReport(report({ checks: [
      { name: "legacy_invoices_without_snapshot", severity: "warning", count: 4, skipped: false },
      { name: "source_binding_invalid", severity: "blocker", count: 0, skipped: false },
      { name: "post_privacy_binding", severity: "blocker", count: null, skipped: true },
    ] }), "PRE_APPLE");
    expect(parsed).toMatchObject({ ok: false, blockerChecks: 1, warningChecks: 1, skippedChecks: 1 });
    expect(parsed.checks.at(-1)?.name).toBe("expected_schema_stage_mismatch");
    expect(parsePreflightReport(report({ checks: [{ name: "query_failed", severity: "blocker", count: null, skipped: false, errorCode: "22003" }] })).ok).toBe(false);
  });

  it("recognizes the named temporary-upgrade stage while retaining older staged audits", () => {
    const parsed = parsePreflightTarget([...args, "--expect-stage", "POST_TEMPORARY_UPGRADES"], { EXPLICIT_AUDIT_URL: url });
    expect(parsed.expectedStage).toBe("POST_TEMPORARY_UPGRADES");
    expect(parsePreflightReport(report({ schemaStage: "POST_TEMPORARY_UPGRADES" }), parsed.expectedStage)).toMatchObject({ ok: true, schemaStage: "POST_TEMPORARY_UPGRADES" });
    expect(parsePreflightReport(report(), "POST_NATIVE_ATTEMPT").ok).toBe(true);
    expect(parsePreflightReport(report(), parsed.expectedStage).ok).toBe(false);
  });

  it("recognizes the deferred capability stage while keeping every earlier reviewed stage distinct", () => {
    const parsed = parsePreflightTarget([...args, "--expect-stage", "POST_DEFERRED_OUTCOMES"], { EXPLICIT_AUDIT_URL: url });
    expect(parsed.expectedStage).toBe("POST_DEFERRED_OUTCOMES");
    expect(parsePreflightReport(report({ schemaStage: "POST_DEFERRED_OUTCOMES" }), parsed.expectedStage))
      .toMatchObject({ ok: true, schemaStage: "POST_DEFERRED_OUTCOMES" });
    for (const schemaStage of ["PRE_APPLE", "POST_PRIVACY", "POST_LIFECYCLE", "POST_NATIVE_ATTEMPT", "POST_TEMPORARY_UPGRADES"]) {
      expect(parsePreflightReport(report({ schemaStage }), schemaStage).ok).toBe(true);
      expect(parsePreflightReport(report({ schemaStage }), parsed.expectedStage).ok).toBe(false);
    }
    expect(() => parsePreflightTarget([...args, "--expect-stage", "POST_UNKNOWN"], { EXPLICIT_AUDIT_URL: url }))
      .toThrow("PREFLIGHT_STAGE_INVALID");
  });

  it("requires the separate UTC correction stage when requested and still recognizes exact migration144 history", () => {
    const parsed = parsePreflightTarget([...args, "--expect-stage", "POST_COMPLETION_UTC"], { EXPLICIT_AUDIT_URL: url });
    expect(parsed.expectedStage).toBe("POST_COMPLETION_UTC");
    expect(parsePreflightReport(report({ schemaStage: "POST_COMPLETION_UTC" }), parsed.expectedStage))
      .toMatchObject({ ok: true, schemaStage: "POST_COMPLETION_UTC" });
    expect(parsePreflightReport(report({ schemaStage: "POST_DEFERRED_OUTCOMES" }), parsed.expectedStage).ok).toBe(false);
    expect(parsePreflightReport(report({ schemaStage: "POST_DEFERRED_OUTCOMES" }), "POST_DEFERRED_OUTCOMES").ok).toBe(true);
    expect(parsePreflightReport(report({ schemaStage: "POST_COMPLETION_UTC" }), "POST_DEFERRED_OUTCOMES").ok).toBe(false);
  });

  it("never forwards native completion keys, challenges, signatures or signed Apple evidence", () => {
    const privateProof = { completionPublicKey: "synthetic-private-public-key", challenge: "synthetic-secret-challenge",
      signature: "synthetic-device-signature", signedTransactionInfo: "synthetic-apple-jws", signedRenewalInfo: "synthetic-renewal-jws" };
    const parsed = parsePreflightReport(report({ schemaStage: "POST_DEFERRED_OUTCOMES", ...privateProof, checks: [{
      name: "native_completion_immutable_binding_invalid", severity: "blocker", count: 1, skipped: false, ...privateProof,
    }] }));
    expect(parsed).toMatchObject({ ok: false, blockerChecks: 1, skippedChecks: 0 });
    for (const value of Object.values(privateProof)) expect(JSON.stringify(parsed)).not.toContain(value);
  });
  it("accepts only the explicitly requested consumption stage and preserves the reviewed145 boundary", () => {
    const parsed = parsePreflightTarget([...args, "--expect-stage", "POST_CONSUMPTION"], { EXPLICIT_AUDIT_URL: url });
    expect(parsePreflightReport(report({ schemaStage: "POST_CONSUMPTION" }), parsed.expectedStage)).toMatchObject({ ok: true, schemaStage: "POST_CONSUMPTION" });
    expect(parsePreflightReport(report({ schemaStage: "POST_COMPLETION_UTC" }), parsed.expectedStage).ok).toBe(false);
    expect(parsePreflightReport(report({ schemaStage: "POST_COMPLETION_UTC" }), "POST_COMPLETION_UTC").ok).toBe(true);
  });

  it("recognizes minimum-charge guards separately without weakening the146 boundary", () => {
    const parsed = parsePreflightTarget([...args, "--expect-stage", "POST_TEMPORARY_MINIMUM"], { EXPLICIT_AUDIT_URL: url });
    expect(parsePreflightReport(report({ schemaStage: "POST_TEMPORARY_MINIMUM" }), parsed.expectedStage).ok).toBe(true);
    expect(parsePreflightReport(report({ schemaStage: "POST_CONSUMPTION" }), parsed.expectedStage).ok).toBe(false);
    expect(parsePreflightReport(report({ schemaStage: "POST_CONSUMPTION" }), "POST_CONSUMPTION").ok).toBe(true);
    expect(parsePreflightReport(report({ schemaStage: "POST_TEMPORARY_MINIMUM" }), "POST_CONSUMPTION").ok).toBe(false);
  });

  it("emits only approved report fields and rejects malformed counts or row-shaped output", () => {
    const parsed = parsePreflightReport(report({ extraCustomerData: "person@example.com", checks: [
      { name: "source_binding_invalid", severity: "blocker", count: 0, skipped: false, customerEmail: "person@example.com" },
    ] }));
    expect(JSON.stringify(parsed)).not.toContain("person@example.com");
    for (const count of [-1, 1.2, "1", Number.MAX_SAFE_INTEGER + 1]) expect(() => parsePreflightReport(report({ checks: [
      { name: "source_binding_invalid", severity: "blocker", count, skipped: false },
    ] }))).toThrow("PREFLIGHT_REPORT_INVALID");
    expect(() => parsePreflightReport(report({ transactionReadOnly: false }))).toThrow("PREFLIGHT_REPORT_INVALID");
    expect(() => parsePreflightReport(report({ checks: [{ name: "person@example.com", severity: "info", count: 1, skipped: false }] }))).toThrow("PREFLIGHT_REPORT_INVALID");
  });
});
