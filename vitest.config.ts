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
    // This suite owns separate disposable services and must use its dedicated launcher.
    exclude: [...configDefaults.exclude, "tests/stabilization/**"],
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    globalSetup: "./tests/global-setup.ts",
    globals: true,
    fileParallelism: false,
  },
});
