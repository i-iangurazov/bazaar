import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  prepareSubscriptionRollback,
  reviewSubscriptionRollback,
  subscriptionReleaseMigrations,
  verifySubscriptionRollbackPackage,
} from "../../scripts/deployment/prepare-subscription-rollback";
import {
  assertSubscriptionRehearsalEnvironment,
  subscriptionRehearsalEnvironment,
  subscriptionRollbackPorts,
} from "../../scripts/deployment/subscription-rollback-environment";

const temporary: string[] = [];
afterEach(async () => {
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true });
});
async function fixture() {
  const root = await realpath(
    await mkdtemp(resolve(tmpdir(), "bazaar-subscription-recovery-unit-")),
  );
  temporary.push(root);
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
      encoding: "utf8",
    }).trim();
  git("init", "-q");
  git("config", "user.name", "Synthetic recovery QA");
  git("config", "user.email", "recovery@example.invalid");
  const put = async (path: string, data: string | Buffer) => {
    await mkdir(resolve(root, path, ".."), { recursive: true });
    await writeFile(resolve(root, path), data);
  };
  const commit = (message: string) => {
    git("add", ".");
    git("commit", "-qm", message);
    return git("rev-parse", "HEAD");
  };
  await put(".gitignore", "artifacts/\n");
  await mkdir(resolve(root, "artifacts"));
  await put("prisma/migrations/baseline/migration.sql", "-- baseline\n");
  await put("src/service.ts", "baseline service\n");
  const base = commit("baseline");
  const approvals: Record<string, string> = {};
  for (const name of subscriptionReleaseMigrations) {
    const sql = `-- synthetic ${name}\n`;
    await put(`prisma/migrations/${name}/migration.sql`, sql);
    approvals[name] = createHash("sha256").update(sql).digest("hex");
  }
  await put(
    "scripts/deployment/migrations.ts",
    `export const approvedProductionMigrations = ${JSON.stringify(approvals, null, 2)} as const;\n`,
  );
  await put("src/service.ts", "new service\n");
  await put("src/new.ts", "new behavior\n");
  const release = commit("release");
  return {
    root,
    git,
    put,
    commit,
    base,
    release,
    approvals,
    output: resolve(root, "artifacts/recovery"),
  };
}

