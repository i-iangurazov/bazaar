import { mkdir } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const root = process.cwd();
const sourcePath = path.join(root, "public", "brand", "icon.png");
const assetsPath = path.join(root, "assets");
const shellPath = path.join(root, "mobile-shell");
const startupLogoPath = path.join(root, "ios", "App", "App", "Assets.xcassets", "StartupLogo.imageset");

const white = "#ffffff";

await Promise.all([mkdir(assetsPath, { recursive: true }), mkdir(shellPath, { recursive: true }),
  mkdir(startupLogoPath, { recursive: true })]);

const logo = await sharp(sourcePath)
  .resize(760, 714, { fit: "contain", withoutEnlargement: false, background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();

await sharp({
  create: { width: 1024, height: 1024, channels: 4, background: white },
})
  .composite([{ input: logo, gravity: "centre" }])
  .flatten({ background: white }).removeAlpha()
  .png()
  .toFile(path.join(assetsPath, "icon-only.png"));

await sharp({
  create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
})
  .composite([{ input: logo, gravity: "centre" }])
  .png()
  .toFile(path.join(assetsPath, "icon-foreground.png"));

await sharp({ create: { width: 1024, height: 1024, channels: 4, background: white } })
  .png()
  .toFile(path.join(assetsPath, "icon-background.png"));

const splashLogo = await sharp(sourcePath)
  .resize(560, 525, { fit: "contain", withoutEnlargement: false, background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();

// Reuse these exact source pixels in the native animated cover. Its layout
// matches the 560×525 logo on the 2732² static launch image, without a redraw.
await sharp(splashLogo).toFile(path.join(startupLogoPath, "StartupLogo.png"));

for (const [name, background] of [
  ["splash.png", white],
  ["splash-dark.png", white],
] as const) {
  await sharp({ create: { width: 2732, height: 2732, channels: 4, background } })
    .composite([{ input: splashLogo, gravity: "centre" }])
    .png()
    .toFile(path.join(assetsPath, name));
}

await sharp(sourcePath)
  .resize(192, 192, { fit: "contain", background: white })
  .flatten({ background: white }).removeAlpha()
  .png()
  .toFile(path.join(shellPath, "icon.png"));

process.stdout.write("Generated reviewed Bazaar icon and splash source assets.\n");
