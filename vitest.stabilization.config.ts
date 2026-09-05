import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { stabilizationEnvironment } from "./scripts/stabilization/environment";

export default defineConfig({
  resolve: { alias: { "@": resolve(process.cwd(), "src") } },
  test: {
    environment: "node",
    include: ["tests/stabilization/**/*.test.ts"],
    setupFiles: ["tests/stabilization/setup.ts"],
    globalSetup: [],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: stabilizationEnvironment(),
  },
});
