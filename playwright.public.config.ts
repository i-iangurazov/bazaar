import { defineConfig } from "@playwright/test";

import {
  assertAuthenticatedE2EDatabaseUrl,
  assertAuthenticatedE2ERedisUrl,
  authenticatedE2ERedisKeyPrefix,
} from "./tests/e2e/authenticated/contract";

const host = "127.0.0.1";
const port = 4173;
const internalPort = 4176;
const expectProduction = process.env.PUBLIC_E2E_EXPECT_PRODUCTION === "1";
const baseURL = `${expectProduction ? "https" : "http"}://${host}:${port}`;
const databaseUrl = expectProduction
  ? assertAuthenticatedE2EDatabaseUrl(process.env.E2E_AUTH_DATABASE_URL)
  : "postgresql://playwright:playwright@127.0.0.1:1/playwright_public_smoke?connect_timeout=1";
const redisUrl = expectProduction
  ? assertAuthenticatedE2ERedisUrl(process.env.E2E_AUTH_REDIS_URL)
  : "";
const serverCommand = expectProduction
  ? "node scripts/playwright-authenticated-production-server.mjs"
  : `pnpm exec next dev --hostname ${host} --port ${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "public-routes.spec.ts",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 20_000,
  },
  outputDir: "test-results/public-routes",
  reporter: [["line"]],
  use: {
    baseURL,
    browserName: "chromium",
    channel: "chrome",
    headless: true,
    locale: "en-US",
    colorScheme: "light",
    reducedMotion: "reduce",
    serviceWorkers: "block",
    ignoreHTTPSErrors: expectProduction,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "public-desktop",
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      name: "public-tablet",
      use: { viewport: { width: 1024, height: 768 } },
    },
    {
      name: "public-mobile",
      use: { viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: serverCommand,
    url: `${baseURL}/robots.txt`,
    ignoreHTTPSErrors: expectProduction,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      NODE_OPTIONS: expectProduction
        ? "--max-old-space-size=8192 --import=./scripts/playwright-authenticated-network-guard.mjs"
        : "--max-old-space-size=8192",
      AUTHENTICATED_E2E_PUBLIC_PORT: String(port),
      AUTHENTICATED_E2E_INTERNAL_PORT: String(internalPort),
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
      NEXTAUTH_SECRET: "qa-bazaar-local-public-playwright-secret-2026",
      NEXT_PUBLIC_APP_URL: baseURL,
      JOBS_SECRET: "qa-bazaar-local-public-jobs-secret-2026",
      CRON_SECRET: "qa-bazaar-local-public-cron-secret-2026",
      EMAIL_PROVIDER: "log",
      EMAIL_FROM: "qa-bazaar@public-e2e.test",
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
      // Exercise open-signup field semantics without submitting valid data or creating an account.
      SIGNUP_MODE: "open",
      SKIP_EMAIL_VERIFICATION: "0",
    },
  },
});
