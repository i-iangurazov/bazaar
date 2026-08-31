import { configDefaults, defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

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
      BAZAAR_TEST_RUNTIME_LANE: "deterministic",
    },
    exclude: [...configDefaults.exclude, "tests/contract/**", "tests/e2e/**"],
    setupFiles: ["./tests/setup.ts"],
    globalSetup: "./tests/global-setup.ts",
    globals: true,
    fileParallelism: false,
  },
});
