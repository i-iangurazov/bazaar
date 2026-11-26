import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";

/** Container-local operational metadata only; no images, tenant IDs or errors. */
export async function publishPhotoWorkerHealth(filename: string, lastSuccessAt: number, pid = process.pid) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify({ pid, lastSuccessAt }), { mode: 0o600 });
    await rename(temporary, filename);
  } finally { await rm(temporary, { force: true }); }
}

export async function removePhotoWorkerHealth(filename: string, pid = process.pid) {
  try {
    const current = JSON.parse(await readFile(filename, "utf8"));
    if (current.pid === pid) await rm(filename, { force: true });
  } catch { /* Missing or replaced heartbeat is already unready. */ }
}
