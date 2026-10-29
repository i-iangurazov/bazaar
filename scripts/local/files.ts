import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, cp, lstat, mkdir, open, readFile, readdir, rename, statfs } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { assertPersistentPath } from "./config";
import { exists, jsonWrite } from "./services";

export async function requireDiskSpace(path: string, reserve = 512 * 1024 ** 2) {
  const space = await statfs(path),
    available = Number(space.bavail) * Number(space.bsize);
  if (available < reserve)
    throw new Error(
      `Not enough disk space:available${Math.floor(available / 1024 ** 2)}MiB,required${Math.ceil(reserve / 1024 ** 2)}MiB. No data/backups will be deleted automatically.`,
    );
}
export async function hashFile(path: string) {
  const hash = createHash("sha256");
  for await (const part of createReadStream(path)) hash.update(part as Buffer);
  return hash.digest("hex");
}
type FileEntry = { path: string; sha256: string; size: number };
export type FileSnapshot = { version: 1; files: FileEntry[] };

/** Every version keeps its manifest; identical file bytes are stored only once. */
export async function snapshotFiles(source: string, backups: string, manifest: string) {
  const objects = join(backups, "objects");
  await mkdir(objects, { recursive: true, mode: 0o700 });
  const files: FileEntry[] = [];
  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink())
        throw new Error("A backup source contains an unexpected symlink.");
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile())
        files.push({
          path: relative(source, path).split(sep).join("/"),
          sha256: await hashFile(path),
          size: (await lstat(path)).size,
        });
    }
  }
  await walk(source);
  files.sort((a, b) => a.path.localeCompare(b.path));
  let missingBytes = 0;
  for (const file of files)
    if (!(await exists(join(objects, file.sha256)))) missingBytes += file.size;
  await requireDiskSpace(backups, missingBytes + 512 * 1024 ** 2);
  for (const file of files) {
    const object = join(objects, file.sha256);
    if (!(await exists(object))) {
      const temp = object + "." + randomUUID() + ".partial";
      await cp(join(source, file.path), temp, { errorOnExist: true, force: false });
      if ((await hashFile(temp)) !== file.sha256)
        throw new Error("File changed during backup;previous backups remain intact.");
      await chmod(temp, 0o600);
      const handle = await open(temp, "r");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temp, object);
    }
    if ((await hashFile(object)) !== file.sha256)
      throw new Error("Backup object hash mismatch;no successful manifest published.");
  }
  const directory = await open(objects, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
  const value: FileSnapshot = { version: 1, files };
  await jsonWrite(manifest, value);
  return value;
}
export async function restoreFiles(manifest: string, target: string, repository: string) {
  const value = JSON.parse(await readFile(manifest, "utf8")) as FileSnapshot;
  if (value.version !== 1 || !Array.isArray(value.files))
    throw new Error("Unknown backup manifest");
  await assertPersistentPath(repository, target);
  const seen = new Set<string>();
  for (const file of value.files) {
    if (
      !file.path ||
      file.path.split("/").some((part) => !part || part === ".." || part === ".") ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      seen.has(file.path)
    )
      throw new Error("Unsafe backup path/hash");
    seen.add(file.path);
    const destination = resolve(target, file.path);
    await assertPersistentPath(repository, destination);
    if (!destination.startsWith(resolve(target) + sep))
      throw new Error("Backup path escapes destination");
    const object = join(dirname(manifest), "objects", file.sha256);
    if ((await lstat(object)).isSymbolicLink() || (await hashFile(object)) !== file.sha256)
      throw new Error("Backup object hash mismatch");
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    if (await exists(destination)) {
      if ((await hashFile(destination)) !== file.sha256)
        throw new Error("Restore would overwrite a different file;refused");
    } else await cp(object, destination, { errorOnExist: true, force: false });
    if (
      (await hashFile(destination)) !== file.sha256 ||
      (await lstat(destination)).size !== file.size
    )
      throw new Error("Restored file hash/size mismatch");
  }
  return value.files.length;
}
