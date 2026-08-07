import { access } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import {
  getHelpGuideById,
  helpCategories,
  helpGuideId,
  helpGuides,
} from "../../src/content/help/catalog";
import { locales } from "../../src/lib/locales";

const failures: string[] = [];
const mediaPaths = new Set<string>();

for (const guide of helpGuides) {
  const id = helpGuideId(guide);
  if (guide.steps.length < 3 || guide.steps.length > 7) failures.push(`${id}: expected 3–7 steps`);
  if (guide.relatedGuides.length < 2 || guide.relatedGuides.length > 4)
    failures.push(`${id}: expected 2–4 related guides`);
  guide.relatedGuides.forEach((related) => {
    if (!getHelpGuideById(related)) failures.push(`${id}: broken related guide ${related}`);
  });
  for (const locale of locales) {
    if (!guide.title[locale] || !guide.summary[locale] || !guide.aliases[locale])
      failures.push(`${id}: missing ${locale} search content`);
    guide.steps.forEach((step, index) => {
      if (!step.title[locale] || !step.body[locale])
        failures.push(`${id}: missing ${locale} step ${index + 1}`);
    });
  }
  guide.steps.forEach((item) => {
    if (item.media) {
      mediaPaths.add(item.media.src);
      if (item.media.mobileSrc) mediaPaths.add(item.media.mobileSrc);
    }
  });
}

for (const category of helpCategories) {
  for (const locale of locales) {
    if (!category.title[locale] || !category.description[locale])
      failures.push(`${category.slug}: missing ${locale}`);
  }
}

for (const mediaPath of mediaPaths) {
  const filePath = path.join(process.cwd(), "public", mediaPath.replace(/^\//, ""));
  try {
    await access(filePath);
    const metadata = await sharp(filePath).metadata();
    if (!metadata.width || !metadata.height || metadata.width < 700)
      failures.push(`${mediaPath}: invalid dimensions`);
  } catch {
    failures.push(`${mediaPath}: missing or unreadable`);
  }
}

if (failures.length) {
  failures.forEach((failure) => process.stderr.write(`- ${failure}\n`));
  process.exit(1);
}

process.stdout.write(
  `Help verified: ${helpGuides.length} guides, ${helpCategories.length} categories, ${mediaPaths.size} optimized source captures.\n`,
);
