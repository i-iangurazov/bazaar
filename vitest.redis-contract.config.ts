import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(rootDir, "src"),
    },
  },
  test: {
    environment: "node",
    env: {
      ALLOW_TEST_DB_RESET: "0",
      BAZAAR_TEST_RUNTIME_LANE: "redis-contract",
      RUN_DB_TESTS: "0",
      SKIP_DB_TESTS: "1",
    },
    include: ["tests/contract/redis/**/*.test.ts"],
    setupFiles: ["./tests/setup-contract.ts"],
    globals: true,
    fileParallelism: false,
  },
});
