import { execSync } from "node:child_process";
import { PrismaClient, Prisma } from "@prisma/client";

const shouldRunDbTests = () =>
  process.env.SKIP_DB_TESTS !== "1" &&
  (process.env.CI === "true" || process.env.CI === "1" || process.env.RUN_DB_TESTS === "1");

const isStrictCiEnvironment = () =>
  (process.env.CI === "true" || process.env.CI === "1") && process.env.GITHUB_ACTIONS === "true";

const isDatabaseUnreachableError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Can't reach database server") ||
    message.includes("ECONNREFUSED") ||
    message.includes("ENOTFOUND")
  );
};

const parseTestDatabaseName = (databaseUrl: string) => {
  let databaseName = "";
  try {
    databaseName = new URL(databaseUrl).pathname.replace("/", "");
  } catch (error) {
    throw new Error("DATABASE_URL must be a valid URL when running database tests.");
  }
  if (!databaseName.toLowerCase().includes("test")) {
    throw new Error("DATABASE_URL must target a test database (name should include 'test').");
  }
  if (!/^[A-Za-z0-9_]+$/.test(databaseName)) {
    throw new Error("DATABASE_URL test database name contains unsupported characters.");
  }
  return databaseName;
};

const resolveDatabaseUrlForTests = () => {
  if (process.env.DATABASE_TEST_URL) {
    return process.env.DATABASE_TEST_URL;
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL must be set when running database tests.");
  }
  const url = new URL(databaseUrl);
  const databaseName = url.pathname.replace("/", "");
  if (!databaseName) {
    throw new Error("DATABASE_URL must include a database name.");
  }
  if (databaseName.toLowerCase().includes("test")) {
    return databaseUrl;
  }
  if (!/^[A-Za-z0-9_]+$/.test(databaseName)) {
    throw new Error("DATABASE_URL database name contains unsupported characters.");
  }
  url.pathname = `/${databaseName}_test`;
  return url.toString();
};

const ensureTestDatabase = async (databaseUrl: string, databaseName: string) => {
  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = "/postgres";
  adminUrl.searchParams.delete("schema");

  const adminClient = new PrismaClient({ datasourceUrl: adminUrl.toString() });
  const existing = await adminClient.$queryRaw<{ datname: string }[]>(
    Prisma.sql`SELECT datname FROM pg_database WHERE datname = ${databaseName}`,
  );
  if (existing.length === 0) {
    await adminClient.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
  }
  await adminClient.$disconnect();
};

export default async function globalSetup() {
  if (!shouldRunDbTests()) {
    return;
  }
  const databaseUrl = resolveDatabaseUrlForTests();

  try {
    process.env.DATABASE_URL = databaseUrl;
    const databaseName = parseTestDatabaseName(databaseUrl);
    await ensureTestDatabase(databaseUrl, databaseName);

    try {
      execSync("pnpm prisma:migrate", {
        stdio: "inherit",
        env: { ...process.env },
      });
    } catch {
      // If the test DB has a failed migration record, reset it and retry once.
      execSync("pnpm exec prisma migrate reset --force --skip-generate --skip-seed", {
        stdio: "inherit",
        env: { ...process.env },
      });
      execSync("pnpm prisma:migrate", {
        stdio: "inherit",
        env: { ...process.env },
      });
    }
  } catch (error) {
    if (isStrictCiEnvironment() || !isDatabaseUnreachableError(error)) {
      throw error;
    }

    process.env.SKIP_DB_TESTS = "1";
    // Local sandbox can block host Docker ports; skip DB tests instead of failing all checks.
    console.warn("[tests] Skipping database tests: PostgreSQL is unreachable in this environment.");
  }
}
