import assert from "node:assert/strict";
import { resolve } from "node:path";

export const subscriptionRollbackPorts = { postgres: 55981, redis: 55982 } as const;
export function subscriptionRehearsalEnvironment(
  databaseName: string,
  source: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  assert(
    /^bazaar_hardening_subscription_rollback_\d{13}(?:_restore)?$/.test(databaseName),
    "Invalid disposable database identity",
  );
  const env: Record<string, string | undefined> = {};
  // No database URL, provider key, Vercel flag or developer .env is inherited.
  for (const key of ["PATH", "HOME", "TMPDIR", "TEMP", "SystemRoot", "LANG", "LC_ALL"])
    if (source[key]) env[key] = source[key];
  const url = `postgresql://bazaar_test@127.0.0.1:${subscriptionRollbackPorts.postgres}/${databaseName}`;
  return {
    ...env,
    NODE_ENV: "test",
    VERCEL: "0",
    VERCEL_ENV: "development",
    DATABASE_URL: url,
    DATABASE_TEST_URL: url,
    DATABASE_URL_UNPOOLED: url,
    POSTGRES_URL_NON_POOLING: url,
    REDIS_URL: `redis://127.0.0.1:${subscriptionRollbackPorts.redis}/0`,
    REDIS_KEY_PREFIX: `${databaseName}:`,
    NEXTAUTH_SECRET: "subscription-rollback-synthetic-local-secret",
    NEXTAUTH_URL: "http://localhost:3161",
    JOBS_SECRET: "subscription-rollback-test-jobs",
    CRON_SECRET: "subscription-rollback-test-cron-secret",
    RUN_DB_TESTS: "0",
    ALLOW_TEST_DB_RESET: "0",
    BAZAAR_SUBSCRIPTION_REHEARSAL: "1",
    BILLING_PAYMENTS_MODE: "disabled",
    BILLING_SELF_SERVE_SIGNUP: "0",
    BILLING_LEGAL_RELEASE_APPROVED: "",
    BILLING_PAYMENT_PROVIDER: "freedompay",
    GOPAY_API_KEY: "",
    GOPAY_API_SECRET: "",
    GOPAY_WEBHOOK_SECRET: "",
    GOPAY_PREVIOUS_API_KEY: "",
    GOPAY_PREVIOUS_API_SECRET: "",
    FREEDOMPAY_MERCHANT_ID: "",
    FREEDOMPAY_SECRET_KEY: "",
    BILLING_PUBLIC_CONTACT_ADDRESS: "",
    HARDENING_EXTERNAL_PROVIDER_MODE: "disabled",
    EMAIL_PROVIDER: "log",
    ALLOW_LOG_EMAIL_IN_PRODUCTION: "true",
    IMAGE_STORAGE_PROVIDER: "local",
    EXPORT_STORAGE_PROVIDER: "local",
    O_MARKET_MOCK_API: "1",
    NEXT_TELEMETRY_DISABLED: "1",
    ALLOW_LOCALHOST_DATABASE_IN_PRODUCTION: "true",
    UV_THREADPOOL_SIZE: "2",
    RAYON_NUM_THREADS: "2",
    OMP_NUM_THREADS: "2",
    NODE_OPTIONS: `--max-old-space-size=2048 --require ${resolve("scripts/qa/low-resource.cjs")}`,
  };
}

export function assertSubscriptionRehearsalEnvironment(
  env: Record<string, string | undefined> = process.env,
) {
  assert.equal(
    env.BAZAAR_SUBSCRIPTION_REHEARSAL,
    "1",
    "Only the disposable coordinator may run probes",
  );
  const name = new URL(env.DATABASE_URL ?? "").pathname.slice(1);
  const expected = subscriptionRehearsalEnvironment(name, {});
  for (const key of [
    "DATABASE_URL",
    "DATABASE_TEST_URL",
    "DATABASE_URL_UNPOOLED",
    "POSTGRES_URL_NON_POOLING",
    "REDIS_URL",
    "VERCEL",
    "VERCEL_ENV",
    "BILLING_PAYMENTS_MODE",
    "RUN_DB_TESTS",
    "ALLOW_TEST_DB_RESET",
  ])
    assert.equal(env[key], expected[key], `Unsafe rehearsal setting: ${key}`);
  return { databaseName: name, databaseUrl: expected.DATABASE_URL };
}
