import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { stockAuditEnvironment } from "./environment";
const require = createRequire(import.meta.url);
const nextEnv = createRequire(require.resolve("next/package.json"))("@next/env");
nextEnv.loadEnvConfig(process.cwd(), false);
const env = {
  ...stockAuditEnvironment(),
  NODE_ENV: "production",
  VERCEL: "0",
  VERCEL_ENV: "development",
  ALLOW_LOCALHOST_DATABASE_IN_PRODUCTION: "true",
  ALLOW_LOG_EMAIL_IN_PRODUCTION: "true",
  JOBS_SECRET: "isolated-stock-build-jobs",
  CRON_SECRET: "isolated-stock-build-cron-secret",
};
// This builds against the migrated disposable DB, never a production connection.
// Stop the development server first: both Next modes own the .next directory.
const result = spawnSync("pnpm", ["build"], { env, stdio: "inherit" });
process.exit(result.status ?? 1);
