import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createServer } from "node:net";
import { execFileSync } from "node:child_process";
import {
  assertPersistentPath,
  databaseUrl,
  healthIsReady,
  localEnvironment,
  localPaths,
  type Secrets,
} from "../../scripts/local/config";
import { assertAppPortFree, loadManifest } from "../../scripts/local/daemon";
import { requireDiskSpace, restoreFiles, snapshotFiles } from "../../scripts/local/files";
import {
  ensurePostgres,
  preparePostgres,
  run,
  shellLiteral,
  waitForService,
} from "../../scripts/local/services";

const cleanup: string[] = [];
const secrets: Secrets = {
  auth: "a".repeat(64),
  cron: "c".repeat(64),
  jobs: "j".repeat(64),
  health: "h".repeat(64),
  control: "x".repeat(64),
};
async function temporaryRepository() {
  await mkdir(resolve(".local/unit-test-checkouts"), { recursive: true });
  const root = await mkdtemp(resolve(".local/unit-test-checkouts/repo-"));
  cleanup.push(root);
  return root;
}
afterEach(async () => {
  for (const root of cleanup.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("persistent local runtime boundaries", () => {
  it("overrides every database transport and destructive test flag", () => {
    const env = localEnvironment(
      {
        DATABASE_URL: "postgresql://private:secret@customer.example/production",
        DATABASE_URL_UNPOOLED: "postgresql://private:secret@direct.example/production",
        POSTGRES_URL_NON_POOLING: "another-production-url",
        DIRECT_URL: "production",
        RUN_DB_TESTS: "1",
        ALLOW_TEST_DB_RESET: "1",
        VERCEL: "1",
        VERCEL_ENV: "production",
        REDIS_URL: "redis://customer.example:6379",
        FREEDOMPAY_SECRET_KEY: "real-payment-secret",
        RESEND_API_KEY: "real-mail-secret",
        R2_SECRET_ACCESS_KEY: "real-storage-secret",
      },
      secrets,
      true,
    );
    for (const key of [
      "DATABASE_URL",
      "DATABASE_TEST_URL",
      "DATABASE_URL_UNPOOLED",
      "POSTGRES_URL_NON_POOLING",
      "DIRECT_URL",
    ])
      expect(env[key]).toBe(databaseUrl);
    expect(env).toMatchObject({
      RUN_DB_TESTS: "0",
      ALLOW_TEST_DB_RESET: "0",
      VERCEL: undefined,
      VERCEL_ENV: "development",
      REDIS_URL: "redis://127.0.0.1:56391/4",
      FREEDOMPAY_SECRET_KEY: "",
      BILLING_PAYMENTS_MODE: "disabled",
      EMAIL_PROVIDER: "log",
      RESEND_API_KEY: "",
      R2_SECRET_ACCESS_KEY: "",
      NEXTAUTH_SECRET: secrets.auth,
    });
    expect(JSON.stringify(env)).not.toContain("customer.example");
  });
  it("keeps all live AI providers disabled for automated verification", () => {
    const env = localEnvironment(
      {
        DEEPSEEK_API_KEY: "live-deepseek",
        OPENAI_API_KEY: "live-openai",
        BAAM_TRANSCRIPTION_MODEL: "external-model",
        AI_PROVIDER: "deepseek",
      },
      secrets,
      false,
    );
    expect(env.DEEPSEEK_API_KEY).toBe("");
    expect(env.OPENAI_API_KEY).toBe("");
    expect(env.BAAM_TRANSCRIPTION_MODEL).toBe("");
    expect(env.HARDENING_EXTERNAL_PROVIDER_MODE).toBe("disabled");
  });
  it("retains configured AI settings for manual use without inheriting payment keys", () => {
    const env = localEnvironment(
      {
        DEEPSEEK_API_KEY: "manual-key",
        AI_PROVIDER: "deepseek",
        BAAM_TRANSCRIPTION_MODEL: "manual-model",
        M_MARKET_API_KEY: "market-secret",
      },
      secrets,
      true,
    );
    expect(env.DEEPSEEK_API_KEY).toBe("manual-key");
    expect(env.BAAM_TRANSCRIPTION_MODEL).toBe("manual-model");
    expect(env.M_MARKET_API_KEY).toBe("");
  });
  it("does not accept a superficial anonymous health response", () => {
    expect(healthIsReady({ status: "ok" })).toBe(false);
    expect(healthIsReady({ status: "ok", db: "up", redis: "down", migrations: "ok" })).toBe(false);
    expect(healthIsReady({ status: "ok", db: "up", redis: "up", migrations: "pending" })).toBe(
      false,
    );
    expect(healthIsReady({ status: "ok", db: "up", redis: "up", migrations: "ok" })).toBe(true);
  });
  it("rejects temporary roots and an external data directory", async () => {
    await expect(
      assertPersistentPath("/private/tmp/bazaar", "/private/tmp/bazaar/.local/data"),
    ).rejects.toThrow("temporary");
    const root = await temporaryRepository();
    await expect(assertPersistentPath(root, resolve(root, "../outside"))).rejects.toThrow("inside");
  });
  it("rejects symlink escapes instead of following them", async () => {
    const root = await temporaryRepository();
    await symlink("/private/tmp", join(root, ".local"));
    await expect(assertPersistentPath(root, join(root, ".local/data"))).rejects.toThrow("symlinks");
  });
  it("creates one private manifest under parallel launch and preserves secrets", async () => {
    const root = await temporaryRepository();
    const values = await Promise.all(Array.from({ length: 5 }, () => loadManifest(root)));
    expect(values.every((value) => JSON.stringify(value) === JSON.stringify(values[0]))).toBe(true);
    expect(await loadManifest(root)).toEqual(values[0]);
    expect((await stat(localPaths(root).manifest)).mode & 0o777).toBe(0o600);
  });
  it("does not replace a foreign or incomplete manifest", async () => {
    const root = await temporaryRepository();
    const original = await loadManifest(root);
    const path = localPaths(root).manifest;
    const invalid = JSON.stringify({ ...original, repository: "/another-checkout" });
    await writeFile(path, invalid);
    await expect(loadManifest(root)).rejects.toThrow("invalid");
    expect(await readFile(path, "utf8")).toBe(invalid);
    await writeFile(path, JSON.stringify({ ...original, secrets: {} }));
    await expect(loadManifest(root)).rejects.toThrow("invalid");
  });
  it("refuses to create a new environment after its manifest disappeared", async () => {
    const root = await temporaryRepository();
    await loadManifest(root);
    await rm(localPaths(root).manifest);
    await expect(loadManifest(root)).rejects.toThrow("backups exist");
  });
  it("does not silently roll back a lost database to its old adoption source", async () => {
    const root = await temporaryRepository();
    await loadManifest(root);
    const paths = localPaths(root);
    await writeFile(join(paths.backups, "database-initialized.json"), "{}");
    await expect(
      preparePostgres(
        { pg: "must-not-run", redis: "must-not-run", tool: () => "must-not-run" },
        paths,
      ),
    ).rejects.toThrow("Refusing automatic rollback");
  });
  it("will not restart a PostgreSQL cluster with missing internal files", async () => {
    const root = await temporaryRepository();
    await loadManifest(root);
    const paths = localPaths(root);
    await mkdir(paths.postgres);
    await writeFile(join(paths.postgres, "PG_VERSION"), "16");
    await expect(
      ensurePostgres(
        { pg: "must-not-run", redis: "must-not-run", tool: () => "must-not-run" },
        paths,
      ),
    ).rejects.toThrow("Automatic replacement");
  });
  it("never reuses a stale adoption source when managed data and backups vanished", async () => {
    const root = await temporaryRepository();
    await loadManifest(root);
    const paths = localPaths(root);
    await mkdir(join(paths.legacyPostgres, ".."), { recursive: true });
    await writeFile(join(paths.legacyPostgres, "..", "managed-runtime-adoption.json"), "{}");
    await expect(
      preparePostgres(
        { pg: "must-not-run", redis: "must-not-run", tool: () => "must-not-run" },
        paths,
      ),
    ).rejects.toThrow("already adopted");
  });
  it("does not kill or take over an unrelated busy TCP port", async () => {
    const server = createServer();
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw Error("No port");
      await expect(assertAppPortFree(address.port)).rejects.toThrow("occupied");
      expect(server.listening).toBe(true);
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });
  it("quotes PostgreSQL socket paths without shell expansion", () => {
    const path = "/project/owner's $(printf BAD) `printf BAD`/socket";
    expect(
      execFileSync("sh", ["-c", `printf %s ${shellLiteral(path)}`], { encoding: "utf8" }),
    ).toBe(path);
  });
  it("bounds a failed startup command rather than waiting indefinitely", async () => {
    await expect(
      run(process.execPath, ["-e", "setInterval(()=>{},1000)"], { timeout: 50 }),
    ).rejects.toThrow("exited");
  });
  it("waits for real service readiness after a daemon has forked", async () => {
    let checks = 0;
    await waitForService(async () => {
      if (++checks < 3) throw Error("Connection is closed");
    }, 1000);
    expect(checks).toBe(3);
    await expect(
      waitForService(async () => {
        throw Error("Still starting");
      }, 1),
    ).rejects.toThrow("did not become ready");
  });
  it("cancels a build process group without leaving a child process", async () => {
    const root = await temporaryRepository(),
      pidFile = join(root, "child.pid"),
      abort = new AbortController();
    const source = `const fs=require('fs'),{spawn}=require('child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(process.argv[1],String(c.pid));setInterval(()=>{},1000);`;
    const running = run(process.execPath, ["-e", source, pidFile], { signal: abort.signal });
    const outcome = expect(running).rejects.toThrow("exited");
    await waitForService(async () => {
      await readFile(pidFile);
    }, 2000);
    const pid = Number(await readFile(pidFile, "utf8"));
    abort.abort();
    await outcome;
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
    expect(alive).toBe(false);
  });
  it("keeps each backup version while storing identical file content only once", async () => {
    const root = await temporaryRepository(),
      source = join(root, "source"),
      backups = join(root, "backups");
    await mkdir(source);
    await mkdir(backups);
    await writeFile(join(source, "a.bin"), "original");
    await writeFile(join(source, "b.bin"), "original");
    const first = join(backups, "first.json"),
      second = join(backups, "second.json");
    await snapshotFiles(source, backups, first);
    expect(await readdir(join(backups, "objects"))).toHaveLength(1);
    await writeFile(join(source, "a.bin"), "updated");
    await snapshotFiles(source, backups, second);
    expect(await readdir(join(backups, "objects"))).toHaveLength(2);
    await restoreFiles(first, join(root, "restore-old"), root);
    await restoreFiles(second, join(root, "restore-new"), root);
    expect(await readFile(join(root, "restore-old/a.bin"), "utf8")).toBe("original");
    expect(await readFile(join(root, "restore-new/a.bin"), "utf8")).toBe("updated");
    expect(await readFile(join(root, "restore-new/b.bin"), "utf8")).toBe("original");
  });
  it("refuses unsafe restore paths and corrupted file objects", async () => {
    const root = await temporaryRepository(),
      source = join(root, "source"),
      backups = join(root, "backups");
    await mkdir(source);
    await mkdir(backups);
    await writeFile(join(source, "a"), "content");
    const manifest = join(backups, "snapshot.json"),
      value = await snapshotFiles(source, backups, manifest);
    await writeFile(join(backups, "objects", value.files[0].sha256), "corrupted");
    await expect(restoreFiles(manifest, join(root, "restore"), root)).rejects.toThrow(
      "hash mismatch",
    );
    await writeFile(
      manifest,
      JSON.stringify({ version: 1, files: [{ ...value.files[0], path: "../outside" }] }),
    );
    await expect(restoreFiles(manifest, join(root, "restore"), root)).rejects.toThrow("Unsafe");
  });
  it("fails clearly before an operation that exceeds available disk space", async () => {
    const root = await temporaryRepository();
    await expect(requireDiskSpace(root, Number.MAX_SAFE_INTEGER)).rejects.toThrow(
      "Not enough disk space",
    );
  });
});
