/** Explicit, provider-disabled fault tests for this owned local fixture only. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { control, isOwnedApp } from "./daemon";
import { databaseUrl, digest, healthIsReady, localPaths } from "./config";
import { restoreFiles } from "./files";
import {
  binaries,
  pgArgs,
  pgEnv,
  postgresIdentity,
  redisClient,
  run,
  tableSnapshot,
  waitForService,
  jsonWrite,
} from "./services";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url))),
  paths = localPaths(root);
const id = randomUUID().replaceAll("-", ""),
  evidence: Record<string, unknown> = {};
const testEnv = { ...process.env, BAZAAR_LOCAL_AI: "disabled" };
const bin = await binaries();
function connection(database: string) {
  const url = new URL(databaseUrl);
  url.pathname = "/" + database;
  return url.toString();
}
async function sql<T>(url: string, fn: (db: PrismaClient) => Promise<T>) {
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    return await fn(db);
  } finally {
    await db.$disconnect();
  }
}
async function snapshot(url: string) {
  return sql(url, async (db) => {
    const tables = await db.$queryRaw<
      Array<{ tablename: string }>
    >`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
    const rows: Record<string, unknown> = {};
    for (const { tablename } of tables) {
      assert(/^[A-Za-z_][A-Za-z0-9_]*$/.test(tablename));
      rows[tablename] = await db.$queryRawUnsafe(
        `SELECT count(*)::int AS count,md5(coalesce(string_agg(row_to_json(t)::text,E'\\n' ORDER BY row_to_json(t)::text),'')) AS hash FROM public."${tablename}" t`,
      );
    }
    return rows;
  });
}
async function ready() {
  await waitForService(async () => {
    const state = await control(root);
    assert.equal(state.phase, "ready");
    assert(healthIsReady(state.health as Record<string, unknown>));
  }, 60_000);
  return control(root);
}
async function start() {
  await run("pnpm", ["local"], { env: testEnv, timeout: 15 * 60_000 });
  await ready();
}
async function stop() {
  await run("pnpm", ["local:stop"], { env: testEnv, timeout: 120_000 });
}
async function adminSql(query: string) {
  return sql(connection("postgres"), (db) => db.$executeRawUnsafe(query));
}

try {
  assert.equal(
    process.env.BAZAAR_LOCAL_FAULT_TEST,
    "1",
    "Set BAZAAR_LOCAL_FAULT_TEST=1 explicitly",
  );
  const state = await ready();
  assert.equal(state.aiEnabled, false, "Disable live AI before running fault tests");
  await postgresIdentity(bin, paths.postgres);
  const organizations = await sql(databaseUrl, (db) =>
    db.organization.findMany({ select: { name: true } }),
  );
  assert(
    organizations.length > 0 && organizations.every((org) => org.name.startsWith("UI QA")),
    "Fault tests only permit synthetic UI QA organizations",
  );
  const probeDb = `bazaar_local_runtime_verify_${id}`,
    restoredDb = `bazaar_local_restore_verify_${id}`;
  await adminSql(`CREATE DATABASE "${probeDb}" TEMPLATE template0`);
  await sql(connection(probeDb), async (db) => {
    await db.$executeRawUnsafe('CREATE TABLE "PersistenceProbe" (value text NOT NULL)');
    await db.$executeRaw`INSERT INTO "PersistenceProbe" (value) VALUES (${id})`;
  });
  const redis = redisClient(undefined, 15);
  await redis.connect();
  await redis.set(`local-runtime:${id}`, id);
  redis.disconnect();
  const upload = join(paths.data, `files/public-uploads/runtime-proof-${id}.png`),
    exported = join(paths.data, `files/tmp/exports/runtime-proof-${id}.bin`);
  await cp(join(root, "public/brand/icon.png"), upload);
  await mkdir(join(paths.data, "files/tmp/exports"), { recursive: true });
  await writeFile(exported, id);
  const imageHash = digest(await readFile(upload));
  const checkProbes = async () => {
    const value = await sql(connection(probeDb), (db) =>
      db.$queryRawUnsafe<Array<{ value: string }>>('SELECT value FROM "PersistenceProbe"'),
    );
    assert.deepEqual(value, [{ value: id }]);
    const client = redisClient(undefined, 15);
    try {
      await client.connect();
      assert.equal(await client.get(`local-runtime:${id}`), id);
    } finally {
      client.disconnect();
    }
    assert.equal(digest(await readFile(upload)), imageHash);
    assert.equal(await readFile(exported, "utf8"), id);
  };
  const initial = await control(root);
  await run("pnpm", ["local"], { env: testEnv });
  assert.equal((await control(root)).pid, initial.pid);
  evidence.idempotentStart = true;
  await stop();
  await start();
  await checkProbes();
  evidence.cleanRestart = true;
  const appBefore = await control(root);
  assert.equal(typeof appBefore.appPid, "number");
  assert(await isOwnedApp(Number(appBefore.appPid), paths));
  process.kill(Number(appBefore.appPid), "SIGKILL");
  await waitForService(async () => {
    const next = await ready();
    assert.notEqual(next.appPid, appBefore.appPid);
  }, 60_000);
  await checkProbes();
  evidence.appCrashRecovery = true;
  const cache = redisClient();
  await cache.connect();
  const config = (await cache.config("GET", "dir")) as string[];
  assert.equal(config[1], paths.redis);
  const redisPid = Number((await cache.info("server")).match(/process_id:(\d+)/)?.[1]);
  cache.disconnect();
  assert(redisPid > 1);
  process.kill(redisPid, "SIGKILL");
  await new Promise((done) => setTimeout(done, 2500));
  await ready();
  await checkProbes();
  evidence.redisCrashRecovery = true;
  await postgresIdentity(bin, paths.postgres);
  const pgPid = Number(
    (await readFile(join(paths.postgres, "postmaster.pid"), "utf8")).split("\n")[0],
  );
  assert(pgPid > 1);
  process.kill(pgPid, "SIGKILL");
  await new Promise((done) => setTimeout(done, 2500));
  await ready();
  await checkProbes();
  evidence.postgresCrashRecovery = true;
  // The shutdown backup is taken after the app exits, giving a stable snapshot
  // for the full132-table restore comparison before the next worker tick.
  await stop();
  const stopped = JSON.parse(await readFile(paths.status, "utf8")) as {
    phase: string;
    lastBackup: string;
  };
  assert.equal(stopped.phase, "stopped");
  const dump = stopped.lastBackup;
  assert(dump.startsWith(paths.backups + "/"));
  await start();
  const beforeRestore = await tableSnapshot();
  await adminSql(
    `CREATE DATABASE "${restoredDb}" TEMPLATE template0 LOCALE_PROVIDER icu ICU_LOCALE 'und'`,
  );
  await run(
    bin.tool("pg_restore"),
    [...pgArgs, "--exit-on-error", "--no-owner", "--dbname", restoredDb, dump],
    { env: pgEnv() },
  );
  assert.deepEqual(await snapshot(connection(restoredDb)), beforeRestore);
  evidence.backupRestore = {
    allTablesIdentical: true,
    tables: Object.keys(beforeRestore).length,
    database: restoredDb,
    dump,
  };
  const restoreDir = join(paths.data, `verification/${id}`);
  await mkdir(restoreDir, { recursive: true, mode: 0o700 });
  await restoreFiles(dump + ".files.json", join(restoreDir, "files"), paths.root);
  assert.equal(
    digest(await readFile(join(restoreDir, `files/public-uploads/runtime-proof-${id}.png`))),
    imageHash,
  );
  assert.equal(
    await readFile(join(restoreDir, `files/tmp/exports/runtime-proof-${id}.bin`), "utf8"),
    id,
  );
  evidence.fileBackupRestore = true;
  const redisRestoreDir = join(restoreDir, "redis");
  await mkdir(redisRestoreDir, { mode: 0o700 });
  await cp(dump + ".redis.rdb", join(redisRestoreDir, "dump.rdb"));
  const { assertAppPortFree } = await import("./daemon");
  await assertAppPortFree(56392);
  await run(bin.redis, [
    "--bind",
    "127.0.0.1",
    "--port",
    "56392",
    "--protected-mode",
    "yes",
    "--dir",
    redisRestoreDir,
    "--save",
    "",
    "--daemonize",
    "yes",
    "--pidfile",
    join(redisRestoreDir, "redis.pid"),
    "--logfile",
    join(redisRestoreDir, "redis.log"),
  ]);
  await waitForService(async () => {
    const client = redisClient(56392, 15);
    try {
      await client.connect();
      assert.equal(await client.get(`local-runtime:${id}`), id);
    } finally {
      client.disconnect();
    }
  });
  const restoredCache = redisClient(56392);
  await restoredCache.connect();
  assert.equal(((await restoredCache.config("GET", "dir")) as string[])[1], redisRestoreDir);
  await restoredCache.shutdown("NOSAVE").catch((error: unknown) => {
    if (!/Connection is closed/.test(String(error))) throw error;
  });
  restoredCache.disconnect();
  evidence.redisBackupRestore = true;
  evidence.finalHealth = (await ready()).health;
  evidence.providerCalls = "disabled throughout verification";
  await jsonWrite(
    join(root, "artifacts/ux/espresso/local-runtime-fault-verification.json"),
    evidence,
  );
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  await jsonWrite(join(root, "artifacts/ux/espresso/local-runtime-fault-failure.json"), {
    evidence,
    error: String(error),
  });
  console.error(error);
  process.exitCode = 1;
}
