import { spawnSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(".local/subscriptions-20261107");
const data = resolve(root, "disposable-postgres-utf8");
const marker = resolve(root, "TEST-INFRASTRUCTURE-ONLY");
const dbUrl = "postgresql://bazaar_test@127.0.0.1:55971/bazaar_hardening_agent4_platform";
const env = { ...process.env, NODE_ENV: "test", VERCEL_ENV: "development", VERCEL: "0",
  DATABASE_URL: dbUrl, DATABASE_TEST_URL: dbUrl,
  EXPECTED_TEST_DB_NAME: "bazaar_hardening_agent4_platform", RUN_DB_TESTS: "1", ALLOW_TEST_DB_RESET: "1",
  REDIS_URL: "redis://127.0.0.1:55972/13", REDIS_KEY_PREFIX: "subscriptions-20261107",
  NEXTAUTH_SECRET: "isolated-subscriptions-20261107-test-secret", NEXTAUTH_URL: "http://127.0.0.1:3137",
  IMAGE_STORAGE_PROVIDER: "local", EXPORT_STORAGE_PROVIDER: "local", EMAIL_PROVIDER: "log",
  EMAIL_FROM: "Bazaar Test <test@example.invalid>", HARDENING_EXTERNAL_PROVIDER_MODE: "disabled",
  BILLING_PAYMENTS_MODE: "disabled", BILLING_SELF_SERVE_SIGNUP: "0", SIGNUP_MODE: "open",
};
// Explicit empty values also cover keys only present in dotenv files: Next can
// reload its environment when starting a production server. Never inherit an
// external provider credential just because it was absent from the parent shell.
const dotenvKeys = [".env", ".env.local", ".env.production", ".env.production.local"]
  .flatMap(file => existsSync(file) ? [...readFileSync(file, "utf8").matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)].map(match => match[1]) : []);
