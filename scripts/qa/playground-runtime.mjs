// Build/serve the actual production bundle against explicitly isolated local
// services. Never use the developer's default database or provider credentials.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { cp, rm } from "node:fs/promises";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const mode = process.argv[2];
assert(["build", "serve"].includes(mode), "Use build or serve");
const databaseUrl = process.env.PLAYGROUND_DATABASE_URL;
const redisUrl = process.env.PLAYGROUND_REDIS_URL;
assert(
  databaseUrl && redisUrl,
  "Explicit PLAYGROUND_DATABASE_URL and PLAYGROUND_REDIS_URL are required",
);
const database = new URL(databaseUrl);
const redis = new URL(redisUrl);
assert(["postgresql:", "postgres:"].includes(database.protocol));
assert(["127.0.0.1", "localhost"].includes(database.hostname));
assert.equal(database.pathname, "/bazaar_hardening_agent4_platform");
assert.equal(database.username, "bazaar_test");
assert.equal(redis.protocol, "redis:");
assert(["127.0.0.1", "localhost"].includes(redis.hostname));
assert.equal(redis.pathname, "/1", "Use a separate Redis DB from the test suite");

const nextEnv = createRequire(require.resolve("next/package.json"))("@next/env");
nextEnv.loadEnvConfig(process.cwd(), false);
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (
    /^(?:FREEDOMPAY_|BILLING_|RESEND_|OPENAI_|DEEPSEEK_|AI_PROVIDER|BAAM_|R2_|STRIPE_|SMTP_|BAKAI_|M_MARKET_|MMARKET_|O_MARKET_|FCM_|APNS_|QZ_)/.test(
      key,
    )
  )
    env[key] = "";
}
Object.assign(env, {
  NODE_ENV: "production",
  VERCEL: "0",
  VERCEL_ENV: "preview",
  DATABASE_URL: databaseUrl,
  DATABASE_TEST_URL: databaseUrl,
  ALLOW_LOCALHOST_DATABASE_IN_PRODUCTION: "1",
  REDIS_URL: redisUrl,
  REDIS_KEY_PREFIX: "playground-pricing-qa",
  NEXTAUTH_SECRET: "playground-local-test-only",
  NEXTAUTH_URL: "http://localhost:3120",
  JOBS_SECRET: "playground-local-jobs-only",
  CRON_SECRET: "playground-local-cron-only",
  EMAIL_PROVIDER: "log",
  EMAIL_FROM: "test@example.invalid",
  ALLOW_LOG_EMAIL_IN_PRODUCTION: "1",
  IMAGE_STORAGE_PROVIDER: "local",
  EXPORT_STORAGE_PROVIDER: "local",
  HARDENING_PREVIEW_GUARD: "1",
  HARDENING_EXTERNAL_PROVIDER_MODE: "disabled",
  HARDENING_PREVIEW_EXPECTED_DATABASE_NAME: database.pathname.slice(1),
  HARDENING_PREVIEW_EXPECTED_DATABASE_HOST: database.hostname,
  RUN_DB_TESTS: "0",
  ALLOW_TEST_DB_RESET: "0",
  SIGNUP_MODE: "open",
  SKIP_EMAIL_VERIFICATION: "0",
  PLATFORM_OWNER_EMAILS: "payments-owner@example.invalid",
  O_MARKET_MOCK_API: "1",
  MOBILE_PUSH_MODE: "disabled",
});
nextEnv.updateInitialEnv(env);
if (mode === "build") {
  // Next can retain files from an earlier standalone trace. Rebuild the package
  // from current traces so ignored QA snapshots never survive as stale output.
  await rm(".next/standalone", { recursive: true, force: true });
}
if (mode === "serve") {
  await cp("public", ".next/standalone/public", { recursive: true });
  await cp(".next/static", ".next/standalone/.next/static", { recursive: true });
  env.HOSTNAME = "127.0.0.1";
  env.PORT = "3120";
}
const command = mode === "build" ? "pnpm" : process.execPath;
const args = mode === "build" ? ["build"] : [resolve(".next/standalone/server.js")];
const child = spawn(command, args, { env, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
