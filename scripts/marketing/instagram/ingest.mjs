// Intake final exports from specialist tools. Copies files and reads metadata;
// never draws, edits, resizes, schedules or publishes any visual.
import { readFile, writeFile, copyFile, stat, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import sharp from "sharp";
const digest = (s) => createHash("sha256").update(s).digest("hex");
if (!process.argv[2])
  throw new Error("Pass a JSON export list; see the runbook. Run prepare.mjs first.");
const input = JSON.parse(await readFile(process.argv[2], "utf8"));
if (!Array.isArray(input.packages) || !input.packages.length)
  throw new Error("Expected non-empty packages list");
const campaignText = await readFile(process.env.BAZAAR_INSTAGRAM_CAMPAIGN ?? "docs/marketing/instagram-2026-11/campaign.json", "utf8");
const campaign = JSON.parse(campaignText);
const dir = campaign.packageDirectory ?? "artifacts/instagram-canva-20261103";
const briefs = JSON.parse(await readFile(`${dir}/briefs.json`, "utf8"));
const manifest = JSON.parse(await readFile(`${dir}/manifest.json`, "utf8"));
const used = new Set();
const prepared = [];
// Validate the entire input before writing or changing any package.
for (const source of input.packages) {
  const id = `${source.originalId}_${source.locale}`;
  const brief = briefs.find((b) => b.id === id);
  const item = [...campaign.items, ...campaign.ads].find((i) => i.id === source.originalId);
  if (!brief || !item || used.has(id)) throw new Error(`Unknown or repeated package: ${id}`);
  used.add(id);
  if (
    !Array.isArray(source.canvaDesignIds) ||
    !source.canvaDesignIds.length ||
    source.canvaDesignIds.some((s) => typeof s !== "string" || !/^D[A-Za-z0-9_-]+$/.test(s))
  )
    throw new Error(`Record actual Canva design IDs for ${id}`);
  const expectedFrames = item.frames[source.locale].length;
  const expectedStories = item.stories?.[source.locale].length ?? 0;
  if (
    (source.frames?.length ?? 0) !== expectedFrames ||
    (source.stories?.length ?? 0) !== expectedStories ||
    (source.verticalFrames?.length ?? 0) !== (item.paid ? expectedFrames : 0)
  )
    throw new Error(`Incomplete frame/story export: ${id}`);
  const videoSeconds = brief.type === "reel" ? 20 : item.paid && item.media?.videoSeconds === 15 ? 15 : null;
  if (Boolean(videoSeconds) !== Boolean(source.video))
    throw new Error(`Video export does not match the required package: ${id}`);
  if (brief.type === "reel" && !source.cover)
    throw new Error(`Reels require a separately reviewed profile cover: ${id}`);
  if (source.cover && (brief.type !== "reel" || !["canva", "imagegen"].includes(source.coverTool)))
    throw new Error(`Record the actual cover tool for a Reel: ${id}`);
  const assets = [];
  const addImage = async (file, suffix, tall, cover = false) => {
    if (typeof file !== "string" || !path.isAbsolute(file))
      throw new Error("Use an absolute local export path");
    const info = await sharp(file).metadata();
    const validSize = cover
      ? info.width >= 1080 &&
        info.height >= 1350 &&
        Math.abs(info.width / info.height - 4 / 5) < 0.005
      : info.width === 1080 && info.height === (tall ? 1920 : 1350);
    if (!validSize || !["png", "jpeg", "webp"].includes(info.format))
      throw new Error(`Wrong export size or format: ${file}`);
    const ext = { png: "png", jpeg: "jpg", webp: "webp" }[info.format];
    const bytes = await readFile(file);
    assets.push({ file: `${id}${suffix}.${ext}`, sha256: digest(bytes), source: file });
  };
  if (source.cover) await addImage(source.cover, "-cover", false, true);
  for (const [n, file] of (source.frames ?? []).entries())
    await addImage(file, `-${n + 1}`, brief.type === "reel");
  for (const [n, file] of (source.stories ?? []).entries())
    await addImage(file, `-story-${n + 1}`, true);
  for (const [n, file] of (source.verticalFrames ?? []).entries())
    await addImage(file, `-vertical-${n + 1}`, true);
  if (source.video) {
    if (!path.isAbsolute(source.video) || (await stat(source.video)).size > 200 * 1024 * 1024)
      throw new Error("Video must be a local export under 200 MiB");
    const decoded = spawnSync(
      process.env.FFMPEG_BIN ?? "ffmpeg",
      ["-v", "error", "-i", source.video, "-f", "null", "-"],
      { encoding: "utf8", timeout: 60000 },
    );
    if (decoded.status !== 0)
      throw new Error(`Video decode failed: ${decoded.error?.message ?? decoded.stderr}`);
    const info =
      spawnSync(process.env.FFMPEG_BIN ?? "ffmpeg", ["-i", source.video], {
        encoding: "utf8",
        timeout: 10000,
      }).stderr ?? "";
    const duration = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(info);
    const seconds = duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : NaN;
    if (!/1080x1920/.test(info) || Math.abs(seconds - videoSeconds) > 0.1 || !Number.isFinite(seconds))
      throw new Error(`Video must be 1080×1920 and ${videoSeconds} seconds`);
    assets.push({
      file: `${id}.mp4`,
      sha256: digest(await readFile(source.video)),
      source: source.video,
    });
  }
  for (const suffix of ["-copy.txt", ...(brief.type === "reel" ? [".srt"] : [])]) {
    const file = `${id}${suffix}`;
    assets.push({
      file,
      sha256: digest(await readFile(`${dir}/${file}`)),
      source: path.resolve(dir, file),
    });
  }
  const row = {
    ...brief,
    status: "draft",
    campaignHash: digest(campaignText),
    canvaDesignIds: source.canvaDesignIds,
    ...(source.cover ? { coverTool: source.coverTool } : {}),
    files: assets.map(({ file, sha256 }) => ({ file, sha256 })),
  };
  prepared.push({ row: { ...row, approvalHash: digest(JSON.stringify(row)) }, assets });
}
await mkdir(dir, { recursive: true });
for (const { assets } of prepared)
  for (const asset of assets) {
    const target = path.resolve(dir, asset.file);
    if (target !== asset.source) await copyFile(asset.source, target);
  }
for (const { row } of prepared) {
  const old = manifest.findIndex((r) => r.id === row.id);
  if (old < 0) manifest.push(row);
  else manifest[old] = row;
}
await writeFile(`${dir}/manifest.json`, JSON.stringify(manifest, null, 2));
console.log(
  `Imported ${prepared.length} complete draft packages. No approval, scheduling or publication performed.`,
);
