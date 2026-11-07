import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { approvedProductionMigrations } from "./migrations";

export const subscriptionRollbackBase = "0ffb69a1692d07f30d7696f6bdae29e370b34827";
export const subscriptionReleaseMigrations = [
  "20261103120000_signup_attribution",
  "20261107100000_subscription_contracts",
  "20261107110000_subscription_usage",
  "20261107120000_subscription_marketplace_channel",
  "20261107130000_subscription_scheduled_limits",
  "20261107140000_initial_product_import_session",
  "20261107150000_subscription_provider_budget",
  "20261107160000_subscription_reminders",
] as const;
const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const git = (root: string, args: string[]) =>
  execFileSync("git", args, {
    cwd: root,
    maxBuffer: 128 * 1024 ** 2,
    stdio: ["ignore", "pipe", "pipe"],
  });
const commit = (root: string, ref: string) =>
  git(root, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`])
    .toString()
    .trim();

function files(root: string, ref: string) {
  return git(root, ["ls-tree", "-rz", ref])
    .toString()
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(line);
      assert(
        match && !match[3].split("/").includes(".."),
        "Symlinks/submodules need separate recovery review",
      );
      return { mode: match[1], blob: match[2], path: match[3] };
    });
}

export function reviewSubscriptionRollback(
  root: string,
  baseRef: string,
  releaseRef: string,
  approvals: Readonly<Record<string, string>> = approvedProductionMigrations,
) {
  const base = commit(root, baseRef),
    release = commit(root, releaseRef);
  assert.notEqual(base, release, "Release must differ from the baseline");
  git(root, ["merge-base", "--is-ancestor", base, release]);
  const before = files(root, base),
    after = files(root, release);
  const old = new Map(before.map((row) => [row.path, row]));
  const next = new Map(after.map((row) => [row.path, row]));
  for (const row of before.filter((row) => row.path.startsWith("prisma/migrations/")))
    assert.equal(next.get(row.path)?.blob, row.blob, `Existing migration changed: ${row.path}`);
  const added = after
    .filter((row) => row.path.startsWith("prisma/migrations/") && !old.has(row.path))
    .map((row) => row.path)
    .sort();
  assert.deepEqual(
    added,
    subscriptionReleaseMigrations.map((name) => `prisma/migrations/${name}/migration.sql`).sort(),
    "Release additions differ from the eight reviewed migrations",
  );
  const migrations = subscriptionReleaseMigrations.map((name) => {
    const checksum = sha256(
      git(root, ["show", `${release}:prisma/migrations/${name}/migration.sql`]),
    );
    assert.equal(
      approvals[name],
      checksum,
      `Migration has no exact frozen production approval: ${name}`,
    );
    return { name, checksum };
  });
  const guard = git(root, ["show", `${release}:scripts/deployment/migrations.ts`]).toString();
  const declaration =
    /export const approvedProductionMigrations\s*=\s*\{([\s\S]*?)\}\s*as const/.exec(guard);
  assert(declaration, "Release has no recognizable strict migration approval registry");
  const committedApprovals = Object.fromEntries(
    [...declaration[1].matchAll(/"([^"]+)"\s*:\s*"([a-f0-9]{64})"/g)].map((match) => [
      match[1],
      match[2],
    ]),
  );
  for (const { name, checksum } of migrations)
    assert.equal(
      committedApprovals[name],
      checksum,
      `Approval is missing from the committed release: ${name}`,
    );
  // The old deployment is restored as-is. This package never removes SQL,
  // rewrites a migration ledger, or makes the old production guard permissive.
  return {
    base,
    release,
    baseTree: git(root, ["rev-parse", `${base}^{tree}`])
      .toString()
      .trim(),
    releaseTree: git(root, ["rev-parse", `${release}^{tree}`])
      .toString()
      .trim(),
    migrations,
  };
}

export type SubscriptionRollbackManifest = ReturnType<typeof reviewSubscriptionRollback> & {
  version: 1;
  strategy: "restore-existing-application-alias-retain-database";
  status: "prepared-not-rehearsed";
  databaseWrites: 0;
  refsChanged: false;
  archives: { baseline: string; release: string };
};

export async function prepareSubscriptionRollback(
  rootInput: string,
  baseRef: string,
  releaseRef: string,
  output: string,
  approvals: Readonly<Record<string, string>> = approvedProductionMigrations,
) {
  const root = await realpath(rootInput),
    directory = resolve(output),
    artifactRoot = resolve(root, "artifacts");
  const inside = relative(artifactRoot, directory);
  assert(
    inside && !inside.startsWith(`..${sep}`) && inside !== ".." && !inside.startsWith(sep),
    "Output must be a new directory under artifacts/",
  );
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const parent = await realpath(dirname(directory));
  assert(
    parent === dirname(directory) &&
      (parent === artifactRoot || parent.startsWith(artifactRoot + sep)),
    "Output parent escapes artifacts/ through a symlink",
  );
  const plan = reviewSubscriptionRollback(root, baseRef, releaseRef, approvals);
  await mkdir(directory, { mode: 0o700 });
  const archives: Record<string, string> = {};
  for (const [name, ref] of [
    ["baseline", plan.base],
    ["release", plan.release],
  ]) {
    const archive = resolve(directory, `${name}.tar`);
    git(root, ["archive", "--format=tar", "--output", archive, ref]);
    archives[name] = sha256(await readFile(archive));
    await mkdir(resolve(directory, name));
    execFileSync("tar", ["-xf", archive, "-C", resolve(directory, name)]);
  }
  const manifest: SubscriptionRollbackManifest = {
    ...plan,
    version: 1,
    strategy: "restore-existing-application-alias-retain-database",
    status: "prepared-not-rehearsed",
    databaseWrites: 0,
    refsChanged: false,
    archives: { baseline: archives.baseline!, release: archives.release! },
  };
  await writeFile(resolve(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  return manifest;
}

export async function verifySubscriptionRollbackPackage(
  root: string,
  directory: string,
  approvals: Readonly<Record<string, string>> = approvedProductionMigrations,
) {
  const artifactRoot = await realpath(resolve(root, "artifacts"));
  const actual = await realpath(directory);
  assert(actual.startsWith(artifactRoot + sep), "Package must remain inside artifacts/");
  const manifest = JSON.parse(
    await readFile(resolve(actual, "manifest.json"), "utf8"),
  ) as SubscriptionRollbackManifest;
  assert.equal(manifest.version, 1);
  assert.equal(manifest.strategy, "restore-existing-application-alias-retain-database");
  assert(
    /^[a-f0-9]{40}$/.test(manifest.base) && /^[a-f0-9]{40}$/.test(manifest.release),
    "Invalid committed SHA",
  );
  const current = reviewSubscriptionRollback(root, manifest.base, manifest.release, approvals);
  assert.deepEqual(manifest.migrations, current.migrations, "Manifest approvals changed");
  for (const [name, ref] of [
    ["baseline", manifest.base],
    ["release", manifest.release],
  ] as const) {
    assert.equal(
      sha256(await readFile(resolve(actual, `${name}.tar`))),
      manifest.archives[name],
      "Source archive changed",
    );
    const entries = files(root, ref),
      expected = new Set(entries.map((entry) => entry.path));
    const directories = new Set(
      entries.flatMap((entry) =>
        entry.path
          .split("/")
          .slice(0, -1)
          .map((_, index, parts) => parts.slice(0, index + 1).join("/")),
      ),
    );
    const walk = async (prefix = "") => {
      for (const entry of await readdir(resolve(actual, name, prefix), { withFileTypes: true })) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        assert(!entry.isSymbolicLink(), `Unexpected packaged symlink: ${path}`);
        if (entry.isDirectory()) {
          assert(directories.has(path), `Unexpected packaged directory: ${path}`);
          await walk(path);
        } else assert(entry.isFile() && expected.has(path), `Unexpected packaged file: ${path}`);
      }
    };
    await walk();
    const sourcePaths: string[] = [];
    for (const entry of entries) {
      const path = resolve(actual, name, entry.path);
      assert(
        (await realpath(path)).startsWith(resolve(actual, name) + sep),
        "Source file escapes package",
      );
      sourcePaths.push(path);
    }
    // Git owns its object format; this is byte identity, not a security hash.
    // One process hashes the complete tree, avoiding thousands of subprocesses.
    // Quoted paths are stdin data to Git, never interpolated into a shell.
    const hashes = execFileSync("git", ["hash-object", "--no-filters", "--stdin-paths"], {
      cwd: root,
      input: sourcePaths.map((path) => JSON.stringify(path)).join("\n") + "\n",
      maxBuffer: 16 * 1024 ** 2,
    })
      .toString()
      .trim()
      .split("\n");
    assert.equal(hashes.length, entries.length);
    entries.forEach((entry, index) =>
      assert.equal(hashes[index], entry.blob, `Packaged source changed: ${name}/${entry.path}`),
    );
  }
  return manifest;
}

async function main() {
  const { values } = parseArgs({
    options: { release: { type: "string" }, output: { type: "string" } },
  });
  assert(
    values.release && values.output,
    "Use --release <committed-sha> --output <new-artifacts-dir>",
  );
  console.log(
    JSON.stringify(
      await prepareSubscriptionRollback(
        process.cwd(),
        subscriptionRollbackBase,
        values.release,
        values.output,
      ),
      null,
      2,
    ),
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Recovery preparation failed");
    process.exitCode = 1;
  });
