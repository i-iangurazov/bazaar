// Disposable local infrastructure and a repeatable demo. No customer credentials.
import { spawnSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(".local/china-image-search");
const data = resolve(root, "postgres");
const marker = resolve(root, "DISPOSABLE-TEST-ONLY");
const database = "postgresql://bazaar_test@127.0.0.1:55981/bazaar_hardening_agent4_platform";
const env = { ...process.env };
const dotenvKeys = [".env", ".env.local", ".env.production", ".env.production.local"].flatMap(
  (file) =>
    existsSync(file)
      ? [
          ...readFileSync(file, "utf8").matchAll(
            /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm,
          ),
        ].map((match) => match[1])
      : [],
);
for (const key of new Set([...Object.keys(env), ...dotenvKeys])) {
  if (
    /^(?:RESEND_|OPENAI_|DEEPSEEK_|AI_PROVIDER|BAAM_|R2_|STRIPE_|SMTP_|BAKAI_|M_MARKET_|O_MARKET_|FREEDOMPAY_|GOPAY_|HIOBUY_)/.test(
      key,
    )
  )
    env[key] = "";
}
Object.assign(env, {
  PATH: `/opt/homebrew/opt/postgresql@16/bin:/opt/homebrew/bin:${process.env.PATH}`,
  NODE_ENV: "test",
  VERCEL_ENV: "development",
  DATABASE_URL: database,
  DIRECT_URL: database,
  DATABASE_TEST_URL: database,
  EXPECTED_TEST_DB_NAME: "bazaar_hardening_agent4_platform",
  RUN_DB_TESTS: "1",
  ALLOW_TEST_DB_RESET: "1",
  REDIS_URL: "redis://127.0.0.1:55982/0",
  REDIS_KEY_PREFIX: "china-image-search-qa",
  NEXTAUTH_SECRET: "disposable-china-image-search-secret",
  NEXTAUTH_URL: "http://localhost:3148",
  EMAIL_PROVIDER: "log",
  EMAIL_FROM: "Bazaar QA <qa@example.invalid>",
  IMAGE_STORAGE_PROVIDER: "local",
  EXPORT_STORAGE_PROVIDER: "local",
  HARDENING_EXTERNAL_PROVIDER_MODE: "disabled",
  BILLING_PAYMENTS_MODE: "disabled",
  O_MARKET_MOCK_API: "1",
  HARDENING_PREVIEW_GUARD: "0",
  HIOBUY_IMAGE_SEARCH_MODE: "demo",
  HIOBUY_IMAGE_SEARCH_ORGANIZATION_IDS: "china-image-search-qa-org",
  HIOBUY_CATALOG_USE_CONFIRMED: "0",
  NODE_OPTIONS: `--max-old-space-size=3072 --require ${resolve("scripts/qa/low-resource.cjs")}`,
  RAYON_NUM_THREADS: "2",
  UV_THREADPOOL_SIZE: "2",
  BAZAAR_BUILD_CPUS: "2",
  NEXT_TELEMETRY_DISABLED: "1",
});
const run = (cmd, args) => {
  const result = spawnSync(cmd, args, { env, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${cmd} failed (${result.status})`);
};
const ownRedis = () => {
  const config = spawnSync("redis-cli", ["-p", "55982", "--raw", "CONFIG", "GET", "pidfile"], {
    env,
    encoding: "utf8",
  });
  if (config.status !== 0) return false;
  if (config.stdout.trim().split(/\r?\n/)[1] !== resolve(root, "redis.pid"))
    throw new Error("Port 55982 belongs to another service");
  return true;
};
const mode = process.argv[2];
mkdirSync(root, { recursive: true });
if (mode === "up") {
  if (!existsSync(data)) {
    writeFileSync(marker, "Disposable China image search QA; no customer records\n");
    run("initdb", [
      "-D",
      data,
      "-U",
      "bazaar_test",
      "-A",
      "trust",
      "--encoding=UTF8",
      "--locale=en_US.UTF-8",
    ]);
  }
  if (!existsSync(marker)) throw new Error("Missing test identity");
  if (spawnSync("pg_ctl", ["-D", data, "status"], { env, stdio: "ignore" }).status !== 0)
    run("pg_ctl", [
      "-D",
      data,
      "-l",
      resolve(root, "postgres.log"),
      "-o",
      `-p 55981 -h 127.0.0.1 -k ${root} -c max_connections=30 -c shared_buffers=32MB`,
      "-w",
      "start",
    ]);
  if (!ownRedis())
    run("redis-server", [
      "--port",
      "55982",
      "--bind",
      "127.0.0.1",
      "--save",
      "",
      "--appendonly",
      "no",
      "--daemonize",
      "yes",
      "--pidfile",
      resolve(root, "redis.pid"),
      "--logfile",
      resolve(root, "redis.log"),
    ]);
  const db = spawnSync(
    "createdb",
    ["-h", "127.0.0.1", "-p", "55981", "-U", "bazaar_test", "bazaar_hardening_agent4_platform"],
    { env, encoding: "utf8" },
  );
  if (db.status !== 0 && !db.stderr.includes("already exists"))
    throw new Error("Cannot create isolated database");
} else if (mode === "down") {
  if (!existsSync(marker)) throw new Error("Missing test identity");
  if (ownRedis()) run("redis-cli", ["-p", "55982", "shutdown", "nosave"]);
  run("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]);
} else if (mode === "test") {
  run("pnpm", ["exec", "vitest", "run", ...process.argv.slice(3)]);
} else if (mode === "migrate") {
  run("pnpm", ["exec", "prisma", "migrate", "deploy"]);
} else if (["build", "serve", "dev"].includes(mode)) {
  const require = createRequire(import.meta.url);
  Object.assign(env, {
    NODE_ENV: mode === "dev" ? "development" : "production",
    __NEXT_PROCESSED_ENV: "true",
    ALLOW_LOCALHOST_DATABASE_IN_PRODUCTION: "1",
    ALLOW_LOG_EMAIL_IN_PRODUCTION: "1",
    RUN_DB_TESTS: "0",
    ALLOW_TEST_DB_RESET: "0",
    JOBS_SECRET: "disposable-qa-jobs",
    CRON_SECRET: "disposable-qa-cron",
  });
  delete env.VERCEL;
  if (mode === "dev") delete env.VERCEL_ENV;
  else env.VERCEL_ENV = "preview";
  const args =
    mode === "build"
      ? ["build"]
      : [mode === "serve" ? "start" : "dev", "--hostname", "127.0.0.1", "--port", "3148"];
  const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), ...args], {
    env,
    stdio: "inherit",
  });
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
  child.on("exit", (code) => process.exit(code ?? 1));
} else throw new Error("Use up, migrate, test, build, serve, dev or down");
