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
      BAZAAR_TEST_PROVIDER_CONTRACT: "openai",
      BAZAAR_TEST_PROVIDER_SANDBOX_ACK: "SANDBOX_ONLY",
      BAZAAR_TEST_RUNTIME_LANE: "provider-contract",
      HARDENING_TEST_PROVIDER_HOST_ALLOWLIST: "127.0.0.1",
      OPENAI_API_KEY: "",
      RUN_DB_TESTS: "0",
      RUN_EXTERNAL_PROVIDER_CONTRACT_TESTS: "1",
      SKIP_DB_TESTS: "1",
    },
    include: ["tests/contract/provider/**/*.test.ts"],
    setupFiles: ["./tests/setup-contract.ts"],
    globals: true,
    fileParallelism: false,
  },
});
