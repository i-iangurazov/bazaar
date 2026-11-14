// Reproduce registered gallery crops from supplied public originals. No downloads/inference.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";

const ffmpeg = process.argv.find((arg) => arg.startsWith("--ffmpeg="))?.slice(9);
assert.ok(ffmpeg, "Supply --ffmpeg=/absolute/path/to/ffmpeg");
assert.equal(resolve(ffmpeg), ffmpeg);
const root = resolve(".local/elfbar-multiview");
const fixture = JSON.parse(await readFile("scripts/qa/fixtures/elfbar-photo-multiview.json", "utf8"));
const hash = (value) => createHash("sha256").update(value).digest("hex");
if (process.argv.includes("--recovery-views")) {
  const extra = JSON.parse(await readFile(process.argv.includes("--approved-views") ? "scripts/qa/fixtures/elfbar-photo-recovery-approved.json" : "scripts/qa/fixtures/elfbar-photo-recovery.json", "utf8"));
  assert.equal(extra.baselineGalleryManifestSha256, hash(await readFile("scripts/qa/fixtures/elfbar-photo-multiview.json")));
  fixture.assets.push(...extra.assets);
}
function local(file) {
  const path = resolve(root, file);
  assert.ok(relative(root, path) && !relative(root, path).startsWith(".."));
  return path;
}
const sources = new Map(fixture.sources.map((source) => [source.id, source]));
for (const source of sources.values()) assert.equal(hash(await readFile(local(source.file))), source.sha256, `Changed source ${source.id}`);
for (const asset of fixture.assets) {
  const source = sources.get(asset.media); assert.ok(source);
  await mkdir(dirname(local(asset.frameFile)), { recursive: true });
  await mkdir(dirname(local(asset.file)), { recursive: true });
  await promisify(execFile)(ffmpeg, ["-v", "error", "-ss", String(asset.seconds), "-threads", "2", "-i", local(source.file), "-frames:v", "1", "-vf", "format=rgb24", "-compression_level", "6", "-y", local(asset.frameFile)], { timeout: 30000 });
  const frame = await readFile(local(asset.frameFile));
  assert.equal(hash(frame), asset.frameSha256, `Changed frame ${asset.id}`);
  const { width, height } = await sharp(frame).metadata(), [x, y, w, h] = asset.crop;
  assert.ok([x, y, w, h].every(Number.isFinite) && x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1 && y + h <= 1);
  const crop = await sharp(frame).extract({ left: Math.round(x * width), top: Math.round(y * height), width: Math.round(w * width), height: Math.round(h * height) }).jpeg({ quality: 90 }).toBuffer();
  assert.equal(hash(crop), asset.uploadedSha256, `Changed crop ${asset.id}`);
  await writeFile(local(asset.file), crop);
}
console.log(JSON.stringify({ sources: sources.size, galleryViews: fixture.assets.length, inference: false }));
