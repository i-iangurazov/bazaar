export const stabilizationDatabaseUrl =
  "postgresql://bazaar_test:bazaar_test_only@127.0.0.1:55432/bazaar_hardening_ci";
export const stabilizationRedisUrl = "redis://127.0.0.1:56379/0";

// Fixed disposable identity. Never inherit a developer's DATABASE_URL or provider keys.
export function stabilizationEnvironment(
  source: Record<string, string | undefined> = process.env,
): Record<string, string> & NodeJS.ProcessEnv {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) env[key] = value;
  }
  for (const key of Object.keys(env)) {
    if (/^(?:RESEND_|OPENAI_|R2_|STRIPE_|SMTP_|BAKAI_|M_MARKET_|O_MARKET_)/.test(key)) {
      env[key] = "";
    }
  }
  return {
    ...env,
    NODE_ENV: "test",
    VERCEL_ENV: "development",
    DATABASE_URL: stabilizationDatabaseUrl,
    DATABASE_TEST_URL: stabilizationDatabaseUrl,
    EXPECTED_TEST_DB_NAME: "bazaar_hardening_ci",
    REDIS_URL: stabilizationRedisUrl,
    REDIS_KEY_PREFIX: "bazaar-stabilization",
    RUN_DB_TESTS: "1",
    ALLOW_TEST_DB_RESET: "0",
    NEXTAUTH_SECRET: "isolated-stabilization-local-only-secret",
    NEXTAUTH_URL: "http://localhost:3108",
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

export function assertStabilizationDatabase(
  env: Record<string, string | undefined> = process.env,
) {
  if (
    env.DATABASE_URL !== stabilizationDatabaseUrl ||
    env.DATABASE_TEST_URL !== stabilizationDatabaseUrl ||
    env.REDIS_URL !== stabilizationRedisUrl ||
    env.RUN_DB_TESTS !== "1" ||
    env.ALLOW_TEST_DB_RESET !== "0" ||
    env.VERCEL_ENV === "production"
  ) {
    throw new Error("Stabilization requires its dedicated local database/Redis and forbids resets.");
  }
}
