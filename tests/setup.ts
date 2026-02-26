const shouldRunDbTests =
  process.env.SKIP_DB_TESTS !== "1" &&
  (process.env.CI === "true" || process.env.CI === "1" || process.env.RUN_DB_TESTS === "1");

if (process.env.DATABASE_TEST_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_TEST_URL;
}

if (shouldRunDbTests) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL must be set when running database tests.");
  }
  let databaseName = "";
  try {
    databaseName = new URL(databaseUrl).pathname.replace("/", "");
  } catch (error) {
    throw new Error("DATABASE_URL must be a valid URL when running database tests.");
  }
  if (!databaseName.toLowerCase().includes("test")) {
    throw new Error("DATABASE_URL must target a test database (name should include 'test').");
  }
}

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET ?? "test-secret";
