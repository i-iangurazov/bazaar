// Read-only legal-page QA. No database services or API/payment credentials are
// inherited. Explicit local dev preview receives only verified seller fields.
// Never use this launcher for real application use.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const mode = process.argv[2];
if (!["build", "start", "dev", "dev-disabled"].includes(mode)) {
  throw new Error("Expected build, start, dev or dev-disabled");
}
const development = mode.startsWith("dev");
const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  TMPDIR: process.env.TMPDIR,
  LANG: "en_US.UTF-8",
  NODE_ENV: development ? "development" : "production",
  NODE_OPTIONS: "--max-old-space-size=4096",
  // Supported by the installed @next/env: prevent loading .env.local secrets.
  __NEXT_PROCESSED_ENV: "true",
  NEXT_TELEMETRY_DISABLED: "1",
  DATABASE_URL: "postgresql://legal_preview@127.0.0.1:9/bazaar_hardening_ci",
  DIRECT_URL: "postgresql://legal_preview@127.0.0.1:9/bazaar_hardening_ci",
  ALLOW_LOCALHOST_DATABASE_IN_PRODUCTION: "1",
  REDIS_URL: "",
  NEXTAUTH_URL: "http://localhost:3134",
  NEXTAUTH_SECRET: "legal-draft-isolated-local-preview-secret",
  CRON_SECRET: "legal-draft-isolated-no-cron-secret",
  JOBS_SECRET: "legal-draft-isolated-no-jobs-secret",
  HARDENING_EXTERNAL_PROVIDER_MODE: "disabled",
  BILLING_PAYMENTS_MODE: "disabled",
  EMAIL_PROVIDER: "log",
  ALLOW_LOG_EMAIL_IN_PRODUCTION: "1",
  SIGNUP_MODE: "invite_only",
  BAZAAR_LEGAL_PREVIEW: mode === "dev-disabled" ? "0" : "1",
};
if (mode === "dev" && fs.existsSync(".env.local")) {
  const allowed = new Set([
    "BILLING_SELLER_LEGAL_NAME",
    "BILLING_SELLER_ENTREPRENEUR_NAME",
    "BILLING_SELLER_TAX_ID",
    "BILLING_SELLER_REGISTRATION_NUMBER",
    "BILLING_SELLER_REGISTRATION_DATE",
    "BILLING_SELLER_REGISTRATION_AUTHORITY",
    "BILLING_SELLER_PHONE",
    "BILLING_SELLER_EMAIL",
    "BILLING_SELLER_BANK_NAME",
    "BILLING_SELLER_BENEFICIARY",
    "BILLING_SELLER_ACCOUNT_NUMBER",
    "BILLING_SELLER_ACCOUNT_CURRENCY",
    "BILLING_SELLER_BANK_CODE",
  ]);
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = /^(BILLING_SELLER_[A-Z_]+)=(.*)$/.exec(line.trim());
    if (!match || !allowed.has(match[1])) continue;
    const raw = match[2].trim();
    env[match[1]] = raw.startsWith('"') ? JSON.parse(raw) : raw.replace(/^'|'$/g, "");
  }
}
const args =
  mode === "build"
    ? ["build"]
    : [development ? "dev" : "start", "--hostname", "127.0.0.1", "--port", "3134"];
const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), ...args], {
  env,
  stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 1));
