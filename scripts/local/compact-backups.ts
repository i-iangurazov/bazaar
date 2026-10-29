/** Lossless conversion of this launcher's initial full TAR snapshots. */
import { mkdir, readdir, rm, lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { hashFile, requireDiskSpace, restoreFiles, snapshotFiles } from "./files";
import { initializePaths, jsonWrite, run } from "./services";
const root = resolve(fileURLToPath(new URL("../..", import.meta.url))),
  paths = await initializePaths(root);
const results: unknown[] = [];
for (const name of (await readdir(paths.backups))
  .filter((name) => /^2026-10-27T.*\.dump\.files\.tar$/.test(name))
  .sort()) {
  const archive = join(paths.backups, name),
    work = join(paths.data, "verification", "compact-" + randomUUID());
  await requireDiskSpace(paths.root, (await lstat(archive)).size * 3 + 512 * 1024 ** 2);
  await mkdir(work, { recursive: true, mode: 0o700 });
  const archiveHash = await hashFile(archive);
  await run("tar", ["-xf", archive, "-C", work]);
  const manifest = archive.replace(/\.tar$/, ".json"),
    saved = await snapshotFiles(join(work, "files"), paths.backups, manifest);
  const restored = await restoreFiles(manifest, join(work, "restored"), paths.root);
  if (restored !== saved.files.length) throw new Error("Compaction restore count mismatch");
  results.push({
    original: name,
    sha256: archiveHash,
    manifest,
    files: restored,
    everyRestoredHashVerified: true,
  });
  // Remove only after the equivalent snapshot has been restored and verified.
  await rm(archive);
  await rm(work, { recursive: true });
}
await jsonWrite(join(paths.root, "artifacts/ux/espresso/local-runtime-backup-compaction.json"), {
  snapshotsPreserved: results.length,
  results,
});
console.log(JSON.stringify({ snapshotsPreserved: results.length, filesStoredByContentHash: true }));
