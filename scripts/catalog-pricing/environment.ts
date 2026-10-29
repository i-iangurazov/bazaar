import { stabilizationEnvironment } from "../stabilization/environment";
export const catalogQaDatabaseUrl =
  "postgresql://bazaar_test:bazaar_test_only@127.0.0.1:55448/bazaar_hardening_agent4_platform";
export function catalogQaEnvironment() {
  return {
    ...stabilizationEnvironment(),
    DATABASE_URL: catalogQaDatabaseUrl,
    DATABASE_TEST_URL: catalogQaDatabaseUrl,
    DIRECT_URL: catalogQaDatabaseUrl,
    DATABASE_URL_UNPOOLED: catalogQaDatabaseUrl,
    POSTGRES_URL_NON_POOLING: catalogQaDatabaseUrl,
    EXPECTED_TEST_DB_NAME: "bazaar_hardening_agent4_platform",
    REDIS_URL: "redis://127.0.0.1:56398/4",
    REDIS_KEY_PREFIX: "catalog-pricing-ui-20261029",
    RUN_DB_TESTS: "0",
    ALLOW_TEST_DB_RESET: "0",
    NEXTAUTH_URL: "http://localhost:3124",
    NEXTAUTH_SECRET: "catalog-pricing-isolated-only",
    JOBS_SECRET: "catalog-pricing-isolated-jobs-only",
    CRON_SECRET: "catalog-pricing-isolated-cron-only",
    ALLOW_LOCALHOST_DATABASE_IN_PRODUCTION: "true",
    ALLOW_LOG_EMAIL_IN_PRODUCTION: "true",
    BILLING_PAYMENTS_MODE: "disabled",
    FREEDOMPAY_MERCHANT_ID: "",
    FREEDOMPAY_SECRET_KEY: "",
    VERCEL: "0",
    NEXT_TELEMETRY_DISABLED: "1",
    NODE_OPTIONS: "--max-old-space-size=4096",
  };
}
