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
  commerce: [
    "tests/integration/pos-return-preview.test.ts",
    "tests/integration/pos.test.ts",
    "tests/integration/pos-p0-verification.test.ts",
    "tests/integration/pos-idempotent-events.test.ts",
    "tests/integration/pos-shift-close-resolution.test.ts",
    "tests/integration/sales-orders.test.ts",
    "tests/integration/sales-orders-pos-boundary.test.ts",
    "tests/integration/purchase-orders.test.ts",
    "tests/integration/purchase-order-line-concurrency.test.ts",
    "tests/integration/sale-channel.test.ts",
    "tests/integration/loyalty-pos.test.ts",
    "tests/integration/loyalty-reservation-timezone.test.ts",
  ],
  loyalty: [
    "tests/integration/loyalty-ledger.test.ts",
    "tests/integration/loyalty-member-auth.test.ts",
    "tests/integration/loyalty-qr.test.ts",
    "tests/integration/loyalty-pos.test.ts",
    "tests/integration/loyalty-online-order.test.ts",
    "tests/integration/loyalty-orders.test.ts",
    "tests/integration/loyalty-email-delivery.test.ts",
    "tests/integration/loyalty-reservation-timezone.test.ts",
  ],
  public: [
    "tests/integration/bazaar-catalog.test.ts",
    "tests/integration/catalog-discounts.test.ts",
    "tests/integration/loyalty-member-auth.test.ts",
    "tests/integration/loyalty-qr.test.ts",
    "tests/integration/loyalty-email-delivery.test.ts",
    "tests/integration/loyalty-ledger.test.ts",
    "tests/integration/loyalty-online-order.test.ts",
    "tests/integration/loyalty-orders.test.ts",
  ],
  reports: [
    "tests/integration/legacy-report-date-binding.test.ts",
    "tests/integration/reports.test.ts",
    "tests/integration/analytics.test.ts",
    "tests/integration/reporting-sales.test.ts",
    "tests/integration/reporting-operations.test.ts",
    "tests/integration/reporting-operation-timestamps.test.ts",
    "tests/integration/reporting-access-cost.test.ts",
    "tests/integration/online-sales-report.test.ts",
    "tests/integration/customer-purchase-report.test.ts",
    "tests/integration/exports.test.ts",
    "tests/integration/period-close.test.ts",
  ],
  integrations: [
    "tests/integration/integration-workspace-access.test.ts",
    "tests/integration/bazaar-api.test.ts",
    "tests/integration/bazaar-api-external-identity.test.ts",
    "tests/integration/bazaar-api-operation-request.test.ts",
    "tests/integration/bazaar-catalog.test.ts",
    "tests/integration/catalog-discounts.test.ts",
    "tests/integration/catalog-sources.test.ts",
    "tests/integration/m-market.test.ts",
    "tests/integration/bakai-store.test.ts",
    "tests/integration/o-market-job-lifecycle.test.ts",
    "tests/integration/product-image-studio.test.ts",
    "tests/integration/email-marketing-delivery.test.ts",
    "tests/integration/email-marketing-idempotency.test.ts",
    "tests/integration/email-marketing-products.test.ts",
  ],
  administration: [
    "tests/integration/legacy-report-date-binding.test.ts",
    "tests/integration/admin-metrics.test.ts",
    "tests/integration/billing.test.ts",
    "tests/integration/subscription-payments.test.ts",
    "tests/integration/b0-platform-p0-verification.test.ts",
    "tests/integration/b1-platform-export-http-security.test.ts",
    "tests/integration/support.test.ts",
    "tests/integration/onboarding-workspace-access.test.ts",
  ],
  unit: ["tests/unit"],
} as const;
if (!Object.prototype.hasOwnProperty.call(suites, suite)) {
  throw new Error(
    "Choose database, directories, authentication, settings, warehouse, commerce, loyalty, public, reports, integrations, administration or unit",
  );
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

const focusedUnitFiles = process.argv.slice(3);
if (focusedUnitFiles.length && (suite !== "unit" || focusedUnitFiles.some((path) => !/^tests\/unit\/[a-z0-9-]+\.test\.tsx?$/.test(path)))) {
  throw new Error("Focused files must be named tests/unit/*.test.ts or .tsx and use the unit suite");
}
const result = spawnSync(
  "pnpm",
  ["exec", "vitest", "run", ...(focusedUnitFiles.length ? focusedUnitFiles : suites[suite as keyof typeof suites])],
  { env, stdio: "inherit" },
);
process.exit(result.status ?? 1);
