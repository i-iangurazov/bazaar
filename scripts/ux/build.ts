import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { uxEnvironment } from "./environment";
const require = createRequire(import.meta.url);
createRequire(require.resolve("next/package.json"))("@next/env").loadEnvConfig(
  process.cwd(),
  false,
);
// Both build preflight and migrations point exclusively at the disposable UI database.
const result = spawnSync("pnpm", ["build"], {
  env: {
    ...uxEnvironment(),
    NODE_ENV: "production",
    ALLOW_LOCALHOST_DATABASE_IN_PRODUCTION: "true",
    ALLOW_LOG_EMAIL_IN_PRODUCTION: "true",
  },
  stdio: "inherit",
});
process.exit(result.status ?? 1);
