import { spawn, type ChildProcess } from "node:child_process";
import {
  access,
  chmod,
  cp,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  symlink,
} from "node:fs/promises";
import { appendFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import {
  assertPersistentPath,
  databaseName,
  databaseUrl,
  digest,
  localPaths,
  ports,
  type Paths,
} from "./config";

const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));
export async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
export async function waitForService(check: () => Promise<void>, timeout = 10_000) {
  const end = Date.now() + timeout;
  let last: unknown;
  do {
    try {
      await check();
      return;
    } catch (error) {
      last = error;
    }
    await delay(50);
  } while (Date.now() < end);
  throw new Error(`Service did not become ready:${String(last)}`);
}
export async function jsonWrite(path: string, value: unknown) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temp, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(value, null, 2) + "\n");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temp, path);
    const directory = await open(dirname(path), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}
export function run(
  command: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; timeout?: number; log?: string; signal?: AbortSignal } = {},
): Promise<string> {
  return new Promise((done, reject) => {
    if (options.signal?.aborted) {
      reject(new Error("Command cancelled"));
      return;
    }
    const child = spawn(command, args, {
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let output = "",
      errors = "";
    const capture = (data: Buffer, stderr: boolean) => {
      if (stderr) errors = (errors + data.toString()).slice(-12_000);
      else output = (output + data.toString()).slice(-12_000);
      if (options.log) appendFileSync(options.log, data, { mode: 0o600 });
    };
    child.stdout.on("data", (data: Buffer) => capture(data, false));
    child.stderr.on("data", (data: Buffer) => capture(data, true));
    let interrupted = false;
    const terminate = () => {
      interrupted = true;
      try {
        if (child.pid) process.kill(-child.pid, "SIGTERM");
      } catch {
        /* already exited */
      }
      setTimeout(() => {
        try {
          if (child.pid) process.kill(-child.pid, "SIGKILL");
        } catch {
          /* process group exited */
        }
      }, 1000).unref();
    };
    const timer = setTimeout(terminate, options.timeout ?? 60_000);
    options.signal?.addEventListener("abort", terminate, { once: true });
    child.once("error", (error) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", terminate);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", terminate);
      if (code === 0 && !interrupted) done(output);
      else {
        const error = new Error(`${command.split("/").at(-1)} exited ${code}. ${errors || output}`);
        // Give escalation time to terminate owned grandchildren before exit.
        if (interrupted) setTimeout(() => reject(error), 1100);
        else reject(error);
      }
    });
  });
}
async function binary(name: string, candidates: string[]) {
  for (const candidate of candidates) if (await exists(candidate)) return candidate;
  for (const dir of (process.env.PATH ?? "").split(":")) {
    const candidate = join(dir, name);
    if (await exists(candidate)) return candidate;
  }
  throw new Error(`Install ${name} first. Local startup does not install software automatically.`);
}
export async function binaries() {
  const pg = await binary("pg_ctl", [
    "/opt/homebrew/opt/postgresql@16/bin/pg_ctl",
    "/usr/local/opt/postgresql@16/bin/pg_ctl",
  ]);
  if (!/\b16\./.test(await run(pg, ["--version"])))
    throw new Error("This local PostgreSQL data requires PostgreSQL16.");
  return {
    pg,
    tool: (name: string) => join(pg, "..", name),
    redis: await binary("redis-server", [
      "/opt/homebrew/bin/redis-server",
      "/usr/local/bin/redis-server",
    ]),
  };
}
export type Binaries = Awaited<ReturnType<typeof binaries>>;
export function pgEnv() {
  return { ...process.env, PGPASSWORD: "bazaar_test_only", PGCONNECT_TIMEOUT: "4" };
}
export const pgArgs = ["-h", "127.0.0.1", "-p", String(ports.postgres), "-U", "bazaar_test"];
export const shellLiteral = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
export function redisClient(port: number = ports.redis, db = 4) {
  const client = new Redis({
    host: "127.0.0.1",
    port,
    db,
    connectTimeout: 1200,
    commandTimeout: 2000,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
    lazyConnect: true,
  });
  client.on("error", () => undefined);
  return client;
}
export async function postgresIdentity(bin: Binaries, expected: string) {
  const actual = (
    await run(bin.tool("psql"), [...pgArgs, "-d", "postgres", "-Atc", "SHOW data_directory"], {
      env: pgEnv(),
      timeout: 6000,
    })
  ).trim();
  if (resolve(actual) !== resolve(expected))
    throw new Error(
      "PostgreSQL port belongs to another data directory. It will not be stopped or changed.",
    );
}
export async function postgresIsUp(bin: Binaries, paths: Paths) {
  const response = await run(bin.tool("pg_isready"), [...pgArgs, "-t", "1"], {
    timeout: 3000,
  }).catch(() => "");
  if (!response.includes("accepting connections")) return false;
  await postgresIdentity(bin, paths.postgres);
  return true;
}
export async function ensurePostgres(bin: Binaries, paths: Paths) {
  if (
    !(await exists(join(paths.postgres, "PG_VERSION"))) ||
    !(await exists(join(paths.postgres, "global/pg_control")))
  )
    throw new Error(
      "Persistent PostgreSQL files are missing. Automatic replacement with an older/empty database is forbidden.",
    );
  if (await postgresIsUp(bin, paths)) return;
  await run(
    bin.pg,
    [
      "-D",
      paths.postgres,
      "-l",
      join(paths.logs, "postgres.log"),
      "-o",
      `-p ${ports.postgres} -h 127.0.0.1 -k ${shellLiteral(paths.socket)} -c fsync=on -c synchronous_commit=on -c full_page_writes=on`,
      "-t",
      "30",
      "-w",
      "start",
    ],
    { timeout: 40_000 },
  );
  await postgresIdentity(bin, paths.postgres);
}
export async function backupDatabase(bin: Binaries, paths: Paths, reason: string) {
  if (!/^[a-z-]+$/.test(reason)) throw new Error("Invalid backup reason");
  await postgresIdentity(bin, paths.postgres);
  const size = Number(
    (
      await run(
        bin.tool("psql"),
        [...pgArgs, "-d", databaseName, "-Atc", "SELECT pg_database_size(current_database())"],
        { env: pgEnv() },
      )
    ).trim(),
  );
  if (!Number.isFinite(size)) throw new Error("Could not estimate database backup size");
  await (await import("./files")).requireDiskSpace(paths.root, size + 512 * 1024 ** 2);
  const file = join(
    paths.backups,
    `${new Date().toISOString().replace(/[:.]/g, "-")}-${reason}-${randomUUID().slice(0, 8)}.dump`,
  );
  const partial = file + ".partial";
  await run(bin.tool("pg_dump"), [...pgArgs, "--format=custom", "--file", partial, databaseName], {
    env: pgEnv(),
  });
  await run(bin.tool("pg_restore"), ["--list", partial]);
  await chmod(partial, 0o600);
  await rename(partial, file);
  return file;
}
export async function tableSnapshot() {
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    const tables = await db.$queryRaw<
      Array<{ tablename: string }>
    >`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
    const rows: Record<string, unknown> = {};
    for (const { tablename } of tables) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tablename)) throw new Error("Unexpected table name");
      rows[tablename] = await db.$queryRawUnsafe(
        `SELECT count(*)::int AS count,md5(coalesce(string_agg(row_to_json(t)::text,E'\\n' ORDER BY row_to_json(t)::text),'')) AS hash FROM public."${tablename}" t`,
      );
    }
    return rows;
  } finally {
    await db.$disconnect();
  }
}

/** One-time adoption copies a cleanly stopped cluster; original files remain. */
export async function preparePostgres(bin: Binaries, paths: Paths) {
  const initialized = join(paths.backups, "database-initialized.json");
  const adoptedSource = join(paths.legacyPostgres, "..", "managed-runtime-adoption.json");
  if (await exists(join(paths.postgres, "PG_VERSION"))) {
    if ((await readFile(join(paths.postgres, "PG_VERSION"), "utf8")).trim() !== "16")
      throw new Error("Unexpected local PostgreSQL data version");
    if ((await exists(join(paths.data, "adoption.json"))) && !(await exists(adoptedSource)))
      await jsonWrite(adoptedSource, {
        repository: paths.root,
        destination: paths.postgres,
        note: "Do not automatically reuse this older source after managed data loss.",
      });
    return;
  }
  if (await exists(initialized))
    throw new Error(
      "Persistent database is missing. Refusing automatic rollback to the old adoption snapshot;restore a verified backup explicitly.",
    );
  if (await exists(adoptedSource))
    throw new Error(
      "The legacy source was already adopted. Refusing to silently restore an older dataset after local data/backups disappeared.",
    );
  if ((await exists(paths.postgres)) && (await readdir(paths.postgres)).length)
    throw new Error(
      "Incomplete local PostgreSQL directory. Restore explicitly; startup will not replace it.",
    );
  if (await exists(join(paths.legacyPostgres, "PG_VERSION"))) {
    await postgresIdentity(bin, paths.legacyPostgres);
    const before = await tableSnapshot();
    // Backup helper validates its target, even during this explicit adoption.
    const backup = await backupDatabase(
      bin,
      { ...paths, postgres: paths.legacyPostgres },
      "before-adoption",
    );
    await run(bin.pg, ["-D", paths.legacyPostgres, "-m", "fast", "-t", "30", "-w", "stop"]);
    await cp(paths.legacyPostgres, paths.postgres, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    await ensurePostgres(bin, paths);
    const after = await tableSnapshot();
    if (JSON.stringify(before) !== JSON.stringify(after))
      throw new Error(
        "Local adoption row hashes differ. Original cluster and dump retained; startup stopped.",
      );
    await jsonWrite(join(paths.data, "adoption.json"), {
      from: paths.legacyPostgres,
      backup,
      tables: Object.keys(before).length,
      allRowsIdentical: true,
      date: new Date().toISOString(),
    });
    await jsonWrite(initialized, { repository: paths.root, date: new Date().toISOString() });
    await jsonWrite(adoptedSource, { repository: paths.root, destination: paths.postgres });
    return;
  }
  // A new checkout gets an empty local DB. No demo seed or password reset runs.
  await run(bin.tool("initdb"), [
    "-D",
    paths.postgres,
    "-U",
    "bazaar_test",
    "-A",
    "scram-sha-256",
    "--pwfile",
    join(paths.data, "pg-password"),
    "--locale-provider=icu",
    "--icu-locale=und",
    "--encoding=UTF8",
  ]);
  await ensurePostgres(bin, paths);
  await run(
    bin.tool("createdb"),
    [...pgArgs, "--template=template0", "--locale-provider=icu", "--icu-locale=und", databaseName],
    { env: pgEnv() },
  );
  await jsonWrite(initialized, { repository: paths.root, date: new Date().toISOString() });
}
export async function ensureRedis(bin: Binaries, paths: Paths) {
  const client = redisClient();
  try {
    await client.connect();
    const dir = (await client.config("GET", "dir")) as string[];
    if (dir[1] !== paths.redis)
      throw new Error(
        "Redis port belongs to another directory. It will not be stopped or changed.",
      );
    const policy = (await client.config("GET", "appendonly", "appendfsync")) as string[];
    const values = new Map(
      Array.from({ length: policy.length / 2 }, (_, i) => [policy[2 * i], policy[2 * i + 1]]),
    );
    if (values.get("appendonly") !== "yes" || values.get("appendfsync") !== "always")
      throw new Error("Managed Redis persistence policy differs; refusing to silently weaken it.");
    const persistence = await client.info("persistence");
    if (
      !persistence.includes("aof_last_write_status:ok") ||
      !(await exists(join(paths.redis, "appendonlydir")))
    )
      throw new Error("Redis durable storage is unavailable; refusing to declare ready.");
    if (!(await exists(join(paths.backups, "redis-initialized.json"))))
      await jsonWrite(join(paths.backups, "redis-initialized.json"), {
        repository: paths.root,
        date: new Date().toISOString(),
      });
    return;
  } catch (error) {
    if (!/ECONNREFUSED|Connection is closed|connect ETIMEDOUT/.test(String(error))) throw error;
  } finally {
    client.disconnect();
  }
  if (
    (await exists(join(paths.backups, "redis-initialized.json"))) &&
    !(await exists(join(paths.redis, "appendonlydir")))
  )
    throw new Error(
      "Redis data is missing. Refusing to replace it with an empty cache automatically.",
    );
  await run(bin.redis, [
    "--bind",
    "127.0.0.1",
    "--port",
    String(ports.redis),
    "--protected-mode",
    "yes",
    "--dir",
    paths.redis,
    "--appendonly",
    "yes",
    "--appendfsync",
    "always",
    "--save",
    "60 1",
    "--daemonize",
    "yes",
    "--pidfile",
    join(paths.redis, "redis.pid"),
    "--logfile",
    join(paths.logs, "redis.log"),
  ]);
  await waitForService(async () => {
    const ready = redisClient();
    try {
      await ready.connect();
      await ready.ping();
    } finally {
      ready.disconnect();
    }
  });
  await jsonWrite(join(paths.backups, "redis-initialized.json"), {
    repository: paths.root,
    date: new Date().toISOString(),
  });
}
export async function adoptRedis(paths: Paths) {
  const marker = join(paths.data, "redis-adoption.json");
  if (await exists(marker)) return;
  if (!(await exists(join(paths.data, "adoption.json")))) {
    await jsonWrite(marker, { copiedKeys: 0, newCheckout: true });
    return;
  }
  const source = redisClient(56390),
    target = redisClient();
  try {
    await target.connect();
    await source.connect();
    let cursor = "0",
      count = 0;
    const rows: unknown[] = [];
    do {
      const result = await source.scan(cursor, "COUNT", 100);
      cursor = result[0];
      for (const key of result[1]) {
        const capturedAt = Date.now();
        const row = (await source.callBuffer(
          "EVAL",
          "local v=redis.call('DUMP',KEYS[1]); if not v then return nil end; return {v,redis.call('PTTL',KEYS[1])}",
          "1",
          key,
        )) as [Buffer, number] | null;
        if (!row || row[1] === -2) continue;
        const value = row[0],
          ttl = row[1] < 0 ? 0 : row[1] - (Date.now() - capturedAt);
        if (row[1] >= 0 && ttl <= 0) continue;
        const previous = await target.dumpBuffer(key);
        if (previous && !previous.equals(value))
          throw new Error("Redis adoption key conflict; existing value retained.");
        if (!previous) await target.restore(key, ttl, value);
        count++;
        rows.push({ key, value: value.toString("base64"), ttl });
      }
    } while (cursor !== "0");
    await jsonWrite(join(paths.backups, `redis-adoption-${randomUUID()}.json`), rows);
    await target.save();
    await jsonWrite(marker, { copiedKeys: count, sourcePort: 56390, targetPort: ports.redis });
  } catch (error) {
    // An unavailable legacy cache is not an empty successful migration.
    throw new Error(`Redis adoption did not finish; no source keys were deleted. ${String(error)}`);
  } finally {
    source.disconnect();
    target.disconnect();
  }
}
export async function applicationFingerprint(paths: Paths) {
  const files: string[] = [];
  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (path === join(paths.root, "public/uploads")) continue;
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  for (const dir of ["src", "messages", "prisma", "public", "assets"])
    await walk(join(paths.root, dir));
  for (const file of [
    "package.json",
    "pnpm-lock.yaml",
    "next.config.mjs",
    "tsconfig.json",
    "postcss.config.cjs",
    "tailwind.config.ts",
  ])
    if (await exists(join(paths.root, file))) files.push(join(paths.root, file));
  const hashes: string[] = [];
  for (const file of files.sort())
    hashes.push(file.slice(paths.root.length) + ":" + digest(await readFile(file)));
  return digest(hashes.join("\n"));
}
export async function runtimeFingerprint(paths: Paths) {
  const hashes: string[] = [];
  for (const name of ["cli", "config", "services", "daemon", "files"])
    hashes.push(digest(await readFile(join(paths.root, `scripts/local/${name}.ts`))));
  return digest(hashes.join("\n"));
}
async function mergeFiles(source: string, target: string) {
  if (!(await exists(source))) return;
  await mkdir(target, { recursive: true, mode: 0o700 });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name),
      to = join(target, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Unexpected symlink in legacy uploaded files.");
    if (entry.isDirectory()) await mergeFiles(from, to);
    else if (entry.isFile()) {
      if (await exists(to)) {
        if (digest(await readFile(from)) !== digest(await readFile(to)))
          throw new Error("Uploaded-file collision; no file overwritten.");
      } else await cp(from, to, { errorOnExist: true, force: false });
    }
  }
}
async function persistentLink(link: string, target: string) {
  await mkdir(target, { recursive: true, mode: 0o700 });
  const previous = await lstat(link).catch(() => undefined);
  if (previous) {
    if (!previous.isSymbolicLink() || resolve(await readlink(link)) !== target)
      throw new Error("Unexpected persistent-file link; existing content retained.");
    return;
  }
  await symlink(target, link);
}
export async function prepareAppFiles(paths: Paths) {
  const standalone = join(paths.root, ".next/standalone");
  const app = join(paths.data, "app"),
    files = join(paths.data, "files");
  for (const name of ["public-uploads", "uploads", "tmp"])
    await mkdir(join(files, name), { recursive: true, mode: 0o700 });
  if (!(await exists(join(paths.data, "files-adopted.json")))) {
    for (const root of [paths.root, standalone]) {
      await mergeFiles(join(root, "public/uploads"), join(files, "public-uploads"));
      await mergeFiles(join(root, "uploads"), join(files, "uploads"));
    }
    await jsonWrite(join(paths.data, "files-adopted.json"), {
      date: new Date().toISOString(),
      originalFilesRetained: true,
    });
  }
  // The application runs outside .next: rebuilding Next cannot remove uploads.
  const skip = ["public/uploads", "uploads", "tmp"].map((name) => join(standalone, name));
  await cp(standalone, app, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (source) =>
      !source.startsWith(join(standalone, ".env")) &&
      !skip.some((path) => source === path || source.startsWith(path + sep)),
  });
  await cp(join(paths.root, ".next/static"), join(app, ".next/static"), { recursive: true });
  await mkdir(join(app, "public"), { recursive: true });
  await cp(join(paths.root, "public"), join(app, "public"), {
    recursive: true,
    filter: (source) =>
      source !== join(paths.root, "public/uploads") &&
      !source.startsWith(join(paths.root, "public/uploads") + sep),
  });
  await cp(join(paths.root, "assets"), join(app, "assets"), { recursive: true });
  for (const [link, target] of [
    ["public/uploads", "public-uploads"],
    ["uploads", "uploads"],
    ["tmp", "tmp"],
  ])
    await persistentLink(join(app, link), join(files, target));
}
export async function startApp(paths: Paths, env: NodeJS.ProcessEnv): Promise<ChildProcess> {
  const log = await open(join(paths.logs, "app.log"), "a", 0o600);
  const app = spawn(process.execPath, [join(paths.data, "app/server.js")], {
    cwd: paths.root,
    env: {
      ...env,
      TMPDIR: join(paths.data, "files/tmp"),
      TMP: join(paths.data, "files/tmp"),
      TEMP: join(paths.data, "files/tmp"),
    },
    stdio: ["ignore", log.fd, log.fd],
  });
  await new Promise<void>((done, reject) => {
    app.once("spawn", done);
    app.once("error", reject);
  });
  await log.close();
  return app;
}
export async function initializePaths(repository: string) {
  const paths = localPaths(repository);
  for (const dir of [
    paths.data,
    paths.backups,
    paths.postgres,
    paths.redis,
    paths.socket,
    paths.logs,
  ]) {
    await assertPersistentPath(paths.root, dir);
    if (dir !== paths.postgres) await mkdir(dir, { recursive: true, mode: 0o700 });
  }
  await chmod(paths.data, 0o700);
  await chmod(paths.backups, 0o700);
  return paths;
}
export async function stopPostgres(bin: Binaries, paths: Paths) {
  if (await postgresIsUp(bin, paths))
    await run(bin.pg, ["-D", paths.postgres, "-m", "fast", "-t", "30", "-w", "stop"]);
}
export async function stopRedis(paths: Paths) {
  const client = redisClient();
  try {
    await client.connect();
    const dir = (await client.config("GET", "dir")) as string[];
    if (dir[1] !== paths.redis) throw new Error("Foreign Redis directory");
    await client.shutdown("SAVE");
  } catch (error) {
    if (!/Connection is closed|ECONNREFUSED/.test(String(error))) throw error;
  } finally {
    client.disconnect();
  }
}
export async function stopChild(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  for (let n = 0; n < 100; n++) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await delay(100);
  }
  child.kill("SIGKILL");
  await new Promise<void>((done) => child.once("exit", () => done()));
}
