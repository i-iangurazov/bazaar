import { configDefaults, defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": resolve(rootDir, "src"),
    },
  },
  test: {
    // Stabilization owns separate services; deployment transport checks use
    // node:test and run explicitly in CI. Generated audit artifacts are evidence.
    exclude: [
      ...configDefaults.exclude,
      "tests/stabilization/**",
      "scripts/deployment/*.test.mjs",
      "artifacts/**",
      "tmp/**",
      ".next/**",
      ".local/**",
      // The heavy regression owns a fresh database in a separate CI matrix leg.
      ...(process.env.RUN_CATALOG_SCALE_TESTS === "1"
        ? []
        : ["tests/integration/price-book-scale.test.ts"]),
    ],
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    globalSetup: "./tests/global-setup.ts",
    globals: true,
    fileParallelism: false,
  },
});
