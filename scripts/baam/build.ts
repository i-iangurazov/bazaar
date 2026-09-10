import { spawn } from "node:child_process";
import { baamTestEnvironment, assertBaamTestDatabase } from "./environment";
const env = {
  ...baamTestEnvironment(),
  NODE_ENV: "production",
  ALLOW_LOCALHOST_DATABASE_IN_PRODUCTION: "true",
  ALLOW_LOG_EMAIL_IN_PRODUCTION: "true",
  JOBS_SECRET: "baam-isolated-build-jobs",
  CRON_SECRET: "baam-isolated-build-cron-secret",
};
Object.assign(process.env, env);
assertBaamTestDatabase();
const child = spawn("pnpm", ["build"], { env, stdio: "inherit" });
process.exitCode = await new Promise<number>((resolve, reject) => {
  child.on("error", reject);
  child.on("exit", (code) => resolve(code ?? 1));
});
