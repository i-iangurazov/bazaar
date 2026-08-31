import { defineConfig, devices } from "@playwright/test";

import {
  assertAuthenticatedE2EDatabaseUrl,
  assertAuthenticatedE2ERedisUrl,
  authenticatedE2EAccounts,
  authenticatedE2ERedisKeyPrefix,
  authenticatedE2EStorageStatePath,
} from "./tests/e2e/authenticated/contract";

const host = "127.0.0.1";
const port = 4174;
const expectProduction = process.env.AUTHENTICATED_E2E_EXPECT_PRODUCTION === "1";
const baseURL = `${expectProduction ? "https" : "http"}://${host}:${port}`;
const serverCommand = expectProduction
  ? "node scripts/playwright-authenticated-production-server.mjs"
  : `pnpm exec next dev --hostname ${host} --port ${port}`;
const databaseUrl = assertAuthenticatedE2EDatabaseUrl(process.env.E2E_AUTH_DATABASE_URL);
const redisUrl = expectProduction
  ? assertAuthenticatedE2ERedisUrl(process.env.E2E_AUTH_REDIS_URL)
  : "";
const commonUse = {
  ...devices["Desktop Chrome"],
  baseURL,
  browserName: "chromium" as const,
  channel: "chrome" as const,
  headless: true,
  locale: "en-US",
  colorScheme: "light" as const,
  reducedMotion: "reduce" as const,
  serviceWorkers: "block" as const,
  ignoreHTTPSErrors: expectProduction,
  launchOptions: {
    args: [
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-sync",
      "--ignore-certificate-errors",
      "--allow-insecure-localhost",
      "--metrics-recording-only",
      "--no-first-run",
      "--safebrowsing-disable-auto-update",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost",
    ],
  },
  screenshot: "only-on-failure" as const,
  trace: "retain-on-failure" as const,
  video: "off" as const,
};

export default defineConfig({
  testDir: "./tests/e2e/authenticated",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  outputDir: "test-results/authenticated/artifacts",
  reporter: [["line"]],
  use: commonUse,
  projects: [
    {
      name: "authenticated-setup",
      testMatch: "auth.setup.ts",
    },
    ...(
      [
        ["ADMIN", "admin"],
        ["MANAGER", "manager"],
        ["STAFF", "staff"],
        ["CASHIER", "cashier"],
      ] as const
    ).map(([role, accountKey]) => ({
      name: `role-${role.toLowerCase()}`,
      testMatch: "authenticated-routes.spec.ts",
      grep: /@role-matrix/,
      dependencies: ["authenticated-setup"],
      metadata: { role, accountKey },
      use: {
        ...commonUse,
        storageState: authenticatedE2EStorageStatePath(accountKey),
        viewport: { width: 1440, height: 900 },
      },
    })),
    {
      name: "organization-owner",
      testMatch: "authenticated-routes.spec.ts",
      grep: /@owner-org/,
      dependencies: ["authenticated-setup"],
      metadata: { role: "ADMIN", accountKey: "organizationOwner" },
      use: {
        ...commonUse,
        storageState: authenticatedE2EStorageStatePath("organizationOwner"),
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "platform-owner",
      testMatch: "authenticated-routes.spec.ts",
      grep: /@owner-platform/,
      dependencies: ["authenticated-setup"],
      metadata: { role: "ADMIN", accountKey: "platformOwner" },
      use: {
        ...commonUse,
        storageState: authenticatedE2EStorageStatePath("platformOwner"),
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "authenticated-acceptance-admin",
      testMatch: "authenticated-acceptance-*.spec.ts",
      dependencies: ["authenticated-setup"],
      metadata: { role: "ADMIN", accountKey: "admin" },
      use: {
        ...commonUse,
        storageState: authenticatedE2EStorageStatePath("admin"),
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "authenticated-dynamic",
      testMatch: "authenticated-routes.spec.ts",
      grep: /@dynamic/,
      dependencies: ["authenticated-setup"],
      metadata: { role: "ADMIN", accountKey: "admin" },
      use: {
        ...commonUse,
        storageState: authenticatedE2EStorageStatePath("admin"),
        viewport: { width: 1440, height: 900 },
      },
    },
    ...(
      [
        ["desktop", 1440, 900, "en"],
        ["tablet", 1024, 768, "ru"],
        ["mobile", 390, 844, "kg"],
      ] as const
    ).map(([name, width, height, locale]) => ({
      name: `authenticated-${name}`,
      testMatch: "authenticated-routes.spec.ts",
      grep: /@responsive/,
      dependencies: ["authenticated-setup"],
      metadata: { role: "ADMIN", accountKey: "platformOwner", locale },
      use: {
        ...commonUse,
        storageState: authenticatedE2EStorageStatePath("platformOwner"),
        viewport: { width, height },
      },
    })),
  ],
  webServer: {
    command: serverCommand,
    url: `${baseURL}/api/auth/csrf`,
    ignoreHTTPSErrors: expectProduction,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      NODE_OPTIONS:
        "--max-old-space-size=8192 --import=./scripts/playwright-authenticated-network-guard.mjs",
      NEXT_TELEMETRY_DISABLED: "1",
      DATABASE_URL: databaseUrl,
      E2E_AUTH_DATABASE_URL: databaseUrl,
      RUN_DB_TESTS: "0",
      ALLOW_TEST_DB_RESET: "0",
      ALLOW_LOCALHOST_DATABASE_IN_PRODUCTION: expectProduction ? "1" : "0",
      ALLOW_AUTHENTICATED_E2E_SEED: "0",
      HARDENING_PREVIEW_GUARD: "0",
      HARDENING_EXTERNAL_PROVIDER_MODE: "disabled",
      REDIS_URL: redisUrl,
      REDIS_KEY_PREFIX: expectProduction ? authenticatedE2ERedisKeyPrefix : "",
      NEXTAUTH_URL: baseURL,
      NEXTAUTH_SECRET: "qa-bazaar-local-authenticated-playwright-secret-2026",
      NEXT_PUBLIC_APP_URL: baseURL,
      JOBS_SECRET: "qa-bazaar-local-authenticated-jobs-secret-2026",
      CRON_SECRET: "qa-bazaar-local-authenticated-cron-secret-2026",
      PLATFORM_OWNER_EMAILS: authenticatedE2EAccounts.platformOwner.email,
      EMAIL_PROVIDER: "log",
      EMAIL_FROM: "qa-bazaar@auth-e2e.test",
      ALLOW_LOG_EMAIL_IN_PRODUCTION: expectProduction ? "1" : "0",
      RESEND_API_KEY: "",
      OPENAI_API_KEY: "",
      IMAGE_STORAGE_PROVIDER: "local",
      EXPORT_STORAGE_PROVIDER: "local",
      R2_ACCOUNT_ID: "",
      R2_ACCESS_KEY_ID: "",
      R2_SECRET_ACCESS_KEY: "",
      R2_BUCKET_NAME: "",
      R2_PUBLIC_BASE_URL: "",
      R2_ENDPOINT: "",
      O_MARKET_MOCK_API: "1",
      SIGNUP_MODE: "open",
      SKIP_EMAIL_VERIFICATION: "0",
    },
  },
});
