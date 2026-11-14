// Only an owned disposable container, public hash-pinned photos, no host secrets/DBs.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, mkdtemp, chmod, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";

assert.equal(process.env.RUN_PRODUCT_PHOTO_LINUX_SMOKE, "1", "Explicit isolated Linux smoke opt-in required");
const run = promisify(execFile), output = resolve("artifacts/product-photo-linux");
const image = process.env.PRODUCT_PHOTO_TEST_IMAGE ?? "bazaar-product-photo:ci";
assert.match(image, /^[\w./-]+:[\w.-]+$/);
const container = `bazaar-photo-qa-${randomUUID().slice(0,8)}`, token = randomBytes(32).toString("hex");
const data = await mkdtemp(join(tmpdir(), "bazaar-photo-linux-"));
await chmod(data, 0o755); await mkdir(output, { recursive: true });
const docker = async (...args) => (await run("docker", args, { timeout: 240_000, maxBuffer: 4*1024*1024 })).stdout;
const health = "import json,os,urllib.request; r=urllib.request.Request('http://127.0.0.1:3150/health',headers={'Authorization':'Bearer '+os.environ['PRODUCT_PHOTO_SEARCH_TOKEN']}); h=json.load(urllib.request.urlopen(r,timeout=2)); assert h['ready'] and h['vision']; print(json.dumps(h))";
async function ready() {
  for (let n = 0; n < 90; n++) {
    try { return JSON.parse(await docker("exec", container, "python", "-c", health)); } catch { await pause(1000); }
  }
  throw new Error("Disposable photo service did not become ready");
}
let created = false;
try {
  const fixture = JSON.parse(await readFile("scripts/qa/fixtures/product-photo-linux.json", "utf8"));
  for (const row of fixture.images) {
    assert.equal(row.file, row.file.split("/").at(-1));
    const url = new URL(row.url);
    assert.equal(url.protocol, "https:"); assert.ok(["raw.githubusercontent.com", "aloi.science.uva.nl"].includes(url.hostname));
    let bytes;
    for (let n = 0; n < 3; n++) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(25000) }); assert.equal(response.status, 200);
        const reader = response.body.getReader(); const chunks = []; let length = 0;
        try { for (;;) { const {done,value} = await reader.read(); if (done) break; length += value.byteLength; assert.ok(length <= 6*1024*1024); chunks.push(value); } }
        finally { await reader.cancel(); }
        bytes = Buffer.concat(chunks); assert.equal(createHash("sha256").update(bytes).digest("hex"), row.sha256); break;
      } catch (error) { if (n === 2) throw error; await pause(1000); }
    }
    await writeFile(join(data,row.file), bytes);
  }
  await writeFile(join(data,"fixture.json"), JSON.stringify(fixture));
  await copyFile("scripts/qa/product-photo-linux-client.py", join(data,"client.py"));
  const common = ["--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "256",
    "--cpus", "2", "--memory", "4g", "--memory-swap", "4g", "--shm-size", "256m", "--tmpfs", "/tmp:rw,nosuid,nodev,size=256m"];
  const unit = await run("docker", ["run", "--rm", ...common, image, "python", "-m", "unittest", "discover", "-s", "services/product-photo-search", "-p", "test_*.py"], {timeout:120_000, maxBuffer:4*1024*1024});
  await writeFile(join(output,"unit.log"), unit.stdout+unit.stderr);
  await docker("run", "-d", "--name", container, "--label", "bazaar.test.kind=product-photo-linux", ...common,
    "--mount", `type=bind,src=${data},dst=/qa-data,readonly`, "--env", `PRODUCT_PHOTO_SEARCH_TOKEN=${token}`, image);
  created = true;
  await ready();
  const raw = await docker("exec", container, "python", "/qa-data/client.py");
  const result = JSON.parse(raw);
  await docker("stop", "--time", "15", container);
  let inspect = JSON.parse(await docker("inspect", container))[0];
  assert.equal(inspect.State.ExitCode, 0); assert.equal(inspect.State.OOMKilled, false);
  await docker("start", container); await ready();
  await docker("stop", "--time", "15", container);
  inspect = JSON.parse(await docker("inspect", container))[0];
  assert.equal(inspect.State.ExitCode, 0); assert.equal(inspect.State.OOMKilled, false);
  const imageInfo = JSON.parse(await docker("image", "inspect", image))[0];
  assert.equal(imageInfo.Os, "linux"); assert.equal(imageInfo.Architecture, "amd64");
  assert.equal(inspect.HostConfig.NetworkMode, "none"); assert.equal(inspect.HostConfig.ReadonlyRootfs, true);
  assert.equal(inspect.Config.User, "bazaar"); assert.deepEqual(inspect.HostConfig.PortBindings, {});
  assert.ok(inspect.Config.Env.every(value => !/^(?:DATABASE_|DIRECT_URL=|R2_|OPENAI_|DEEPSEEK_|HIOBUY_)/.test(value)));
  const evidence = {...result, commit: process.env.GITHUB_SHA ?? null, imageId: imageInfo.Id, linuxAmd64: true, imageBytes: imageInfo.Size,
    networkDisabledAtInference: true, readOnlyRoot: true, nonRoot: inspect.Config.User, noHostPortsOrDatabases: true,
    memoryLimitMiB: inspect.HostConfig.Memory/1024**2, cpus: inspect.HostConfig.NanoCpus/1e9, gracefulStop: true, restartReady: true,
    fixtureSha256: createHash("sha256").update(await readFile("scripts/qa/fixtures/product-photo-linux.json")).digest("hex")};
  await writeFile(join(output,"result.json"), JSON.stringify(evidence,null,2)+"\n");
  console.log(JSON.stringify(evidence));
} finally {
  if (created) {
    const logs = await run("docker", ["logs", container], {maxBuffer:4*1024*1024}).catch(() => ({stdout:"",stderr:"unavailable"}));
    await writeFile(join(output,"service.log"), logs.stdout+logs.stderr);
    await docker("rm", "--force", container).catch(() => undefined);
  }
  await rm(data, {recursive:true, force:true});
}
