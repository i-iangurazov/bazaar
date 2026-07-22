import { execSync } from "node:child_process";
import { PrismaClient, Prisma } from "@prisma/client";

import {
  assertDatabaseTestExecutionPolicy,
  assertSafeTestDatabaseReset,
  resolveConfiguredTestDatabaseUrl,
} from "./helpers/testDatabaseSafety";

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
  if (!assertDatabaseTestExecutionPolicy()) {
    return;
  }
  const databaseUrl = resolveConfiguredTestDatabaseUrl();

  process.env.DATABASE_URL = databaseUrl;
  const { databaseName } = assertSafeTestDatabaseReset({ databaseUrl });
  await ensureTestDatabase(databaseUrl, databaseName);

  try {
    execSync("pnpm prisma:migrate", {
      stdio: "inherit",
      env: { ...process.env },
    });
  } catch {
    // If the test DB has a failed migration record, reset it and retry once.
    assertSafeTestDatabaseReset({ databaseUrl });
    execSync("pnpm exec prisma migrate reset --force --skip-generate --skip-seed", {
      stdio: "inherit",
      env: { ...process.env },
    });
    execSync("pnpm prisma:migrate", {
      stdio: "inherit",
      env: { ...process.env },
    });
  }
}
