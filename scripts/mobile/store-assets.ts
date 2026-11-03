import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const directory = path.resolve("docs/mobile/store/assets");
await mkdir(directory, { recursive: true });
const icon = "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png";
await sharp(icon).flatten({ background: "#071326" }).removeAlpha().png()
  .toFile(path.join(directory, "app-store-icon-1024.png"));
await sharp(icon).resize(512, 512).flatten({ background: "#071326" }).removeAlpha().png()
  .toFile(path.join(directory, "google-play-icon-512.png"));
const copy = JSON.parse(await readFile("docs/mobile/store/listing.json", "utf8"));
const titles = {
  ru: "Товары. Продажи. Остатки.",
  "en-US": "Products. Sales. Stock.",
  "ky-KG": "Товарлар. Сатуулар. Калдыктар.",
};
for (const [locale, title] of Object.entries(titles)) {
  const background = Buffer.from(`<svg width="1024" height="500" xmlns="http://www.w3.org/2000/svg">
  <rect width="1024" height="500" fill="#071326"/>
  <text x="60" y="170" font-family="Arial,sans-serif" font-size="74" font-weight="700" fill="white">Bazaar</text>
  <text x="60" y="250" font-family="Arial,sans-serif" font-size="32" fill="#b9d5ff">${title}</text>
  </svg>`);
  const graphicIcon = await sharp(icon).resize(280, 280).png().toBuffer();
  await sharp(background).composite([{ input: graphicIcon, left: 714, top: 110 }])
    .flatten({ background: "#071326" }).removeAlpha().png()
    .toFile(path.join(directory, `google-play-feature-${locale}.png`));
}
for (const [locale, text] of Object.entries(copy.locales) as Array<[string, Record<string, string>]>) {
  for (const [field, limit] of Object.entries({ name: 30, subtitle: 30, shortDescription: 80, description: 4000, keywords: 100 })) {
    if (text[field].length > limit) throw new Error(`${locale}.${field} exceeds ${limit} characters`);
  }
}
await writeFile(path.join(directory, "README.md"), "Generated from the existing Bazaar native icon with pnpm mobile:store-assets. No new logo. PNG icons and feature graphics are opaque. Screenshots are tracked separately with their capture provenance.\n");
console.log("Store copy limits, opaque icons and three localized feature graphics prepared.");
