/** Database regressions use a separate resettable DB, never the browser fixtures. */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseReset } from "../../tests/helpers/testDatabaseSafety";
import { uxEnvironment } from "../ux/environment";

if (process.env.UX_SUITE !== "espresso") throw new Error("Set UX_SUITE=espresso explicitly");
const suite = process.argv[2] ?? "database";
const suites = {
  database: [
    "tests/integration/products.test.ts",
    "tests/integration/inventory.test.ts",
    "tests/integration/inventory-correctness.test.ts",
  ],
  directories: [
    "tests/integration/customers.test.ts",
    "tests/integration/customer-purchase-report.test.ts",
    "tests/integration/stores.test.ts",
    "tests/integration/store-isolation.test.ts",
    "tests/integration/b0-agent-3-access-cache-p0.test.ts",
  ],
  authentication: ["tests/integration/auth-entry.test.ts"],
  settings: [
    "tests/integration/attributes.test.ts",
    "tests/integration/catalog-sources.test.ts",
    "tests/integration/profile-settings.test.ts",
    "tests/integration/product-unit-change.test.ts",
    "tests/integration/users.test.ts",
    "tests/integration/imports.test.ts",
  ],
  warehouse: [
    "tests/integration/inventory.test.ts",
    "tests/integration/inventory-correctness.test.ts",
    "tests/integration/stock-counts.test.ts",
    "tests/integration/stock-count-search.test.ts",
  ],
  unit: ["tests/unit"],
} as const;
if (!Object.prototype.hasOwnProperty.call(suites, suite)) {
  throw new Error("Choose database, directories, authentication, settings, warehouse or unit");
}
const require = createRequire(import.meta.url);
createRequire(require.resolve("next/package.json"))("@next/env").loadEnvConfig(
  process.cwd(),
  false,
);
const databaseUrl = new URL(uxEnvironment().DATABASE_URL!);
databaseUrl.pathname = "/bazaar_hardening_ci";
const env = {
  ...uxEnvironment(),
  NODE_ENV: "test",
  DATABASE_URL: databaseUrl.toString(),
  DATABASE_TEST_URL: databaseUrl.toString(),
  EXPECTED_TEST_DB_NAME: "bazaar_hardening_ci",
  RUN_DB_TESTS: "1",
  ALLOW_TEST_DB_RESET: "1",
  REDIS_URL: "redis://127.0.0.1:56390/5",
  REDIS_KEY_PREFIX: "espresso-regression-test",
};
assertSafeTestDatabaseReset({ env });
if (suite === "unit") {
  // Imported unit modules must also inherit isolated URLs and disabled providers.
  env.RUN_DB_TESTS = "0";
  env.ALLOW_TEST_DB_RESET = "0";
} else {
  // A C-locale cluster does not fold Cyrillic case. Do not silently test a
  // different search contract or recreate an existing database here.
  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = "/postgres";
  const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
  try {
    const databases = await admin.$queryRaw<Array<{ datname: string }>>`
      SELECT datname FROM pg_database WHERE datname = 'bazaar_hardening_ci'
    `;
    if (!databases.length) {
      await admin.$executeRawUnsafe(
        `CREATE DATABASE "bazaar_hardening_ci" TEMPLATE template0 LOCALE_PROVIDER icu ICU_LOCALE 'und'`,
      );
    }
  } finally {
    await admin.$disconnect();
  }
  const database = new PrismaClient({ datasourceUrl: databaseUrl.toString() });
  try {
    const [semantics] = await database.$queryRaw<Array<{ folded: string; matches: boolean }>>`
      SELECT LOWER('Терка') AS folded, 'Терка' ILIKE '%терка%' AS matches
    `;
    if (semantics?.folded !== "терка" || !semantics.matches) {
      throw new Error(
        "The isolated regression database requires a Unicode-aware locale; preserve existing fixtures before repairing it.",
      );
    }
  } finally {
    await database.$disconnect();
  }
}

const result = spawnSync(
  "pnpm",
  ["exec", "vitest", "run", ...suites[suite as keyof typeof suites]],
  { env, stdio: "inherit" },
);
process.exit(result.status ?? 1);
