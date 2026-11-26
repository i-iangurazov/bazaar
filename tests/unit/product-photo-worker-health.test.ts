import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { publishPhotoWorkerHealth, removePhotoWorkerHealth } from "@/server/services/productPhotoWorkerHealth";

let directory: string;
let filename: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "bazaar-photo-health-")); filename = join(directory, "worker.json"); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("photo indexer operational heartbeat", () => {
  it("publishes only process/time metadata with private file permissions", async () => {
    await publishPhotoWorkerHealth(filename, 123456, 17);
    expect(JSON.parse(await readFile(filename, "utf8"))).toEqual({ pid: 17, lastSuccessAt: 123456 });
    expect((await stat(filename)).mode & 0o777).toBe(0o600);
    expect(await readdir(directory)).toEqual(["worker.json"]);
  });
  it("keeps each concurrent replacement atomic and removes temporary files", async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => publishPhotoWorkerHealth(filename, 1000 + i, 50 + i)));
    const data = JSON.parse(await readFile(filename, "utf8"));
    expect(data.pid - 50).toBe(data.lastSuccessAt - 1000);
    expect(await readdir(directory)).toEqual(["worker.json"]);
  });
  it("does not remove another running process's heartbeat", async () => {
    await publishPhotoWorkerHealth(filename, 123456, 18);
    await removePhotoWorkerHealth(filename, 17);
    expect(JSON.parse(await readFile(filename, "utf8"))).toEqual({ pid: 18, lastSuccessAt: 123456 });
  });
  it("removes its own heartbeat and tolerates missing or corrupt reports", async () => {
    await publishPhotoWorkerHealth(filename, 123456, 17);
    await removePhotoWorkerHealth(filename, 17);
    expect(await readdir(directory)).toEqual([]);
    await removePhotoWorkerHealth(filename, 17);
    await writeFile(filename, "not-json");
    await removePhotoWorkerHealth(filename, 17);
    expect(await readFile(filename, "utf8")).toBe("not-json");
  });
});
