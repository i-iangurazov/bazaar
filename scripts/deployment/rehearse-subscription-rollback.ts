import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, open, readFile, realpath, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createServer } from "node:net";
import { setPriority } from "node:os";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { binaries } from "../local/services";
import { verifySubscriptionRollbackPackage } from "./prepare-subscription-rollback";
import {
  subscriptionRehearsalEnvironment,
  subscriptionRollbackPorts,
} from "./subscription-rollback-environment";

async function assertPortFree(port: number) {
  await new Promise<void>((done, reject) => {
    const server = createServer();
    server.once("error", () =>
      reject(new Error(`Port ${port} is already occupied; no service will be stopped`)),
    );
    server.listen(port, "127.0.0.1", () =>
      server.close((error) => (error ? reject(error) : done())),
    );
  });
}

export async function rehearseSubscriptionRollback(packagePath: string, buildBundles = false) {
  const root = process.cwd(),
    directory = await realpath(packagePath);
  const manifest = await verifySubscriptionRollbackPackage(root, directory);
  // Never reuse a previous fixture, caller DATABASE_URL, Docker Desktop or the
  // developer's persistent local application services.
  await assertPortFree(subscriptionRollbackPorts.postgres);
  await assertPortFree(subscriptionRollbackPorts.redis);
  const runtime = await mkdtemp(resolve(await realpath("/tmp"), "bazaar-subscription-rollback."));
  const databaseName = `bazaar_hardening_subscription_rollback_${Date.now()}`;
  const env = subscriptionRehearsalEnvironment(databaseName);
  const cluster = resolve(runtime, "postgres"),
    socket = resolve(runtime, "socket");
  await mkdir(socket, { mode: 0o700 });
  await writeFile(
    resolve(runtime, "owner.json"),
    JSON.stringify(
      {
        purpose: "bazaar-subscription-rollback",
        databaseName,
        ports: subscriptionRollbackPorts,
        base: manifest.base,
        release: manifest.release,
      },
      null,
      2,
    ),
    { flag: "wx", mode: 0o600 },
  );
  const bin = await binaries();
  const log = await open(resolve(directory, "subscription-rehearsal.log"), "wx", 0o600);
  const commands = new Set<ChildProcess>();
  let redis: ChildProcess | undefined,
    postgresOwned = false;
  const abort = new AbortController();
  const interrupt = () => abort.abort();
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  const terminate = (child: ChildProcess) => {
    try {
      if (child.pid) process.kill(-child.pid, "SIGTERM");
    } catch {
      /* already exited */
    }
  };
  const run = async (
    command: string,
    args: string[],
    cwd = root,
    extra: Record<string, string | undefined> = {},
    timeout = 10 * 60000,
    cleanup = false,
  ) => {
    if (!cleanup) assert(!abort.signal.aborted, "Rehearsal interrupted");
    const child: ChildProcess = spawn(command, args, {
      cwd,
      env: { ...env, ...extra } as NodeJS.ProcessEnv,
      stdio: ["ignore", log.fd, log.fd],
      detached: true,
    });
    commands.add(child);
    try {
      if (child.pid) setPriority(child.pid, 19);
    } catch {
      /* process can exit before priority assignment */
    }
    const stop = () => {
      terminate(child);
      setTimeout(() => {
        try {
          if (child.pid) process.kill(-child.pid, "SIGKILL");
        } catch {
          /* exited */
        }
      }, 2000).unref();
    };
    const timer = setTimeout(stop, timeout);
    if (!cleanup) abort.signal.addEventListener("abort", stop, { once: true });
    try {
      const code = await new Promise<number | null>((done, reject) => {
        child.once("error", reject);
        child.once("exit", done);
      });
      assert.equal(
        code,
        0,
        `${command.split("/").at(-1)} failed; inspect subscription-rehearsal.log`,
      );
    } finally {
      clearTimeout(timer);
      abort.signal.removeEventListener("abort", stop);
      commands.delete(child);
    }
  };
  const context = resolve(directory, "subscription-fixtures.json");
  // Recovery tooling may receive fixture corrections independently of the
  // application release. Actual services and Prisma clients still resolve
  // exclusively from the two byte-verified archived application trees.
  const probe = resolve(root, "scripts/deployment/subscription-rollback-probe.ts");
  const probeSha256 = createHash("sha256").update(await readFile(probe)).digest("hex");
  const require = createRequire(resolve(root, "package.json"));
  const probeVersion = (
    version: "baseline" | "release",
    phase: string,
    extra: Record<string, string | undefined> = {},
  ) =>
    run(
      process.execPath,
      ["--import", require.resolve("tsx/esm"), probe, phase],
      resolve(directory, version),
      {
        ...extra,
        TSX_TSCONFIG_PATH: resolve(directory, version, "tsconfig.json"),
        SUBSCRIPTION_ROLLBACK_CONTEXT: context,
      },
      120000,
    );
  const audit = new PrismaClient({
    datasourceUrl: env.DATABASE_URL!.replace(`/${databaseName}`, "/postgres"),
  });
  let cleanupPassed = true;
  let verification: Record<string, unknown> | null = null;
  try {
    await run(
      bin.tool("initdb"),
      [
        "-D",
        cluster,
        "-U",
        "bazaar_test",
        "--encoding=UTF8",
        "--auth-local=trust",
        "--auth-host=trust",
      ],
      root,
      {},
      30000,
    );
    // The native service has a unique marker/data directory. Cleanup is scoped
    // to it; occupied ports are never reclaimed by killing another process.
    postgresOwned = true;
    await run(
      bin.pg,
      [
        "-D",
        cluster,
        "-l",
        resolve(runtime, "postgres.log"),
        "-o",
        `-p ${subscriptionRollbackPorts.postgres} -h 127.0.0.1 -k ${socket} -c shared_buffers=32MB -c max_connections=24 -c work_mem=1MB -c maintenance_work_mem=16MB -c max_worker_processes=2 -c max_parallel_workers=0 -c fsync=on -c synchronous_commit=on`,
        "-t",
        "30",
        "-w",
        "start",
      ],
      root,
      {},
      40000,
    );
    const [identity] = await audit.$queryRaw<
      Array<{ directory: string }>
    >`SELECT current_setting('data_directory') AS directory`;
    assert.equal(
      await realpath(identity.directory),
      await realpath(cluster),
      "PostgreSQL belongs to a different runtime",
    );
    const owner = JSON.parse(await readFile(resolve(runtime, "owner.json"), "utf8"));
    assert.equal(owner.databaseName, databaseName);
    await audit.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    const ownedRedis: ChildProcess = spawn(
      bin.redis,
      [
        "--bind",
        "127.0.0.1",
        "--port",
        String(subscriptionRollbackPorts.redis),
        "--protected-mode",
        "yes",
        "--save",
        "",
        "--appendonly",
        "no",
        "--maxmemory",
        "32mb",
        "--dir",
        runtime,
        "--databases",
        "2",
      ],
      { env: env as NodeJS.ProcessEnv, stdio: ["ignore", log.fd, log.fd], detached: true },
    );
    redis = ownedRedis;
    ownedRedis.on("error", () => abort.abort());
    if (ownedRedis.pid) setPriority(ownedRedis.pid, 19);
    const client = new Redis({
      host: "127.0.0.1",
      port: subscriptionRollbackPorts.redis,
      lazyConnect: true,
      retryStrategy: () => null,
      connectTimeout: 1000,
    });
    client.on("error", () => undefined);
    try {
      let ready = false;
      for (let index = 0; index < 30; index++) {
        assert(!abort.signal.aborted, "Rehearsal interrupted during Redis startup");
        assert(ownedRedis.exitCode === null, "Owned Redis exited");
        try {
          if (client.status === "wait" || client.status === "end") await client.connect();
          await client.ping();
          ready = true;
          break;
        } catch {
          await new Promise((done) => setTimeout(done, 100));
        }
      }
      assert(ready, "Owned Redis did not start");
      assert.equal(
        ((await client.config("GET", "dir")) as string[])[1],
        runtime,
        "Redis belongs to a different runtime",
      );
    } finally {
      client.disconnect();
    }

    // Separate installs/client generation preserve the actual old Prisma API.
    // Commands, migrations and version probes always run sequentially.
    for (const version of ["baseline", "release"] as const) {
      await run(
        "pnpm",
        ["install", "--frozen-lockfile", "--ignore-scripts", "--store-dir", resolve(root, ".pnpm-store")],
        resolve(directory, version),
      );
      await run("pnpm", ["prisma:generate"], resolve(directory, version));
    }
    await run("pnpm", ["prisma:migrate"], resolve(directory, "baseline"));
    await probeVersion("baseline", "baseline-seed");
    await run("pnpm", ["prisma:migrate"], resolve(directory, "release"));
    await probeVersion("release", "upgrade-seed");
    await probeVersion("baseline", "old-runtime");
    await probeVersion("release", "return-new");
    const backup = resolve(directory, "post-rollback.dump");
    await run(bin.tool("pg_dump"), [
      "-h",
      "127.0.0.1",
      "-p",
      String(subscriptionRollbackPorts.postgres),
      "-U",
      "bazaar_test",
      "-d",
      databaseName,
      "-Fc",
      "-f",
      backup,
    ]);
    const restoredName = `${databaseName}_restore`;
    await audit.$executeRawUnsafe(`CREATE DATABASE "${restoredName}"`);
    await run(bin.tool("pg_restore"), [
      "-h",
      "127.0.0.1",
      "-p",
      String(subscriptionRollbackPorts.postgres),
      "-U",
      "bazaar_test",
      "-d",
      restoredName,
      "--exit-on-error",
      backup,
    ]);
    await probeVersion("release", "backup-verify", subscriptionRehearsalEnvironment(restoredName));
    if (buildBundles) {
      // Alias restoration uses an already built deployment and performs no
      // build-time migration. This LOCAL compilation deliberately has VERCEL=0.
      for (const version of ["baseline", "release"] as const)
        await run("pnpm", ["build"], resolve(directory, version), { NODE_ENV: "production" });
    }
    const evidence = JSON.parse(await readFile(context, "utf8"));
    assert.equal(
      createHash("sha256").update(await readFile(probe)).digest("hex"),
      probeSha256,
      "Recovery probe changed during the rehearsal",
    );
    verification = {
      status: "passed",
      strategy: manifest.strategy,
      base: manifest.base,
      release: manifest.release,
      migrations: manifest.migrations,
      runtime,
      databaseName,
      ports: subscriptionRollbackPorts,
      customerDatabaseUsed: false,
      productionChanges: false,
      providerRequests: 0,
      bundlesCompiled: buildBundles,
      tooling: { probeSha256, applicationSource: "byte-verified baseline/release archives" },
      checks: evidence.checks,
      limits: [
        "Actual versioned application services and Prisma clients were exercised; no production alias was changed.",
        "No browser hydration, device/KKM, payment provider or Vercel environment was certified by this rehearsal.",
        "Rebuild/revert of an old Git tree is not the recovery strategy: all applied SQL and paid snapshots stay in the database.",
        "New payment collection must stay disabled on the exact old deployment before any real alias restoration.",
        "Two-worker process budget and low scheduling priority reduce load; this is not a macOS hard CPU-affinity guarantee.",
      ],
    };
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    for (const child of commands) terminate(child);
    await audit.$disconnect();
    if (redis) {
      terminate(redis);
      if (redis.exitCode === null)
        await Promise.race([
          new Promise((done) => redis!.once("exit", done)),
          new Promise((done) => setTimeout(done, 3000)),
        ]);
      if (redis.exitCode === null) {
        cleanupPassed = false;
        try {
          if (redis.pid) process.kill(-redis.pid, "SIGKILL");
        } catch {
          /* exited */
        }
      }
    }
    if (postgresOwned) {
      // Only this newly initialized cluster is eligible for cleanup.
      await run(
        bin.pg,
        ["-D", cluster, "-t", "10", "-w", "-m", "fast", "stop"],
        root,
        {},
        15000,
        true,
      ).catch(() => {
        cleanupPassed = false;
      });
    }
    await writeFile(
      resolve(directory, "subscription-cleanup.json"),
      JSON.stringify(
        {
          cleanupPassed,
          runtime,
          ports: subscriptionRollbackPorts,
          preservedFixtureForInspection: true,
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
    await log.close();
    assert(cleanupPassed, "Owned runtime cleanup needs inspection; see subscription-cleanup.json");
  }
  assert(verification, "Rehearsal did not complete");
  await writeFile(
    resolve(directory, "subscription-verification.json"),
    JSON.stringify(verification, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  return verification;
}

async function main() {
  const { values } = parseArgs({
    options: { package: { type: "string" }, build: { type: "boolean", default: false } },
  });
  assert(values.package, "Pass --package <prepared-artifacts-directory> [--build]");
  console.log(
    JSON.stringify(await rehearseSubscriptionRollback(values.package, values.build), null, 2),
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Subscription rehearsal failed");
    process.exitCode = 1;
  });
