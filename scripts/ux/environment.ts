import { baamTestEnvironment } from "../baam/environment";

// Espresso has a separate, explicitly named fixture database; never reuse customer data.
const espressoSuite = process.env.UX_SUITE === "espresso";
const databaseName = espressoSuite ? "bazaar_espresso_ui" : "bazaar_hardening_ux";
export const uxDatabaseUrl =
  `postgresql://bazaar_test:bazaar_test_only@127.0.0.1:55440/${databaseName}`;
export function uxEnvironment() {
  return {
    ...baamTestEnvironment(),
    ...(espressoSuite ? { PLATFORM_OWNER_EMAILS: "platform@espresso.example.invalid" } : {}),
    DATABASE_URL: uxDatabaseUrl,
    DATABASE_TEST_URL: uxDatabaseUrl,
    EXPECTED_TEST_DB_NAME: databaseName,
    NEXTAUTH_URL: "http://localhost:3122",
    REDIS_URL: espressoSuite ? "redis://127.0.0.1:56390/4" : "redis://127.0.0.1:56390/2",
    REDIS_KEY_PREFIX: espressoSuite ? "espresso-ui-test" : "ux-isolated-test",
    BILLING_PAYMENTS_MODE: "disabled",
    FREEDOMPAY_MERCHANT_ID: "",
    FREEDOMPAY_SECRET_KEY: "",
  };
}
export function assertUxDatabase() {
  if (
    process.env.DATABASE_URL !== uxDatabaseUrl ||
    process.env.DATABASE_TEST_URL !== uxDatabaseUrl ||
    process.env.VERCEL_ENV === "production"
  )
    throw new Error("UI/UX checks require their dedicated local database");
}
