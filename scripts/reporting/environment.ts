import { baamTestEnvironment } from "../baam/environment";
export const reportingDatabaseUrl =
  "postgresql://bazaar_test:bazaar_test_only@127.0.0.1:55440/bazaar_hardening_reporting";
export function reportingEnvironment() {
  return {
    ...baamTestEnvironment(),
    DATABASE_URL: reportingDatabaseUrl,
    DATABASE_TEST_URL: reportingDatabaseUrl,
    EXPECTED_TEST_DB_NAME: "bazaar_hardening_reporting",
    NEXTAUTH_URL: "https://localhost:3123",
    REDIS_URL: "redis://127.0.0.1:56390/4",
    REDIS_KEY_PREFIX: "reporting-isolated-test",
  };
}
export function assertReportingDatabase() {
  if (
    process.env.DATABASE_URL !== reportingDatabaseUrl ||
    process.env.DATABASE_TEST_URL !== reportingDatabaseUrl ||
    process.env.VERCEL_ENV === "production"
  )
    throw new Error("Reporting fixtures require the dedicated local database");
}
