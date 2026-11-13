/** Synthetic configuration only. No dotenv, credentials or provider calls. */
export function hardeningPreviewEnv(databaseUrl: string): Record<string, string> {
  const database = new URL(databaseUrl);
  return {
    NODE_ENV: "production", NEXT_PHASE: "", npm_lifecycle_event: "", VERCEL_ENV: "preview", VERCEL_PROJECT_ID: "prj_SyntheticSignupPreview",
    DATABASE_URL: databaseUrl, ALLOW_LOCALHOST_DATABASE_IN_PRODUCTION: "true",
    NEXTAUTH_SECRET: "synthetic-preview-auth-secret-only", NEXTAUTH_URL: "https://signup-preview.example.invalid",
    JOBS_SECRET: "synthetic-preview-jobs-secret-only", CRON_SECRET: "synthetic-preview-cron-secret-only",
    REDIS_URL: "redis://127.0.0.1:56361/0", REDIS_KEY_PREFIX: "synthetic-signup-preview:",
    HARDENING_PREVIEW_GUARD: "1", HARDENING_EXTERNAL_PROVIDER_MODE: "disabled",
    HARDENING_PREVIEW_EXPECTED_DATABASE_HOST: database.hostname, HARDENING_PREVIEW_EXPECTED_DATABASE_NAME: decodeURIComponent(database.pathname.slice(1)),
    HARDENING_PREVIEW_EXPECTED_PROJECT_ID: "prj_SyntheticSignupPreview", HARDENING_PREVIEW_EXPECTED_IMAGE_STORE_ID: "store_SyntheticImages",
    HARDENING_PREVIEW_EXPECTED_EXPORT_STORE_ID: "store_SyntheticExports", BLOB_IMAGE_STORE_ID: "store_SyntheticImages", BLOB_EXPORT_STORE_ID: "store_SyntheticExports",
    IMAGE_STORAGE_PROVIDER: "vercel-blob", EXPORT_STORAGE_PROVIDER: "vercel-blob", EMAIL_PROVIDER: "log", ALLOW_LOG_EMAIL_IN_PRODUCTION: "1",
    OPENAI_API_KEY: "", DEEPSEEK_API_KEY: "", RESEND_API_KEY: "", R2_ACCOUNT_ID: "", R2_ACCESS_KEY_ID: "", R2_SECRET_ACCESS_KEY: "",
    R2_BUCKET_NAME: "", R2_PUBLIC_BASE_URL: "", R2_ENDPOINT: "", O_MARKET_MOCK_API: "1", RUN_DB_TESTS: "0", ALLOW_TEST_DB_RESET: "0",
    SIGNUP_MODE: "open", BILLING_SELF_SERVE_SIGNUP: "1", SKIP_EMAIL_VERIFICATION: "1", AUTH_TRUSTED_PROXY_HOPS: "0",
  };
}
