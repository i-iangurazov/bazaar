import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": resolve(process.cwd(), "src") } },
  test: {
    environment: "node",
    include: [
      "tests/unit/admin-jobs-page.test.tsx",
      "tests/unit/signup-page.test.tsx",
      "tests/unit/analytics-reporting.test.ts",
      "tests/unit/auth-session-claims.test.ts",
      "tests/unit/stripe-preparation.test.ts",
      "tests/unit/stabilization-environment.test.ts",
      "tests/unit/stabilization-fetch.test.ts",
      "tests/unit/verify-page.test.tsx",
      "tests/unit/login-recovery.test.tsx",
      "tests/unit/products-bootstrap.test.ts",
      "tests/unit/product-bulk-actions.test.ts",
      "tests/unit/deployment-migrations.test.ts",
      "tests/unit/baam-*.test.{ts,tsx}",
      "tests/unit/sold-products-export.test.ts",
    ],
    globalSetup: [],
    setupFiles: [],
    fileParallelism: false,
    env: { NODE_ENV: "test", RUN_DB_TESTS: "0", SKIP_DB_TESTS: "1" },
  },
});
