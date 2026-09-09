export const stockAuditDatabaseUrl =
  "postgresql://bazaar_test:bazaar_test_only@127.0.0.1:55439/bazaar_hardening_agent2_inventory";
export const stockAuditRedisUrl = "redis://127.0.0.1:56389/0";

// Fixed disposable identity. Never inherit a developer's DATABASE_URL or provider keys.
export function stockAuditEnvironment(
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
    DATABASE_URL: stockAuditDatabaseUrl,
    DATABASE_TEST_URL: stockAuditDatabaseUrl,
    EXPECTED_TEST_DB_NAME: "bazaar_hardening_agent2_inventory",
    REDIS_URL: stockAuditRedisUrl,
    REDIS_KEY_PREFIX: "bazaar-stock-audit",
    RUN_DB_TESTS: "1",
    ALLOW_TEST_DB_RESET: "0",
    NEXTAUTH_SECRET: "isolated-stabilization-local-only-secret",
    NEXTAUTH_URL: "http://localhost:3119",
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

export function assertStockAuditDatabase(env: Record<string, string | undefined> = process.env) {
  if (
    env.DATABASE_URL !== stockAuditDatabaseUrl ||
    env.DATABASE_TEST_URL !== stockAuditDatabaseUrl ||
    env.REDIS_URL !== stockAuditRedisUrl ||
    env.RUN_DB_TESTS !== "1" ||
    env.ALLOW_TEST_DB_RESET !== "0" ||
    env.VERCEL_ENV === "production"
  ) {
    throw new Error("Stock audit requires its dedicated local database/Redis and forbids resets.");
  }
}
