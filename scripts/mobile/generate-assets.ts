import { mkdir } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const root = process.cwd();
const sourcePath = path.join(root, "public", "brand", "icon.png");
const assetsPath = path.join(root, "assets");
const shellPath = path.join(root, "mobile-shell");

const blue = "#0b63ce";
const navy = "#071326";

await Promise.all([mkdir(assetsPath, { recursive: true }), mkdir(shellPath, { recursive: true })]);

const logo = await sharp(sourcePath)
  .resize(760, 714, { fit: "contain", withoutEnlargement: false })
  .png()
  .toBuffer();

await sharp({
  create: { width: 1024, height: 1024, channels: 4, background: navy },
})
  .composite([{ input: logo, gravity: "centre" }])
  .png()
  .toFile(path.join(assetsPath, "icon-only.png"));

await sharp({
  create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
})
  .composite([{ input: logo, gravity: "centre" }])
  .png()
  .toFile(path.join(assetsPath, "icon-foreground.png"));

await sharp({ create: { width: 1024, height: 1024, channels: 4, background: blue } })
  .png()
  .toFile(path.join(assetsPath, "icon-background.png"));

const splashLogo = await sharp(sourcePath)
  .resize(560, 525, { fit: "contain", withoutEnlargement: false })
  .png()
  .toBuffer();

for (const [name, background] of [
  ["splash.png", "#f8fafc"],
  ["splash-dark.png", navy],
] as const) {
  await sharp({ create: { width: 2732, height: 2732, channels: 4, background } })
    .composite([{ input: splashLogo, gravity: "centre" }])
    .png()
    .toFile(path.join(assetsPath, name));
}

await sharp(sourcePath)
  .resize(192, 192, { fit: "contain", background: navy })
  .png()
  .toFile(path.join(shellPath, "icon.png"));

process.stdout.write("Generated reviewed Bazaar icon and splash source assets.\n");
