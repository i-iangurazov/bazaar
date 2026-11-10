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
      // Vitest 4 narrowed its defaults. Preserve the previous generated/config
      // exclusions rather than accidentally discovering bundled audit fixtures.
      "**/dist/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*",
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
    // Vitest 4 no longer includes unexecuted files by default. Keep them in
    // optional coverage reports so migration cannot inflate measured coverage.
    coverage: { include: ["src/**/*.{ts,tsx}", "scripts/**/*.{ts,tsx,mjs}"] },
    fileParallelism: false,
    maxWorkers: 1,
    isolate: true,
  },
});
