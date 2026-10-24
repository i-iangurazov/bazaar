import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { assertSafeTestDatabaseReset } from "../../tests/helpers/testDatabaseSafety";
import { resolveMigrationDatabaseUrl } from "../../src/server/db/connection";

export default async function setup() {
  if (process.env.RUN_POOLING_TESTS !== "1") throw new Error("Pooling fixture must be explicitly enabled.");
  const directUrl = resolveMigrationDatabaseUrl(process.env);
  const pooledUrl = process.env.DATABASE_TEST_URL;
  for (const databaseUrl of [directUrl, pooledUrl]) {
    if (!databaseUrl) throw new Error("Both pooling fixture endpoints are required.");
    assertSafeTestDatabaseReset({ databaseUrl });
    if (new URL(databaseUrl).hostname !== "127.0.0.1") throw new Error("Pooling fixture must be local.");
    const db = new PrismaClient({ datasourceUrl: databaseUrl });
    try {
      const [identity] = await db.$queryRaw<{ db: string; username: string; fixture: string }[]>`
        SELECT current_database() AS db, current_user AS username,
          current_setting('bazaar.pooling_fixture', true) AS fixture
      `;
      if (identity.db !== "bazaar_hardening_ci" || identity.username !== "bazaar_test" || identity.fixture !== "isolated") {
        throw new Error("Unexpected database; refusing pooling fixture migrations.");
      }
    } finally {
      await db.$disconnect();
    }
  }
  const result = spawnSync("pnpm", ["prisma:migrate"], {
    env: { ...process.env, DATABASE_URL: directUrl }, stdio: "inherit",
  });
  if (result.error || result.status !== 0) throw new Error("Pooling fixture migrations failed.");
}
