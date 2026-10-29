import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

// This contract is deliberately specific to the reviewed playground release.
// Unknown/edited migrations require a new rehearsal, never an automatic bypass.
export const retainedMigrations = {
  "20261021170000_subscription_payments":
    "82dce9c6cf1511cb8c970071d9849bf54e9f919bdcf2db639dc131de86275203",
  "20261022090000_studio_quality":
    "1c4ef58753f96ff3697cabb969eafc5840178d482e3f7b3232b3186b7589c8a4",
  "20261029180000_shared_price_books":
    "34caf7ee88c4cfb69c3e949cd72e7fe44e6bb78449923b774beaf88f9c31b14a",
  "20261029190000_price_book_references":
    "29aa80564b641431c59525b1ba562940d1146cb86e4fa6ac9970ecab554c8707",
  "20261029200000_price_book_snapshots":
    "3ce9eec33b1c15556774fa4ec2117b47f7e6bda159defb69a15127d0e37fb775",
} as const;
const guardPath = "scripts/deployment/migrations.ts";
const sha256 = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
type Entry = { mode: string; hash: string; path: string };

function git(repository: string, args: string[], index?: string) {
  return execFileSync("git", args, {
    cwd: repository,
    env: { ...process.env, ...(index ? { GIT_INDEX_FILE: index } : {}) },
    maxBuffer: 128 * 1024 ** 2,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
function commit(repository: string, ref: string) {
  return git(repository, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`])
    .toString()
    .trim();
}
function tree(repository: string, ref: string) {
  return git(repository, ["ls-tree", "-r", "-z", ref])
    .toString()
    .split("\0")
    .filter(Boolean)
    .map((line): Entry => {
      const match = /^(\d+) (blob|commit) ([a-f0-9]+)\t([\s\S]+)$/.exec(line);
      if (!match || match[2] !== "blob")
        throw new Error("Submodules/unknown tree entries require manual rollback review.");
      return { mode: match[1]!, hash: match[3]!, path: match[4]! };
    });
}

export function reviewRollback(repository: string, baseRef: string, releaseRef: string) {
  const base = commit(repository, baseRef),
    release = commit(repository, releaseRef);
  git(repository, ["merge-base", "--is-ancestor", base, release]);
  const old = tree(repository, base),
    current = tree(repository, release);
  const oldFiles = new Map(old.map((file) => [file.path, file]));
  const currentFiles = new Map(current.map((file) => [file.path, file]));
  const added = Object.keys(retainedMigrations).map(
    (name) => `prisma/migrations/${name}/migration.sql`,
  );
  for (const entry of old.filter((file) => file.path.startsWith("prisma/migrations/"))) {
    if (currentFiles.get(entry.path)?.hash !== entry.hash)
      throw new Error(`Existing migration changed or disappeared: ${entry.path}`);
  }
  const actualAdded = current
    .filter((file) => file.path.startsWith("prisma/migrations/") && !oldFiles.has(file.path))
    .map((file) => file.path)
    .sort();
  if (JSON.stringify(actualAdded) !== JSON.stringify([...added].sort()))
    throw new Error("Added migrations differ from the five rehearsed migrations.");
  for (const [name, checksum] of Object.entries(retainedMigrations)) {
    const path = `prisma/migrations/${name}/migration.sql`;
    if (sha256(git(repository, ["show", `${release}:${path}`])) !== checksum)
      throw new Error(`Reviewed migration SQL changed: ${name}`);
  }
  const oldGuard = git(repository, ["show", `${base}:${guardPath}`]).toString();
  const declaration = "export const approvedProductionMigrations = {";
  if (!oldGuard.includes(declaration)) throw new Error("Unrecognized baseline migration guard.");
  const expectedGuard = oldGuard.replace(
    declaration,
    declaration +
      "\n" +
      Object.entries(retainedMigrations)
        .map(([name, checksum]) => `  "${name}": "${checksum}",`)
        .join("\n") +
      "\n",
  );
  if (git(repository, ["show", `${release}:${guardPath}`]).toString() !== expectedGuard)
    throw new Error("Migration guard contains changes beyond the five reviewed approvals.");
  // Keep private local databases/backups and recovery artifacts excluded from Git
  // even after application code returns to the old release.
  const retainedPaths = [...added, guardPath, ".gitignore"];
  const retained = retainedPaths.map((path) => {
    const entry = currentFiles.get(path);
    if (!entry || entry.mode !== "100644") throw new Error(`Unexpected retained file: ${path}`);
    return entry;
  });
  return { base, release, retained, baselineFiles: old.length };
}

export async function prepareRollback(
  repository: string,
  baseRef: string,
  releaseRef: string,
  output: string,
) {
  const root = await realpath(repository),
    destination = resolve(output);
  const artifactRoot = resolve(root, "artifacts");
  const inside = relative(artifactRoot, destination);
  if (
    !inside ||
    inside.startsWith(`..${sep}`) ||
    inside === ".." ||
    resolve(destination) === artifactRoot
  )
    throw new Error("Rollback output must be a new directory inside this repository's artifacts/.");
  const plan = reviewRollback(root, baseRef, releaseRef);
  const parent = await realpath(dirname(destination));
  if (
    parent !== dirname(destination) ||
    (!parent.startsWith(artifactRoot + sep) && parent !== artifactRoot)
  )
    throw new Error("Rollback output parent escapes artifacts/ through a symlink.");
  await mkdir(destination); // Exclusive: never overwrite an earlier recovery package.
  const index = resolve(destination, "candidate.index");
  try {
    git(root, ["read-tree", plan.base], index);
    for (const entry of plan.retained)
      git(
        root,
        ["update-index", "--add", "--cacheinfo", entry.mode, entry.hash, entry.path],
        index,
      );
    const candidate = git(root, ["write-tree"], index).toString().trim();
    const differences = git(root, ["diff", "--name-only", "-z", plan.base, candidate])
      .toString()
      .split("\0")
      .filter(Boolean)
      .sort();
    if (
      JSON.stringify(differences) !==
      JSON.stringify(plan.retained.map((entry) => entry.path).sort())
    )
      throw new Error("Candidate contains unexpected differences from the baseline.");
    const patch = git(root, ["diff", "--binary", "--full-index", plan.release, candidate]);
    const patchPath = resolve(destination, "rollback.patch");
    await writeFile(patchPath, patch, { flag: "wx", mode: 0o600 });
    // Prove the real binary patch reconstructs that exact tree without touching HEAD/index.
    git(root, ["read-tree", plan.release], index);
    git(root, ["apply", "--cached", "--binary", patchPath], index);
    if (git(root, ["write-tree"], index).toString().trim() !== candidate)
      throw new Error("Rollback patch did not reconstruct the reviewed candidate.");
    const archive = resolve(destination, "candidate.tar");
    git(root, ["archive", "--format=tar", "--output", archive, candidate]);
    await mkdir(resolve(destination, "candidate"));
    execFileSync("tar", ["-xf", archive, "-C", resolve(destination, "candidate")]);
    await rm(archive);
    const manifest = {
      version: 1,
      base: plan.base,
      release: plan.release,
      candidateTree: candidate,
      retained: plan.retained.map((entry) => ({
        ...entry,
        sha256: sha256(git(root, ["show", `${candidate}:${entry.path}`])),
      })),
      patchSha256: sha256(patch),
      baselineFiles: plan.baselineFiles,
      applicationMatchesBaseline: true,
      databaseConnections: 0,
      databaseWrites: 0,
      refsChanged: false,
      workingTreeChanged: false,
    };
    await writeFile(
      resolve(destination, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
      { flag: "wx" },
    );
    return manifest;
  } finally {
    await rm(index, { force: true });
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      base: { type: "string" },
      release: { type: "string" },
      merge: { type: "string" },
      output: { type: "string" },
    },
  });
  if (
    !values.output ||
    (values.merge ? values.base || values.release : !values.base || !values.release)
  )
    throw new Error(
      "Use --merge <merge-commit> --output <new-artifacts-dir>, or --base <sha> --release <sha> --output <new-artifacts-dir> for rehearsal.",
    );
  const repository = process.cwd();
  let base = values.base!,
    release = values.release!;
  if (values.merge) {
    release = commit(repository, values.merge);
    const parents = git(repository, ["show", "-s", "--format=%P", release])
      .toString()
      .trim()
      .split(" ");
    if (parents.length !== 2) throw new Error("Expected one ordinary two-parent PR merge commit.");
    base = parents[0]!;
    if (
      git(repository, ["rev-parse", `${release}^{tree}`]).toString() !==
      git(repository, ["rev-parse", `${parents[1]}^{tree}`]).toString()
    )
      throw new Error(
        "Merge contains additional/conflict-resolution changes; rehearse that release separately.",
      );
  }
  if (commit(repository, base) !== "5a27b8e37f03df2d73603fe37e4975d44888ddf5")
    throw new Error(
      "Baseline changed since the rollback rehearsal; review and rehearse that release before preparing recovery.",
    );
  console.log(
    JSON.stringify(await prepareRollback(repository, base, release, values.output), null, 2),
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Rollback preparation failed");
    process.exitCode = 1;
  });
