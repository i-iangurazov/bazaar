import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
export default defineConfig({
  resolve: { alias: { "@": resolve(process.cwd(), "src") } },
  test: {
    include: ["tests/marketing/*.integration.test.ts"],
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    isolate: true,
    testTimeout: 30_000,
    env: {
      NODE_ENV: "test",
      VERCEL_ENV: "development",
      VERCEL: "0",
      DATABASE_URL: "postgresql://bazaar_test@127.0.0.1:55443/bazaar_hardening_ci",
      REDIS_URL: "",
      NEXTAUTH_SECRET: "marketing-isolated-test-secret",
      SIGNUP_MODE: "open",
      NEXTAUTH_URL: "http://localhost:3120",
      EMAIL_PROVIDER: "log",
      SKIP_EMAIL_VERIFICATION: "1",
      HARDENING_EXTERNAL_PROVIDER_MODE: "disabled",
      OPENAI_API_KEY: "",
      RESEND_API_KEY: "",
    },
  },
});
