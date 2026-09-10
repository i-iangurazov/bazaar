import { baamTestEnvironment } from "../baam/environment";

export const uxDatabaseUrl =
  "postgresql://bazaar_test:bazaar_test_only@127.0.0.1:55440/bazaar_hardening_ux";
export function uxEnvironment() {
  return {
    ...baamTestEnvironment(),
    DATABASE_URL: uxDatabaseUrl,
    DATABASE_TEST_URL: uxDatabaseUrl,
    EXPECTED_TEST_DB_NAME: "bazaar_hardening_ux",
    NEXTAUTH_URL: "http://localhost:3122",
    REDIS_URL: "redis://127.0.0.1:56390/2",
    REDIS_KEY_PREFIX: "ux-isolated-test",
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
