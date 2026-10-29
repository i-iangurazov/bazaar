import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  prepareRollback,
  retainedMigrations,
  reviewRollback,
} from "../../scripts/deployment/prepare-rollback";

const originalRoot = process.cwd(),
  temporary: string[] = [];
afterEach(async () => {
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true });
});
async function fixture() {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "bazaar-rollback-unit-")));
  temporary.push(root);
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
      encoding: "utf8",
    }).trim();
  git("init", "-q");
  git("config", "user.name", "Rollback QA");
  git("config", "user.email", "rollback@example.invalid");
  const put = async (path: string, content: string | Buffer) => {
    const destination = resolve(root, path);
    await mkdir(resolve(destination, ".."), { recursive: true });
    await writeFile(destination, content);
  };
  const commit = (message: string) => {
    git("add", ".");
    git("commit", "-qm", message);
    return git("rev-parse", "HEAD");
  };
  const oldGuard =
    'export const approvedProductionMigrations = {\n  "baseline": "baseline",\n} as const;\n// Strict existing guard stays unchanged.\n';
  await put(".gitignore", "artifacts/\n");
  await mkdir(resolve(root, "artifacts"));
  await put("src/runtime.ts", "old application\n");
  await put("logo.bin", Buffer.from([0, 255, 1, 0]));
  await put("prisma/migrations/baseline/migration.sql", "baseline\n");
  await put("scripts/deployment/migrations.ts", oldGuard);
  const base = commit("base");
  await put("src/runtime.ts", "new application\n");
  await put("src/new-feature.ts", "new feature\n");
  await put("logo.bin", Buffer.from([0, 2, 3, 0]));
  for (const name of Object.keys(retainedMigrations))
    await put(
      `prisma/migrations/${name}/migration.sql`,
      await readFile(resolve(originalRoot, `prisma/migrations/${name}/migration.sql`)),
    );
  await put(
    "scripts/deployment/migrations.ts",
    oldGuard.replace(
      "export const approvedProductionMigrations = {",
      "export const approvedProductionMigrations = {\n" +
        Object.entries(retainedMigrations)
          .map(([n, h]) => `  "${n}": "${h}",`)
          .join("\n") +
        "\n",
    ),
  );
  const release = commit("release");
  return { root, base, release, git, put, commit, output: resolve(root, "artifacts/recovery") };
}
describe("reviewed whole-release rollback preparation", () => {
  it("restores every old application byte, removes new features, retains only reviewed migration compatibility, and leaves HEAD/index/work untouched", async () => {
    const f = await fixture();
    await f.put("unrelated-local.txt", "retain local work");
    const before = f.git("status", "--porcelain");
    const result = await prepareRollback(f.root, f.base, f.release, f.output);
    expect(await readFile(resolve(f.output, "candidate/src/runtime.ts"), "utf8")).toBe(
      "old application\n",
    );
    expect(await readFile(resolve(f.output, "candidate/logo.bin"))).toEqual(
      Buffer.from([0, 255, 1, 0]),
    );
    await expect(readFile(resolve(f.output, "candidate/src/new-feature.ts"))).rejects.toThrow();
    expect(result.retained).toHaveLength(6);
    expect(result.databaseWrites).toBe(0);
    expect(f.git("rev-parse", "HEAD")).toBe(f.release);
    expect(f.git("status", "--porcelain")).toBe(before);
    expect(f.git("diff", "--cached")).toBe("");
    await expect(prepareRollback(f.root, f.base, f.release, f.output)).rejects.toThrow();
    expect(
      JSON.parse(await readFile(resolve(f.output, "manifest.json"), "utf8")).candidateTree,
    ).toBe(result.candidateTree);
  });
  it("rejects an unknown sixth migration", async () => {
    const f = await fixture();
    await f.put("prisma/migrations/unknown/migration.sql", "unknown");
    expect(() => reviewRollback(f.root, f.base, f.commit("unknown"))).toThrow("five rehearsed");
  });
  it("rejects SQL edited under a reviewed migration name", async () => {
    const f = await fixture(),
      name = Object.keys(retainedMigrations)[0]!;
    await f.put(`prisma/migrations/${name}/migration.sql`, "changed SQL");
    expect(() => reviewRollback(f.root, f.base, f.commit("changed new SQL"))).toThrow(
      "SQL changed",
    );
  });
  it("rejects modifying an old migration", async () => {
    const f = await fixture();
    await f.put("prisma/migrations/baseline/migration.sql", "changed baseline");
    expect(() => reviewRollback(f.root, f.base, f.commit("changed old SQL"))).toThrow(
      "Existing migration changed",
    );
  });
  it("rejects loosening the old deployment guard", async () => {
    const f = await fixture();
    await f.put("scripts/deployment/migrations.ts", "// skip history validation\n");
    expect(() => reviewRollback(f.root, f.base, f.commit("guard bypass"))).toThrow(
      "beyond the five reviewed",
    );
  });
  it("rejects a non-ancestor baseline", async () => {
    const f = await fixture();
    f.git("checkout", "-q", f.base);
    await f.put("other.txt", "other");
    const other = f.commit("other branch");
    expect(() => reviewRollback(f.root, other, f.release)).toThrow();
  });
  it("rejects output outside artifacts without creating files", async () => {
    const f = await fixture();
    await expect(
      prepareRollback(f.root, f.base, f.release, resolve(f.root, "src/recovery")),
    ).rejects.toThrow("artifacts/");
  });
  it("rejects a symlinked output parent before writing through it", async () => {
    const f = await fixture();
    await mkdir(resolve(f.root, "outside"));
    await symlink(resolve(f.root, "outside"), resolve(f.root, "artifacts/escape"));
    await expect(
      prepareRollback(f.root, f.base, f.release, resolve(f.root, "artifacts/escape/new")),
    ).rejects.toThrow("symlink");
    await expect(readFile(resolve(f.root, "outside/new/manifest.json"))).rejects.toThrow();
  });
});
