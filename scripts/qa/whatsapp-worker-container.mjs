import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

// No .env files, host database URLs, published ports or host volume mounts.
assert.equal(
  process.env.RUN_WHATSAPP_CONTAINER_SMOKE,
  "1",
  "Explicit isolated-container opt-in required",
);
const image = process.env.WHATSAPP_WORKER_TEST_IMAGE ?? "bazaar-whatsapp-worker:ci";
assert.match(image, /^[a-zA-Z0-9._/-]+:[a-zA-Z0-9._-]+$/);
const run = promisify(execFile);
const prefix = `bazaar-wa-qa-${randomUUID().slice(0, 8)}`;
const network = `${prefix}-network`,
  postgres = `${prefix}-postgres`,
  worker = `${prefix}-worker`;
const migration = `${prefix}-migration`;
const recovery = `${prefix}-recovery`;
const password = `synthetic-${randomUUID()}`;
const database = "bazaar_hardening_whatsapp_worker";
const databaseUrl = `postgresql://inventory:${password}@${postgres}:5432/${database}`;
const output = "artifacts/whatsapp-worker-container";
const ownership = "bazaar.test.kind=whatsapp-worker-container";
const evidence = {
  isolatedOnly: true,
  image,
  externalProviders: "disabled",
  restarts: [],
  passed: false,
};
const docker = async (args, timeout = 60_000) =>
  (await run("docker", args, { timeout, maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
let daemonReady = false;
const inspect = async (name) => JSON.parse(await docker(["inspect", name]))[0];
const sql = async (query) =>
  docker(["exec", postgres, "psql", "-X", "-U", "inventory", "-d", database, "-At", "-c", query]);
async function waitFor(check, label, timeout = 45_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await check()) return;
    await delay(1000);
  }
  throw new Error(`Timed out: ${label}`);
}
async function removeOwnedContainer(name) {
  // Query existence explicitly: Docker versions use different error text when
  // an automatically removed container no longer exists.
  const id = await docker([
    "container",
    "ls",
    "--all",
    "--filter",
    `name=^/${name}$`,
    "--format",
    "{{.ID}}",
  ]);
  if (!id) return;
  assert.ok(!id.includes("\n"), "Cleanup must identify exactly one owned container");
  const item = await inspect(id);
  assert.equal(item.Name, `/${name}`);
  assert.equal(item.Config.Labels?.["bazaar.test.kind"], "whatsapp-worker-container");
  await docker(["rm", "--force", "--volumes", id]);
}
try {
  await docker(["info", "--format", "{{.ServerVersion}}"], 15_000);
  daemonReady = true;
  const configuration = (await inspect(image)).Config;
  assert.equal(configuration.User, "node", "Image must run as an unprivileged user");
  assert.deepEqual(configuration.Cmd, ["node", "--import", "tsx", "scripts/whatsapp-worker.ts"]);
  assert.ok(
    configuration.Healthcheck?.Test.some((value) => value.includes("whatsapp-worker-health.ts")),
  );
  assert.ok(
    !configuration.Env.some((value) =>
      /^(?:DATABASE_URL|DEEPSEEK_API_KEY|WHATSAPP_ENCRYPTION_KEY)=|^GUPSHUP_/.test(value),
    ),
    "No runtime credentials may be baked into the image",
  );
  await docker([
    "run",
    "--rm",
    "--network",
    "none",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,size=32m",
    "--entrypoint",
    "node",
    image,
    "-e",
    "const fs=require('node:fs');for(const p of ['/app/.env','/app/.env.local','/app/.git','/app/.local'])if(fs.existsSync(p))process.exit(1)",
  ]);
  // No database or provider exists on this network. The packaged operator CLI
  // must reject missing IDs before attempting recovery, rather than being absent.
  await assert.rejects(
    () =>
      docker([
        "run",
        "--rm",
        "--name",
        recovery,
        "--label",
        ownership,
        "--network",
        "none",
        "--read-only",
        "--tmpfs",
        "/tmp:rw,size=32m",
        "--cpus",
        "0.5",
        "--memory",
        "512m",
        "-e",
        "VERCEL_ENV=production",
        image,
        "node",
        "--import",
        "tsx",
        "scripts/whatsapp-recover-connection.ts",
      ]),
    (error) => {
      assert.equal(error.code, 1, "Recovery without IDs must refuse to run");
      assert.match(error.stderr, /Connection recovery requires configured transport and two IDs/);
      assert.doesNotMatch(error.stderr, /ERR_MODULE_NOT_FOUND|PrismaClientInitializationError/);
      return true;
    },
  );
  evidence.recoveryUsageGuard = { refused: true, network: "none", database: "not configured" };
  await docker(["network", "create", "--internal", "--label", ownership, network]);
  const networkInfo = JSON.parse(await docker(["network", "inspect", network]))[0];
  assert.equal(networkInfo.Internal, true);
  await docker(
    [
      "run",
      "--detach",
      "--name",
      postgres,
      "--label",
      ownership,
      "--network",
      network,
      "--cpus",
      "0.5",
      "--memory",
      "256m",
      "--tmpfs",
      "/var/lib/postgresql/data:rw,size=256m",
      "-e",
      `POSTGRES_DB=${database}`,
      "-e",
      "POSTGRES_USER=inventory",
      "-e",
      `POSTGRES_PASSWORD=${password}`,
      "postgres:16-alpine",
      "postgres",
      "-c",
      "shared_buffers=16MB",
      "-c",
      "max_connections=15",
    ],
    120_000,
  );
  await waitFor(async () => {
    try {
      await docker(["exec", postgres, "pg_isready", "-U", "inventory", "-d", database]);
      return true;
    } catch {
      return false;
    }
  }, "disposable PostgreSQL readiness");
  await docker(
    [
      "run",
      "--name",
      migration,
      "--label",
      ownership,
      "--network",
      network,
      "--cpus",
      "1",
      "--memory",
      "512m",
      "-e",
      `DATABASE_URL=${databaseUrl}`,
      "-e",
      "HARDENING_EXTERNAL_PROVIDER_MODE=disabled",
      image,
      "node",
      "node_modules/prisma/build/index.js",
      "migrate",
      "deploy",
    ],
    180_000,
  );
  await docker([
    "run",
    "--detach",
    "--name",
    worker,
    "--label",
    ownership,
    "--network",
    network,
    "--cpus",
    "0.5",
    "--memory",
    "512m",
    "--pids-limit",
    "128",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,size=32m",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--health-interval",
    "2s",
    "--health-timeout",
    "5s",
    "--health-start-period",
    "0s",
    "-e",
    `DATABASE_URL=${databaseUrl}`,
    "-e",
    "NODE_ENV=production",
    "-e",
    "VERCEL_ENV=production",
    "-e",
    "HARDENING_EXTERNAL_PROVIDER_MODE=disabled",
    "-e",
    "WHATSAPP_AI_ENABLED=0",
    image,
  ]);
  let previousHeartbeat = null;
  for (let round = 0; round < 2; round++) {
    if (round) await docker(["start", worker]);
    await waitFor(async () => {
      const state = (await inspect(worker)).State;
      if (!state.Running) throw new Error(`Worker exited before readiness: ${state.ExitCode}`);
      return state.Health?.Status === "healthy";
    }, "container health check");
    const heartbeat = JSON.parse(
      await sql(
        `SELECT json_build_object('state',state,'heartbeat',"heartbeatAt",'ageSeconds',EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP-"heartbeatAt"))) FROM "WhatsAppWorkerState" WHERE id='worker'`,
      ),
    );
    assert.equal(heartbeat.state, "DISABLED");
    assert.ok(heartbeat.ageSeconds >= 0 && heartbeat.ageSeconds < 15);
    assert.notEqual(heartbeat.heartbeat, previousHeartbeat, "Restart must produce a new heartbeat");
    previousHeartbeat = heartbeat.heartbeat;
    assert.equal(await docker(["exec", worker, "id", "-u"]), "1000");
    if (!round) {
      // Exercise the actual worker-container environment. Override only the
      // pure function's synthetic input so external-call disabling cannot mask
      // a missing production guard; never change the running process env.
      const guard = JSON.parse(
        await docker([
          "exec",
          worker,
          "node",
          "--import",
          "tsx",
          "--input-type=module",
          "-e",
          `import assert from 'node:assert/strict';
import { getSubscriptionPaymentConfig } from './src/server/billing/paymentConfig.ts';
assert.equal(process.env.NODE_ENV, 'production');
assert.equal(process.env.VERCEL_ENV, 'production');
const input = {
  ...process.env,
  HARDENING_EXTERNAL_PROVIDER_MODE: 'enabled',
  BILLING_PAYMENTS_MODE: 'sandbox',
  FREEDOMPAY_MERCHANT_ID: '1',
  FREEDOMPAY_SECRET_KEY: 'synthetic-1234567890',
  BILLING_SELLER_NAME: 'Synthetic',
  BILLING_TERMS_VERSION: 'synthetic',
  BILLING_PUBLIC_URL: 'https://bazaar.kg',
  BILLING_TERMS_URL: 'https://bazaar.kg/legal/offer',
};
assert.equal(getSubscriptionPaymentConfig(input).ready, false);
assert.equal(getSubscriptionPaymentConfig({ ...input, VERCEL_ENV: undefined }).ready, true);
console.log(JSON.stringify({ productionEnvironment: true, sandboxRejected: true, positiveControl: true }));`,
        ]),
      );
      assert.equal(guard.productionEnvironment, true);
      assert.equal(guard.sandboxRejected, true);
      assert.equal(guard.positiveControl, true);
      evidence.productionSandboxGuard = guard;
    }
    const started = Date.now();
    await docker(["stop", "--time", "90", worker], 100_000);
    const stopped = (await inspect(worker)).State;
    assert.equal(stopped.ExitCode, 0, "SIGTERM must complete gracefully");
    assert.equal(stopped.OOMKilled, false);
    evidence.restarts.push({
      round,
      healthy: true,
      exitCode: stopped.ExitCode,
      stopMs: Date.now() - started,
    });
  }
  assert.equal(
    await sql(
      'SELECT (SELECT count(*) FROM "WhatsAppMessage") || \'|\' || (SELECT count(*) FROM "WhatsAppInvoice")',
    ),
    "0|0",
  );
  evidence.passed = true;
} catch (error) {
  evidence.error =
    error instanceof Error ? error.message.replaceAll(password, "[synthetic-password]") : "unknown";
  if (daemonReady) {
    try {
      evidence.workerLog = (await docker(["logs", "--tail", "30", worker])).replaceAll(
        password,
        "[synthetic-password]",
      );
    } catch {
      /* Container may not have started. */
    }
  }
  process.exitCode = 1;
} finally {
  const failures = [];
  if (daemonReady) {
    for (const name of [worker, migration, recovery, postgres]) {
      try {
        await removeOwnedContainer(name);
      } catch (error) {
        failures.push({
          name,
          error:
            error instanceof Error
              ? error.message.replaceAll(password, "[synthetic-password]")
              : "unknown",
        });
      }
    }
    try {
      const id = await docker([
        "network",
        "ls",
        "--filter",
        `name=^${network}$`,
        "--format",
        "{{.ID}}",
      ]);
      if (id) {
        assert.ok(!id.includes("\n"), "Cleanup must identify exactly one owned network");
        const item = JSON.parse(await docker(["network", "inspect", id]))[0];
        assert.equal(item.Name, network);
        assert.equal(item.Labels?.["bazaar.test.kind"], "whatsapp-worker-container");
        await docker(["network", "rm", id]);
      }
    } catch (error) {
      failures.push({
        name: network,
        error:
          error instanceof Error
            ? error.message.replaceAll(password, "[synthetic-password]")
            : "unknown",
      });
    }
  }
  evidence.cleanupPassed = failures.length === 0;
  if (failures.length) {
    evidence.cleanupFailures = failures;
    process.exitCode = 1;
  }
  await mkdir(output, { recursive: true });
  await writeFile(`${output}/result.json`, JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence));
}
