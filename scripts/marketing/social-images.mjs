import { mkdir, readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const escape = (text) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const logo = (await readFile("public/brand/icon.png")).toString("base64");
await mkdir("public/marketing/social", { recursive: true });
for (const locale of ["ru", "kg", "en"]) {
  const copy = JSON.parse(await readFile(`src/content/marketing/${locale}.json`, "utf8"));
  const lines = locale === "ru" ? ["Весь ваш", "магазин."] : [copy.hero.titleStart];
  const firstY = locale === "ru" ? 254 : 285;
  const text = (x, y, size, content, color = "#ffffff", weight = 500) =>
    `<text x="${x}" y="${y}" fill="${color}" font-family="Arial, sans-serif" font-size="${size}" font-weight="${weight}" letter-spacing="-.8">${escape(content)}</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="630" viewBox="0 0 1200 630">
<defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#0b1835"/><stop offset="1" stop-color="#183c89"/></linearGradient><linearGradient id="area" x2="0" y2="1"><stop stop-color="#2155df" stop-opacity=".15"/><stop offset="1" stop-color="#2155df" stop-opacity="0"/></linearGradient></defs>
<rect width="1200" height="630" fill="url(#bg)"/><circle cx="1100" cy="65" r="430" fill="none" stroke="#ffffff0d"/><circle cx="1100" cy="65" r="345" fill="none" stroke="#ffffff0d"/>
<image x="64" y="57" width="42" height="42" xlink:href="data:image/png;base64,${logo}"/>${text(119, 88, 27, "BAZAAR", "#ffffff", 700)}
${text(65, 169, 14, copy.hero.kicker, "#a8c0f9", 400)}
${lines.map((line, index) => text(62, firstY + index * 68, 60, line, "#ffffff", 600)).join("")}
${text(62, firstY + lines.length * 68, 56, copy.hero.titleEnd, "#84adff", 600)}
${text(65, 545, 21, "bazaar.kg", "#bfd2ff", 500)}
<g transform="translate(660 143)"><rect width="477" height="367" rx="19" fill="#ffffff"/><path d="M0 19Q0 0 19 0H458Q477 0 477 19V42H0Z" fill="#f3f5f9"/><circle cx="18" cy="22" r="3" fill="#c4ccda"/><circle cx="29" cy="22" r="3" fill="#c4ccda"/><circle cx="40" cy="22" r="3" fill="#c4ccda"/>${text(58, 26, 10, "bazaar.kg", "#75819b", 400)}${text(25, 80, 20, copy.preview.overview, "#182d52", 600)}
<rect x="24" y="104" width="211" height="71" rx="8" fill="#f5f8fd"/><rect x="246" y="104" width="207" height="71" rx="8" fill="#f5f8fd"/>${text(38, 127, 11, copy.preview.revenue, "#69788f", 400)}${text(38, 157, 24, "42 850 KGS", "#182d52", 600)}${text(260, 127, 11, copy.preview.receipts, "#69788f", 400)}${text(260, 157, 24, "36", "#182d52", 600)}
${text(26, 207, 12, copy.preview.sales, "#182d52", 500)}<path d="M26 249H452M26 285H452M26 321H452" stroke="#edf0f6"/><path d="M26 309C54 309 66 277 101 279S138 311 181 266S236 295 278 251S324 279 366 237S420 254 451 223V335H26Z" fill="url(#area)"/><path d="M26 309C54 309 66 277 101 279S138 311 181 266S236 295 278 251S324 279 366 237S420 254 451 223" fill="none" stroke="#2155df" stroke-width="3" stroke-linecap="round"/>
</g>${text(664, 539, 11, copy.preview.demo, "#a8c0f9", 400)}</svg>`;
  await writeFile(
    `public/marketing/social/${locale}.png`,
    await sharp(Buffer.from(svg)).png().toBuffer(),
  );
}