for (const key of new Set([...Object.keys(env), ...dotenvKeys])) {
  if (/^(?:RESEND_|OPENAI_|DEEPSEEK_|AI_PROVIDER|BAAM_|R2_|STRIPE_|SMTP_|BAKAI_|M_MARKET_|O_MARKET_|FREEDOMPAY_|GOPAY_)/.test(key)) env[key] = "";
}
const run = (cmd, args, capture = false) => {
  const result = spawnSync(cmd, args, { env, encoding: "utf8", stdio: capture ? "pipe" : "inherit" });
  if (result.status !== 0) throw new Error(`${cmd} failed: ${result.stderr ?? result.error ?? result.status}`);
  return result.stdout ?? "";
};
const redisReady = () => {
  const args = ["-h", "127.0.0.1", "-p", "55972"];
  const ping = spawnSync("redis-cli", [...args, "ping"], { encoding: "utf8" });
  if (ping.status !== 0) return false;
  if (ping.stdout.trim() !== "PONG") throw new Error("Unexpected service on isolated Redis port");
  const config = spawnSync("redis-cli", [...args, "--raw", "CONFIG", "GET", "pidfile"], { encoding: "utf8" });
  if (config.status !== 0 || config.stdout.trim().split(/\r?\n/)[1] !== resolve(root, "redis.pid"))
    throw new Error("Refusing to reuse or stop Redis not owned by subscription QA");
  return true;
};
mkdirSync(root, { recursive: true });
const mode = process.argv[2] ?? "test";
if (mode === "up") {
  if (!existsSync(data)) {
    writeFileSync(marker, "Disposable local subscription QA; no customer data\n");
    run("initdb", ["-D", data, "-U", "bazaar_test", "-A", "trust", "--encoding=UTF8", "--locale=en_US.UTF-8"]);
  }
  if (!existsSync(marker)) throw new Error("Missing disposable infrastructure marker");
  const status = spawnSync("pg_ctl", ["-D", data, "status"], { stdio: "ignore" });
  if (status.status !== 0) run("pg_ctl", ["-D", data, "-l", resolve(root, "postgres.log"), "-o",
    `-p 55971 -h 127.0.0.1 -k ${root} -c max_connections=30 -c shared_buffers=32MB -c work_mem=4MB`, "-w", "start"]);
  if (!redisReady()) run("redis-server", ["--port", "55972", "--bind", "127.0.0.1", "--save", "", "--appendonly", "no", "--daemonize", "yes", "--pidfile", resolve(root, "redis.pid"), "--logfile", resolve(root, "redis.log")]);
  const db = spawnSync("createdb", ["-h", "127.0.0.1", "-p", "55971", "-U", "bazaar_test", "bazaar_hardening_agent4_platform"], { encoding: "utf8" });
  if (db.status !== 0 && !db.stderr.includes("already exists")) throw new Error("Disposable database creation failed");
  console.log("Dedicated subscription PostgreSQL/Redis ready on 55971/55972; no customer database is used.");
} else if (mode === "down") {
  if (!existsSync(marker) || !readFileSync(marker, "utf8").startsWith("Disposable local subscription QA")) throw new Error("Missing isolation marker");
  const ownedRedisReady = redisReady();
  if (spawnSync("pg_ctl", ["-D", data, "status"], { stdio: "ignore" }).status === 0)
    run("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]);
  if (ownedRedisReady) run("redis-cli", ["-h", "127.0.0.1", "-p", "55972", "shutdown", "nosave"]);
} else if (mode === "test") {
  run("pnpm", ["exec", "vitest", "run", ...process.argv.slice(3)]);
} else if (mode === "migrate") {
  run("pnpm", ["exec", "prisma", "migrate", "deploy"]);
} else if (mode === "rebuild") {
  if (!existsSync(marker)) throw new Error("Missing disposable infrastructure marker");
  run("dropdb", ["--force", "-h", "127.0.0.1", "-p", "55971", "-U", "bazaar_test", "bazaar_hardening_agent4_platform"]);
  run("createdb", ["-h", "127.0.0.1", "-p", "55971", "-U", "bazaar_test", "bazaar_hardening_agent4_platform"]);
  run("pnpm", ["exec", "prisma", "migrate", "deploy"]);
} else if (["build", "serve", "dev"].includes(mode)) {
  const require = createRequire(import.meta.url);
  const nextEnv = {
    ...env, NODE_ENV: mode === "dev" ? "development" : "production",
    __NEXT_PROCESSED_ENV: "true", NEXT_TELEMETRY_DISABLED: "1",
    NEXTAUTH_URL: "http://localhost:3137", DATABASE_URL: dbUrl, DIRECT_URL: dbUrl,
    ALLOW_LOCALHOST_DATABASE_IN_PRODUCTION: "1", ALLOW_LOG_EMAIL_IN_PRODUCTION: "1",
    HARDENING_PREVIEW_GUARD: mode === "dev" ? "0" : "1", HARDENING_PREVIEW_EXPECTED_DATABASE_NAME: "bazaar_hardening_agent4_platform",
    // Subscription QA verifies closed legal publication even in development.
    // Use legal-drafts-runtime explicitly when reviewing unpublished documents.
    HARDENING_PREVIEW_EXPECTED_DATABASE_HOST: "127.0.0.1", BAZAAR_LEGAL_PREVIEW: "0",
    CRON_SECRET: "isolated-subscriptions-cron-secret", JOBS_SECRET: "isolated-subscriptions-jobs-secret",
    NODE_OPTIONS: `--max-old-space-size=3072 --require ${resolve("scripts/qa/low-resource.cjs")}`,
    RAYON_NUM_THREADS: "2", UV_THREADPOOL_SIZE: "2", RUN_DB_TESTS: "0", ALLOW_TEST_DB_RESET: "0",
    O_MARKET_MOCK_API: "1",
  };
  // The monetary test runtime uses the strict preview database guard. Legal
  // draft viewing instead requires an explicitly local development runtime.
  delete nextEnv.VERCEL;
  if (mode === "dev") delete nextEnv.VERCEL_ENV;
  else nextEnv.VERCEL_ENV = "preview";
  const args = mode === "build" ? ["build"] : [mode === "serve" ? "start" : "dev", "--hostname", "127.0.0.1", "--port", "3137"];
  const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), ...args], { env: nextEnv, stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  child.on("exit", (code) => process.exit(code ?? 1));
} else throw new Error("Use up, migrate, test or down");
