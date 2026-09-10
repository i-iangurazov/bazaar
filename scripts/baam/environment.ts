export const baamTestDatabaseUrl =
  "postgresql://bazaar_test:bazaar_test_only@127.0.0.1:55440/bazaar_hardening_baam";
export const baamTestRedisUrl = "redis://127.0.0.1:56390/0";

export function baamTestEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...source };
  for (const key of Object.keys(env)) {
    if (/^(?:RESEND_|OPENAI_|R2_|STRIPE_|SMTP_|BAKAI_|M_MARKET_|O_MARKET_)/.test(key))
      env[key] = "";
  }
  return {
    ...env,
    NODE_ENV: "test",
    VERCEL_ENV: "development",
    VERCEL: "0",
    DATABASE_URL: baamTestDatabaseUrl,
    DATABASE_TEST_URL: baamTestDatabaseUrl,
    EXPECTED_TEST_DB_NAME: "bazaar_hardening_baam",
    RUN_DB_TESTS: "1",
    ALLOW_TEST_DB_RESET: "0",
    REDIS_URL: baamTestRedisUrl,
    REDIS_KEY_PREFIX: "baam-companion-test",
    JOBS_SECRET: "baam-isolated-test-jobs",
    CRON_SECRET: "baam-isolated-test-cron-secret",
    NEXTAUTH_SECRET: "baam-isolated-development-only-secret",
    NEXTAUTH_URL: "http://localhost:3121",
    EMAIL_PROVIDER: "log",
    EMAIL_FROM: "Bazaar Test <test@example.invalid>",
    IMAGE_STORAGE_PROVIDER: "local",
    EXPORT_STORAGE_PROVIDER: "local",
    HARDENING_PREVIEW_GUARD: "0",
    HARDENING_EXTERNAL_PROVIDER_MODE: "disabled",
    O_MARKET_MOCK_API: "1",
    SIGNUP_MODE: "open",
    SKIP_EMAIL_VERIFICATION: "0",
  };
}

export function assertBaamTestDatabase() {
  if (
    process.env.DATABASE_URL !== baamTestDatabaseUrl ||
    process.env.DATABASE_TEST_URL !== baamTestDatabaseUrl ||
    process.env.VERCEL_ENV === "production"
  ) {
    throw new Error("BAAM tests require their dedicated disposable local database");
  }
}
