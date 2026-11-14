import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

test("Linux photo checks cannot start containers, download assets or read databases without explicit opt-in", () => {
  const env = {...process.env}; delete env.RUN_PRODUCT_PHOTO_LINUX_SMOKE;
  const result = spawnSync(process.execPath, ["scripts/qa/product-photo-linux.mjs"], {env, encoding:"utf8"});
  assert.equal(result.status, 1); assert.equal(result.stdout, "");
  assert.match(result.stderr, /Explicit isolated Linux smoke opt-in required/);
});

test("Linux lock preserves each direct runtime version and pins every artifact by SHA256", () => {
  const direct = readFileSync("services/product-photo-search/requirements.txt", "utf8").split("\n").filter(line => line && !line.startsWith("#"));
  const lock = readFileSync("services/product-photo-search/requirements-linux-x86_64.lock.txt", "utf8").split("\n").filter(line => line && !line.startsWith("#"));
  for (const row of lock) assert.match(row, /^[\w.-]+==[\w.+-]+ --hash=sha256:[a-f0-9]{64}$/);
  for (const row of direct) assert.ok(lock.some(locked => locked.toLowerCase().startsWith(row.toLowerCase()+" ")), row);
});

test("real public photo controls keep query and gallery images separate and source revisions fixed", () => {
  const fixture = JSON.parse(readFileSync("scripts/qa/fixtures/product-photo-linux.json", "utf8"));
  const hashes = new Set(fixture.images.filter(row => row.role === "gallery").map(row => row.sha256));
  for (const row of fixture.images) {
    assert.equal(row.file, row.file.split("/").at(-1));
    assert.match(row.sha256, /^[a-f0-9]{64}$/);
    const url = new URL(row.url); assert.equal(url.protocol, "https:");
    if (url.hostname === "raw.githubusercontent.com") assert.match(url.pathname, /\/GroceryStoreDataset\/[a-f0-9]{40}\/dataset\//);
    else assert.equal(url.hostname, "aloi.science.uva.nl");
    if (row.role === "query") assert.ok(!hashes.has(row.sha256));
  }
  assert.equal(fixture.images.filter(row => row.role === "query").length, 4);
});
