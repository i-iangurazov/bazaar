import { createServer, request } from "node:http";
import { createServer as tcpServer } from "node:net";
import { randomBytes } from "node:crypto";
import { appendFile, link, open, readFile, rm, writeFile, cp, chmod } from "node:fs/promises";
import { join } from "node:path";
import { type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { healthIsReady, localEnvironment, ports, type Paths, type Secrets } from "./config";
import { requireDiskSpace, snapshotFiles } from "./files";
import {
  adoptRedis,
  applicationFingerprint,
  backupDatabase,
  binaries,
  ensurePostgres,
  ensureRedis,
  exists,
  initializePaths,
  jsonWrite,
  prepareAppFiles,
  preparePostgres,
  redisClient,
  runtimeFingerprint,
  run,
  startApp,
  stopChild,
  stopPostgres,
  stopRedis,
  type Binaries,
} from "./services";

export type Manifest = { version: 1; repository: string; secrets: Secrets };
export async function loadManifest(repository: string): Promise<Manifest> {
  const paths = await initializePaths(repository);
  if (await exists(paths.manifest)) {
    const manifest = JSON.parse(await readFile(paths.manifest, "utf8")) as Manifest;
    if (
      manifest.version !== 1 ||
      manifest.repository !== paths.root ||
      ["auth", "cron", "jobs", "health", "control"].some(
        (key) =>
          typeof manifest.secrets?.[key as keyof Secrets] !== "string" ||
          manifest.secrets[key as keyof Secrets].length < 32,
      )
    )
      throw new Error("Local manifest belongs to another checkout or is invalid.");
    return manifest;
  }
  if (await exists(join(paths.backups, "identity.json")))
    throw new Error(
      "Local manifest is missing but persistent backups exist. Restore explicitly;startup will not create a new empty environment.",
    );
  const secrets = Object.fromEntries(
    ["auth", "cron", "jobs", "health", "control"].map((key) => [
      key,
      randomBytes(32).toString("hex"),
    ]),
  ) as Secrets;
  const manifest: Manifest = { version: 1, repository: paths.root, secrets };
  // Exclusive create: parallel first launches cannot replace each other's secrets.
  const temp = paths.manifest + "." + randomBytes(8).toString("hex");
  await jsonWrite(temp, manifest);
  try {
    await link(temp, paths.manifest);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return loadManifest(repository);
  } finally {
    await rm(temp, { force: true });
  }
  await jsonWrite(join(paths.backups, "identity.json"), { repository: paths.root, version: 1 });
  return manifest;
}
export async function control(repository: string, path = "/status") {
  const paths = await initializePaths(repository),
    manifest = await loadManifest(repository);
  return new Promise<Record<string, unknown>>((done, reject) => {
    const req = request(
      {
        socketPath: paths.control,
        path,
        method: path === "/status" ? "GET" : "POST",
        headers: { "x-local-secret": manifest.secrets.control },
        timeout: path === "/backup" ? 90_000 : 4000,
      },
      (response) => {
        let body = "";
        response.on("data", (part) => {
          body += part;
        });
        response.on("end", () => {
          try {
            const value = JSON.parse(body) as Record<string, unknown>;
            response.statusCode === 200 ? done(value) : reject(new Error(String(value.error)));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.once("error", reject);
    req.once("timeout", () => req.destroy(new Error("Local supervisor did not respond")));
    req.end();
  });
}
export async function assertAppPortFree(port: number = ports.app) {
  await new Promise<void>((done, reject) => {
    const server = tcpServer();
    server.once("error", () =>
      reject(
        new Error(`Port${port} is already occupied. No unrelated process will be terminated.`),
      ),
    );
    server.listen(port, "127.0.0.1", () => server.close(() => done()));
  });
}
export async function isOwnedApp(pid: number, paths: Paths) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  // Next changes process.title, so ps cannot establish ownership. Verify both
  // the actual working directory and the listener owned by the recorded PID.
  const cwd = await run("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]).catch(() => "");
  const listener = await run("lsof", [
    "-a",
    "-p",
    String(pid),
    `-iTCP:${ports.app}`,
    "-sTCP:LISTEN",
    "-t",
  ]).catch(() => "");
  return cwd.split("\n").includes("n" + join(paths.data, "app")) && listener.trim() === String(pid);
}

export async function daemon(repository: string) {
  const paths = await initializePaths(repository),
    manifest = await loadManifest(repository);
  const orphan = await readFile(paths.status, "utf8")
    .then((text) => JSON.parse(text) as { appPid?: number })
    .catch(() => null);
  const require = createRequire(import.meta.url);
  createRequire(require.resolve("next/package.json"))("@next/env").loadEnvConfig(paths.root, false);
  const aiEnabled = process.env.BAZAAR_LOCAL_AI !== "disabled";
  const env = localEnvironment(process.env, manifest.secrets, aiEnabled);
  const buildEnv = localEnvironment(process.env, manifest.secrets, false);
  const state: Record<string, unknown> = {
    phase: "starting",
    pid: process.pid,
    url: `http://localhost:${ports.app}`,
    aiEnabled,
    date: new Date().toISOString(),
    restarts: 0,
    runtimeFingerprint: await runtimeFingerprint(paths),
  };
  let app: ChildProcess | undefined,
    bin: Binaries | undefined,
    stopping = false,
    tickBusy = false,
    lastBackup = 0,
    healthFailures = 0;
  let startupActive = true;
  const buildAbort = new AbortController();
  const workers = new Map<string, number>();
  const workerBusy = new Set<string>();
  const log = async (message: string) => {
    await appendFile(
      join(paths.logs, "supervisor.log"),
      `${new Date().toISOString()} ${message}\n`,
      { mode: 0o600 },
    ).catch(() => {
      process.stderr.write("Local supervisor log could not be written.\n", () => undefined);
    });
  };
  const saveState = () => {
    state.date = new Date().toISOString();
    return jsonWrite(paths.status, { ...state, appPid: app?.pid }).catch((error: unknown) => {
      state.stateFileError = String(error);
      process.stderr.write(
        "Local status file could not be written;in-memory control remains available.\n",
        () => undefined,
      );
    });
  };
  const lock = await open(paths.lock, "wx", 0o600).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
    const previous = JSON.parse(await readFile(paths.lock, "utf8")) as { pid: number };
    try {
      process.kill(previous.pid, 0);
    } catch (probe) {
      if ((probe as NodeJS.ErrnoException).code !== "ESRCH") throw probe;
      await rm(paths.lock);
      return open(paths.lock, "wx", 0o600);
    }
    throw new Error("Local supervisor is already running or its live lock requires inspection.");
  });
  await lock.writeFile(JSON.stringify({ pid: process.pid }));
  await lock.close();
  await rm(paths.control, { force: true });
  let backupBusy: Promise<string> | undefined;
  const backup = (reason: string) => {
    if (!bin) return Promise.reject(new Error("PostgreSQL is not ready"));
    if (!backupBusy)
      backupBusy = backupDatabase(bin, paths, reason)
        .then(async (file) => {
          // Uploads/exports have their own persistent tree and a matching snapshot.
          if (await exists(join(paths.data, "files")))
            await snapshotFiles(join(paths.data, "files"), paths.backups, file + ".files.json");
          const redis = redisClient();
          try {
            await redis.connect();
            await redis.save();
            await cp(join(paths.redis, "dump.rdb"), file + ".redis.rdb", {
              errorOnExist: true,
              force: false,
            });
            await chmod(file + ".redis.rdb", 0o600);
          } finally {
            redis.disconnect();
          }
          state.lastBackup = file;
          lastBackup = Date.now();
          await saveState();
          return file;
        })
        .finally(() => {
          backupBusy = undefined;
        });
    return backupBusy;
  };
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = () =>
    (shutdownPromise ??= (async () => {
      stopping = true;
      state.phase = "stopping";
      await saveState();
      buildAbort.abort();
      while (startupActive || tickBusy) await new Promise((done) => setTimeout(done, 100));
      await stopChild(app);
      app = undefined;
      const stopErrors: string[] = [];
      if (bin) {
        await backup("shutdown").catch((error: unknown) =>
          log(`Shutdown backup failed:${String(error)}`),
        );
        await stopRedis(paths).catch((error: unknown) => {
          stopErrors.push(String(error));
        });
        await stopPostgres(bin, paths).catch((error: unknown) => {
          stopErrors.push(String(error));
        });
      }
      state.phase = stopErrors.length ? "stopped-with-errors" : "stopped";
      state.stopErrors = stopErrors;
      await saveState();
      await rm(paths.lock, { force: true });
      server.close();
      await rm(paths.control, { force: true });
    })());
  const server = createServer((req, res) => {
    if (req.headers["x-local-secret"] !== manifest.secrets.control) {
      res.writeHead(403);
      res.end(JSON.stringify({ error: "Forbidden" }));
      return;
    }
    const reply = (value: unknown, status = 200) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    if (req.url === "/status" && req.method === "GET") {
      void saveState();
      reply(state);
    } else if (req.url === "/stop" && req.method === "POST") {
      reply({ stopping: true });
      void shutdown().then(() => process.exit(0));
    } else if (req.url === "/backup" && req.method === "POST") {
      void backup("manual").then(
        (file) => reply({ backup: file }),
        (error: unknown) => reply({ error: String(error) }, 500),
      );
    } else reply({ error: "Unknown local command" }, 404);
  });
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(paths.control, done);
  });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
    process.on(signal, () => {
      void shutdown().then(() => process.exit(0));
    });
  const health = async () => {
    const response = await fetch(`http://127.0.0.1:${ports.app}/api/health`, {
      headers: { "x-health-secret": manifest.secrets.health },
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw new Error(`App health HTTP${response.status}`);
    const body = (await response.json()) as Record<string, unknown>;
    if (!healthIsReady(body)) throw new Error(`App is not ready:${JSON.stringify(body)}`);
    return body;
  };
  const launchApp = async () => {
    await assertAppPortFree();
    app = await startApp(paths, env);
    state.appPid = app.pid;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (stopping) return;
      if (app.exitCode !== null || app.signalCode !== null)
        throw new Error("Bazaar exited during startup. See app.log.");
      try {
        state.health = await health();
        return;
      } catch {
        await new Promise((done) => setTimeout(done, 500));
      }
    }
    throw new Error("Bazaar did not become ready in30seconds. See app.log.");
  };
  try {
    // Recover only an orphan whose recorded PID still runs this exact local app.
    // A busy unrelated port is handled by assertAppPortFree without killing it.
    if (orphan?.appPid) {
      if (await isOwnedApp(orphan.appPid, paths)) {
        process.kill(orphan.appPid, "SIGTERM");
        for (let i = 0; i < 100; i++) {
          try {
            process.kill(orphan.appPid, 0);
          } catch {
            break;
          }
          await new Promise((done) => setTimeout(done, 100));
        }
      }
    }
    await assertAppPortFree();
    await requireDiskSpace(paths.root);
    bin = await binaries();
    await writeFile(join(paths.data, "pg-password"), "bazaar_test_only\n", { mode: 0o600 });
    await preparePostgres(bin, paths);
    if (stopping) return;
    await rm(join(paths.data, "pg-password"), { force: true });
    await ensurePostgres(bin, paths);
    await ensureRedis(bin, paths);
    await adoptRedis(paths);
    await backup("startup-before-migrate");
    state.phase = "migrating";
    await saveState();
    // deploy only applies pending migrations; reset/push/seed are never invoked.
    await run("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      env: buildEnv,
      timeout: 120_000,
      log: join(paths.logs, "migrations.log"),
    });
    if (stopping) return;
    const fingerprint = await applicationFingerprint(paths),
      buildStamp = join(paths.data, "build.json");
    const previous = (await exists(buildStamp))
      ? (JSON.parse(await readFile(buildStamp, "utf8")) as { fingerprint: string; buildId: string })
      : undefined;
    const buildIdPath = join(paths.root, ".next/BUILD_ID");
    const buildId = (await exists(buildIdPath)) ? (await readFile(buildIdPath, "utf8")).trim() : "";
    if (
      previous?.fingerprint !== fingerprint ||
      previous.buildId !== buildId ||
      !(await exists(join(paths.root, ".next/standalone/server.js")))
    ) {
      state.phase = "building";
      await requireDiskSpace(paths.root, 3 * 1024 ** 3);
      await saveState();
      await run("pnpm", ["build"], {
        env: buildEnv,
        timeout: 15 * 60_000,
        log: join(paths.logs, "build.log"),
        signal: buildAbort.signal,
      });
      await jsonWrite(buildStamp, {
        fingerprint,
        buildId: (await readFile(buildIdPath, "utf8")).trim(),
      });
    }
    if (stopping) return;
    await prepareAppFiles(paths);
    await backup("startup-files-ready");
    state.phase = "starting-app";
    await saveState();
    await launchApp();
    state.phase = "ready";
    await saveState();
    await log("Local Bazaar,PostgreSQL,Redis and job runner ready.");
    const timer = setInterval(() => {
      void tick();
    }, 2000);
    const tick = async () => {
      if (tickBusy || stopping || !bin) return;
      tickBusy = true;
      try {
        await requireDiskSpace(paths.root);
        await ensurePostgres(bin, paths);
        await ensureRedis(bin, paths);
        if (stopping) return;
        if (!app || app.exitCode !== null || app.signalCode !== null) {
          state.phase = "recovering-app";
          await saveState();
          await launchApp();
          state.restarts = Number(state.restarts) + 1;
        }
        state.health = await health();
        if (stopping) return;
        healthFailures = 0;
        state.phase = "ready";
        delete state.error;
        if (Date.now() - lastBackup > 30 * 60_000) await backup("periodic");
        for (const [group, interval] of [
          ["recovery", 30_000],
          ["email", 60_000],
          ["maintenance", 6 * 60 * 60_000],
        ] as const) {
          if (
            !workerBusy.has(group) &&
            Date.now() - (workers.get(group) ?? Date.now()) >= interval
          ) {
            workers.set(group, Date.now());
            workerBusy.add(group);
            void fetch(`http://127.0.0.1:${ports.app}/api/jobs/cron/${group}`, {
              headers: { Authorization: `Bearer ${manifest.secrets.cron}` },
              signal: AbortSignal.timeout(6 * 60_000),
            })
              .then(async (response) => {
                state[`jobs:${group}`] = { status: response.status, at: new Date().toISOString() };
                if (!response.ok) await log(`Job group${group} returned${response.status}.`);
              })
              .catch((error: unknown) => log(`Job group${group} failed:${String(error)}`))
              .finally(() => workerBusy.delete(group));
          } else if (!workers.has(group)) workers.set(group, Date.now());
        }
        await saveState();
      } catch (error) {
        state.phase = String(error).includes("Not enough disk space")
          ? "disk-space-blocked"
          : "recovering";
        state.error = String(error);
        if (++healthFailures >= 3) {
          await stopChild(app);
          app = undefined;
          healthFailures = 0;
        }
        await saveState();
        await log(`Recovery retry:${String(error)}`);
      } finally {
        tickBusy = false;
      }
    };
    process.once("exit", () => clearInterval(timer));
  } catch (error) {
    if (stopping) return;
    state.phase = "failed";
    state.error = String(error);
    await saveState();
    await log(String(error));
    await stopChild(app);
    app = undefined;
    // Keep owned durable services available for inspection after a build failure.
    server.close();
    await rm(paths.control, { force: true });
    await rm(paths.lock, { force: true });
    throw error;
  } finally {
    startupActive = false;
  }
}
