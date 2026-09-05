import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": resolve(process.cwd(), "src") } },
  test: {
    environment: "node",
    include: ["tests/unit/baam-*.test.{ts,tsx}", "tests/unit/sold-products-export.test.ts", "tests/unit/analytics-reporting.test.ts"],
    setupFiles: [], globalSetup: [], fileParallelism: false,
    env: { NODE_ENV: "test", RUN_DB_TESTS: "0", SKIP_DB_TESTS: "1" },
  },
});
