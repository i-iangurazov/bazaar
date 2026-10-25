import { spawn } from "node:child_process";
import { stabilizationEnvironment } from "../stabilization/environment";
import { withDefaultConnectionParams } from "../../src/server/db/connection";

// Fixed loopback ports and synthetic credentials only. Each invocation owns its
// own Docker project; cleanup cannot affect other local or customer services.
const direct = "postgresql://bazaar_test:bazaar_test_only@127.0.0.1:55447/bazaar_hardening_ci";
const pooled = withDefaultConnectionParams(direct.replace(":55447/", ":56447/"), true);
const env = {
  ...stabilizationEnvironment(),
  NODE_ENV: "test", VERCEL_ENV: "development", RUN_DB_TESTS: "1", RUN_POOLING_TESTS: "1",
  ALLOW_TEST_DB_RESET: "1", EXPECTED_TEST_DB_NAME: "bazaar_hardening_ci",
  DATABASE_URL: pooled, DATABASE_TEST_URL: pooled, DATABASE_URL_UNPOOLED: direct,
  POSTGRES_URL_NON_POOLING: direct, REDIS_URL: "redis://127.0.0.1:56397/13",
  REDIS_KEY_PREFIX: "pooling-regression",
};
const compose = ["compose", "-p", `bazaar-pooling-${process.pid}`, "-f", "docker-compose.pooling.yml"];
async function run(command: string, args: string[]) {
  const child = spawn(command, args, { env, stdio: "inherit" });
  await new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}
try {
  await run("docker", [...compose, "up", "--build", "-d", "--wait", "--wait-timeout", "120"]);
  await run("pnpm", ["exec", "vitest", "run", "--config", "vitest.pooling.config.ts"]);
} finally {
  await run("docker", [...compose, "down", "--volumes", "--remove-orphans"]);
}