describe("subscription alias recovery preparation", () => {
  it("packages exact old/new source versions, retains every migration and leaves refs/index/work untouched", async () => {
    const f = await fixture();
    await f.put("unrelated.txt", "keep local work");
    const before = f.git("status", "--porcelain");
    const manifest = await prepareSubscriptionRollback(
      f.root,
      f.base,
      f.release,
      f.output,
      f.approvals,
    );
    expect(manifest).toMatchObject({
      status: "prepared-not-rehearsed",
      databaseWrites: 0,
      refsChanged: false,
    });
    expect(manifest.migrations).toHaveLength(8);
    expect(await readFile(resolve(f.output, "baseline/src/service.ts"), "utf8")).toBe(
      "baseline service\n",
    );
    expect(await readFile(resolve(f.output, "release/src/service.ts"), "utf8")).toBe(
      "new service\n",
    );
    expect(await verifySubscriptionRollbackPackage(f.root, f.output, f.approvals)).toEqual(
      manifest,
    );
    expect(f.git("rev-parse", "HEAD")).toBe(f.release);
    expect(f.git("status", "--porcelain")).toBe(before);
    expect(f.git("diff", "--cached")).toBe("");
    await expect(
      prepareSubscriptionRollback(f.root, f.base, f.release, f.output, f.approvals),
    ).rejects.toThrow();
  });
  it("requires exact frozen approvals instead of automatically approving current SQL", async () => {
    const f = await fixture();
    expect(() => reviewSubscriptionRollback(f.root, f.base, f.release, {})).toThrow(
      "frozen production approval",
    );
    const uncommitted = await fixture();
    await uncommitted.put(
      "scripts/deployment/migrations.ts",
      "export const approvedProductionMigrations = {} as const;\n",
    );
    expect(() =>
      reviewSubscriptionRollback(
        uncommitted.root,
        uncommitted.base,
        uncommitted.commit("missing committed approvals"),
        uncommitted.approvals,
      ),
    ).toThrow("Approval is missing from the committed release");
    await f.put(`prisma/migrations/${subscriptionReleaseMigrations[2]}/migration.sql`, "changed\n");
    expect(() =>
      reviewSubscriptionRollback(f.root, f.base, f.commit("changed new SQL"), f.approvals),
    ).toThrow("frozen production approval");
  });
  it("rejects extra migration files and edits of already deployed migration history", async () => {
    const f = await fixture();
    await f.put("prisma/migrations/extra/migration.sql", "unknown\n");
    expect(() =>
      reviewSubscriptionRollback(f.root, f.base, f.commit("extra migration"), f.approvals),
    ).toThrow("eight reviewed");
    const other = await fixture();
    await other.put("prisma/migrations/baseline/migration.sql", "changed baseline\n");
    expect(() =>
      reviewSubscriptionRollback(
        other.root,
        other.base,
        other.commit("changed old SQL"),
        other.approvals,
      ),
    ).toThrow("Existing migration changed");
  });
  it("detects packaged code/archive changes and refuses extra environment files before execution", async () => {
    const f = await fixture();
    await prepareSubscriptionRollback(f.root, f.base, f.release, f.output, f.approvals);
    await writeFile(resolve(f.output, "baseline/.env.local"), "synthetic unexpected config");
    await expect(verifySubscriptionRollbackPackage(f.root, f.output, f.approvals)).rejects.toThrow(
      "Unexpected packaged file",
    );
    await rm(resolve(f.output, "baseline/.env.local"));
    await writeFile(resolve(f.output, "baseline/src/service.ts"), "changed package");
    await expect(verifySubscriptionRollbackPackage(f.root, f.output, f.approvals)).rejects.toThrow(
      "Packaged source changed",
    );
  });
  it("rejects a nonancestor baseline and output symlink escapes", async () => {
    const f = await fixture();
    f.git("checkout", "-q", f.base);
    await f.put("other.ts", "other branch");
    const other = f.commit("other");
    expect(() => reviewSubscriptionRollback(f.root, other, f.release, f.approvals)).toThrow();
    await mkdir(resolve(f.root, "outside"));
    await symlink(resolve(f.root, "outside"), resolve(f.root, "artifacts/escape"));
    await expect(
      prepareSubscriptionRollback(
        f.root,
        f.base,
        f.release,
        resolve(f.root, "artifacts/escape/new"),
        f.approvals,
      ),
    ).rejects.toThrow("symlink");
  });
  it("never inherits provider/production URLs and keeps its own small native-runtime budget", () => {
    const name = "bazaar_hardening_subscription_rollback_1234567890123";
    const env = subscriptionRehearsalEnvironment(name, {
      PATH: "/synthetic/bin",
      DATABASE_URL: "postgresql://customer.invalid/prod",
      DEEPSEEK_API_KEY: "synthetic-key",
      FREEDOMPAY_SECRET_KEY: "synthetic-key",
      VERCEL: "1",
      VERCEL_ENV: "production",
    });
    expect(env.DATABASE_URL).toContain("127.0.0.1:55981/");
    expect(env.REDIS_URL).toBe("redis://127.0.0.1:55982/0");
    expect(env.BILLING_PAYMENTS_MODE).toBe("disabled");
    expect(env.FREEDOMPAY_SECRET_KEY).toBe("");
    expect(env.DEEPSEEK_API_KEY).toBeUndefined();
    expect(env.VERCEL).toBe("0");
    expect(env.UV_THREADPOOL_SIZE).toBe("2");
    expect(subscriptionRollbackPorts).toEqual({ postgres: 55981, redis: 55982 });
    expect(assertSubscriptionRehearsalEnvironment(env)).toMatchObject({ databaseName: name });
    expect(() =>
      assertSubscriptionRehearsalEnvironment({
        ...env,
        DATABASE_URL: "postgresql://customer.invalid/prod",
      }),
    ).toThrow();
    expect(() =>
      assertSubscriptionRehearsalEnvironment({ ...env, VERCEL_ENV: "production" }),
    ).toThrow();
    expect(() => subscriptionRehearsalEnvironment("customer_database")).toThrow();
  });
});
