import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { baamTestEnvironment } from "../baam/environment";

export const ports = { app: 3122, postgres: 55440, redis: 56391 } as const;
export const databaseName = "bazaar_espresso_ui";
export const databaseUrl = `postgresql://bazaar_test:bazaar_test_only@127.0.0.1:${ports.postgres}/${databaseName}`;
export type Secrets = { auth: string; cron: string; jobs: string; health: string; control: string };

export const localPaths = (repository: string) => {
  const root = resolve(repository);
  return {
    root,
    data: join(root, ".local/bazaar"),
    backups: join(root, ".local/bazaar-backups"),
    postgres: join(root, ".local/bazaar/postgres"),
    redis: join(root, ".local/bazaar/redis"),
    socket: join(root, ".local/bazaar/pgsocket"),
    control: join(root, ".local/bazaar/control.sock"),
    logs: join(root, ".local/bazaar/logs"),
    manifest: join(root, ".local/bazaar/manifest.json"),
    lock: join(root, ".local/bazaar/supervisor.lock"),
    status: join(root, ".local/bazaar/status.json"),
    legacyPostgres: join(root, "artifacts/ux/espresso/local-postgres/pgdata"),
  };
};
export type Paths = ReturnType<typeof localPaths>;

/** Refuse temporary roots and symlink escapes, including symlinked ancestors. */
export async function assertPersistentPath(repository: string, target: string) {
  const root = resolve(repository),
    path = resolve(target);
  const inside = relative(root, path);
  if (
    !isAbsolute(repository) ||
    !inside ||
    inside.startsWith(`..${sep}`) ||
    inside === ".." ||
    isAbsolute(inside)
  ) {
    throw new Error("Local data must remain inside this repository.");
  }
  if (/^\/(?:private\/)?(?:tmp|var\/folders)(?:\/|$)/.test(root)) {
    throw new Error("A temporary checkout cannot host persistent local data.");
  }
  if ((await realpath(root)) !== root)
    throw new Error("Use the real repository path, not a symlink.");
  let current = root;
  for (const part of inside.split(sep)) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw new Error("Local data paths must not contain symlinks.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

export function localEnvironment(
  source: Readonly<Record<string, string | undefined>>,
  secrets: Secrets,
  aiEnabled: boolean,
): NodeJS.ProcessEnv {
  const env = baamTestEnvironment({ ...process.env, ...source });
  // Only AI settings may be carried from the user's local env. Automated checks
  // explicitly disable this; no remote database/payment/marketplace is inherited.
  if (aiEnabled) {
    for (const [key, value] of Object.entries(source)) {
      if (
        /^(?:DEEPSEEK_|OPENAI_|AI_PROVIDER$|BAAM_(?!TEST_|LIVE_PROVIDER$)|PRODUCT_(?:DESCRIPTION|SPEC|IMAGE_STUDIO)_AI_)/.test(
          key,
        )
      )
        env[key] = value;
    }
    env.HARDENING_EXTERNAL_PROVIDER_MODE = "";
  }
  return {
    ...env,
    NODE_ENV: "production",
    VERCEL: undefined,
    VERCEL_ENV: "development",
    UX_SUITE: "espresso",
    DATABASE_URL: databaseUrl,
    DATABASE_TEST_URL: databaseUrl,
    DATABASE_URL_UNPOOLED: databaseUrl,
    POSTGRES_URL_NON_POOLING: databaseUrl,
    DIRECT_URL: databaseUrl,
    EXPECTED_TEST_DB_NAME: databaseName,
    RUN_DB_TESTS: "0",
    ALLOW_TEST_DB_RESET: "0",
    REDIS_URL: `redis://127.0.0.1:${ports.redis}/4`,
    REDIS_KEY_PREFIX: "espresso-ui-test",
    NEXTAUTH_URL: `http://localhost:${ports.app}`,
    NEXTAUTH_SECRET: secrets.auth,
    JOBS_SECRET: secrets.jobs,
    CRON_SECRET: secrets.cron,
    HEALTHCHECK_SECRET: secrets.health,
    BILLING_PAYMENTS_MODE: "disabled",
    FREEDOMPAY_MERCHANT_ID: "",
    FREEDOMPAY_SECRET_KEY: "",
    PLATFORM_OWNER_EMAILS: "platform@espresso.example.invalid",
    HOSTNAME: "127.0.0.1",
    PORT: String(ports.app),
    ALLOW_LOCALHOST_DATABASE_IN_PRODUCTION: "true",
    ALLOW_LOG_EMAIL_IN_PRODUCTION: "true",
  };
}

export const digest = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
export const healthIsReady = (health: Record<string, unknown>) =>
  health.status === "ok" &&
  health.db === "up" &&
  health.redis === "up" &&
  health.migrations === "ok";
