import { execSync } from "node:child_process";
import { PrismaClient, Prisma } from "@prisma/client";

import { assertUnicodeCaseInsensitiveSearch } from "@/server/db/databaseCapabilities";

import {
  assertDatabaseTestExecutionPolicy,
  assertSafeTestDatabaseReset,
  resolveConfiguredTestDatabaseUrl,
} from "./helpers/testDatabaseSafety";
import { configureTestRuntimeEnvironment } from "./helpers/testRuntimeIsolation";

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
  const shouldRunDbTests = assertDatabaseTestExecutionPolicy();
  const databaseUrl = shouldRunDbTests ? resolveConfiguredTestDatabaseUrl() : null;
  const databaseIdentity = databaseUrl ? assertSafeTestDatabaseReset({ databaseUrl }) : null;

  configureTestRuntimeEnvironment(process.env);

  if (!databaseUrl || !databaseIdentity) {
    return;
  }

  process.env.DATABASE_URL = databaseUrl;
  await ensureTestDatabase(databaseUrl, databaseIdentity.databaseName);

  const capabilityClient = new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    await assertUnicodeCaseInsensitiveSearch(capabilityClient);
  } finally {
    await capabilityClient.$disconnect();
  }

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
