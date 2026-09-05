import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": resolve(process.cwd(), "src") } },
  test: {
    environment: "node",
    include: [
      "tests/unit/signup-page.test.tsx",
      "tests/unit/analytics-reporting.test.ts",
      "tests/unit/auth-session-claims.test.ts",
      "tests/unit/stabilization-environment.test.ts",
    ],
    globalSetup: [],
    setupFiles: [],
    fileParallelism: false,
    env: { NODE_ENV: "test", RUN_DB_TESTS: "0", SKIP_DB_TESTS: "1" },
  },
});
