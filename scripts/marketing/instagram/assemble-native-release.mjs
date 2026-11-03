// Package unchanged native Canva exports. This never draws, approves or publishes content.
import { readFile, writeFile, mkdir, copyFile, rename } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { hash, verifyPackage } from "./workflow.mjs";

const root = process.cwd();
const docs = "docs/marketing/instagram-2026-11";
const base = "artifacts/instagram-canva-20261103/production/revision5";
const packageDirectory = "artifacts/instagram-canva-20261103/release-v5";
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const plan = await readJson(`${docs}/native-v5-plan.json`);
const editorial = await readJson(`${docs}/revision-plan.json`);
const ads = await readJson(`${docs}/revision4-ad-plan.json`);
const media = await readJson(`${base}/exports/media-manifest.json`);
const videos = await readJson(`${base}/exports/video-evidence.json`);
if (plan.sourceSaveStatus !== "committed" || plan.publicationEnabled !== false || plan.paidBudget !== null || media.pages.length !== 98 || videos.length !== 10)
  throw new Error("A complete saved native release is required");
const pageFor = (group, page) => {
  const result = media.pages.find((x) => x.group === group && x.page === page);
  if (!result) throw new Error(`Missing native export: ${group}/${page}`);
  return result;
};
const pagesFor = (group, id) => plan.designs[group].pages.filter((x) => x.itemId === id);
const nativeVideo = (id) => {
  const video = videos.find((x) => x.id === `${id}_ru`);
  if (!video || video.fullDecode !== "passed" || video.durationSeconds !== (id.startsWith("ad") ? 15 : 20)) throw new Error(`Missing video ${id}`);
  return video;
};
for (const page of media.pages) {
  const spec = plan.designs[page.group].pages[page.page - 1];
  const content = [spec.headline, spec.body, spec.layout, spec.photoKey ?? null, spec.screenKey ?? null, spec.size];
  if (page.designId !== plan.designs[page.group].id || page.pageContentHash !== hash(JSON.stringify(content)) || page.sha256 !== hash(await readFile(page.file)))
    throw new Error(`Stale native page: ${page.group}/${page.page}`);
}
for (const video of videos) if (video.sha256 !== hash(await readFile(video.file))) throw new Error(`Stale video: ${video.id}`);
if (editorial.items.length !== 14 || new Set(editorial.items.map((x) => x.day)).size !== 14) throw new Error("Expected 14 distinct days");
const slide = (p) => ({ title: p.headline, body: p.body });
const line = (p) => `${p.headline}\n${p.body}`;
const splitFor = (id) => plan.splitDesigns.find((x) => x.key === id);
const campaign = {
  version: 5,
  campaign: "kg_store_launch_202611",
  account: "bazaar.pos",
  locales: ["ru"],
  packageDirectory,
  startDate: null,
  endDate: null,
  timezone: "Asia/Bishkek",
  publicationEnabled: false,
  paidBudget: null,
  sourceOfTruth: { landing: "https://www.bazaar.kg/", planCatalog: "src/server/billing/planCatalog.ts", nativePlan: `${docs}/native-v5-plan.json`, screenshots: `${docs}/app-screen-evidence.json` },
  schedule: editorial.schedule,
  brandRules: { ...editorial.protectedBrand, typography: plan.typography },
  measurement: editorial.measurement,
  canvaFolder: plan.canvaFolder,
  languageNote: "RU release. Previous Kyrgyz alternatives remain archived and require native editorial review before use.",
  items: [],
  ads: [],
};
const intake = [];
for (const item of editorial.items) {
  const stories = pagesFor("stories", item.id);
  const frames = item.format === "stories" ? [] : pagesFor(item.format === "reel" ? "reels" : "carousels", item.id);
  const cover = item.format === "reel" ? pagesFor("feed", item.id).find((x) => x.role === "cover") : null;
  if (stories.length !== 3 || frames.length !== (item.format === "reel" ? 4 : item.format === "carousel" ? item.id === "p11" ? 6 : 4 : 0) || (item.format === "reel" && !cover)) throw new Error(`Incomplete native day: ${item.id}`);
  const ctaMode = item.id === "s14" ? "signup" : item.id === "s13" ? "question" : "demo";
  const designIds = [...new Set([splitFor(item.id)?.designId, ...(item.format === "reel" ? [plan.designs.reels.id, plan.designs.feed.id] : item.format === "carousel" ? [plan.designs.carousels.id] : []), plan.designs.stories.id].filter(Boolean))];
  campaign.items.push({
    id: item.id, day: item.day, date: null, format: item.format, topic: item.pillar, industry: item.industry,
    title: { ru: item.title }, caption: { ru: item.format === "stories" ? "" : item.caption },
    operatorNotes: item.format === "stories" ? item.caption : null,
    frames: { ru: frames.map(line) }, slides: { ru: frames.map(slide) }, stories: { ru: stories.map(line) }, storySlides: { ru: stories.map(slide) },
    storyInteractions: stories.filter((x) => x.interaction).map((x) => ({ frame: x.frame, ...x.interaction, ...(x.interaction.type === "link_sticker" ? { utmContent: `${item.id}_ru_story_${x.frame}` } : {}) })),
    ctaMode, directKeyword: item.keyword ?? null, claimSources: ["landing", "planCatalog", "screenshots"],
    ...(item.format === "reel" ? { media: { videoSeconds: 20, audio: "none", type: "native Canva page sequence" } } : {}),
    distribution: { status: "complete_draft_not_approved", primaryLocale: "ru", relativeDay: item.day, feedAt: null, feedTimeHypothesis: item.format === "stories" ? null : "19:30", storyFrames: stories.map((x) => ({ frame: x.frame, relativeDay: item.day, timeHypothesis: item.format === "stories" || x.frame < 3 ? "12:30" : "19:45" })), canvaSourceDesignIds: designIds, gridPositionAfterDay14: item.format === "stories" ? null : editorial.profileGrid.week2.indexOf(item.id) + 1 },
  });
  intake.push({ originalId: item.id, locale: "ru", canvaDesignIds: designIds, frames: frames.map((x) => path.resolve(pageFor(item.format === "reel" ? "reels" : "carousels", x.page).file)), stories: stories.map((x) => path.resolve(pageFor("stories", x.page).file)), ...(cover ? { video: path.resolve(nativeVideo(item.id).file), cover: path.resolve(pageFor("feed", cover.page).file), coverTool: "canva" } : {}) });
}
const adPage = (ref) => ref.carouselId
  ? { group: "carousels", spec: plan.designs.carousels.pages.find((x) => x.itemId === ref.carouselId && x.slide === ref.page) }
  : { group: "feed", spec: plan.designs.feed.pages[(ref.group === "analyticsProof" ? 14 : ref.page) - 1] };
for (const ad of ads.concepts) {
  const refs = [ad.feed, ad.proof, ad.ending].map(adPage);
  const frames = refs.map((x) => x.spec);
  const vertical = ad.storyPages.map((n) => plan.designs.stories.pages[n - 1]);
  const designIds = [...new Set([splitFor(ad.id).designId, plan.designs.stories.id, ...refs.map((x) => plan.designs[x.group].id)])];
  campaign.ads.push({ id: ad.id, paid: true, status: "draft_no_budget_no_launch", title: { ru: ad.title }, caption: { ru: ad.caption }, frames: { ru: frames.map(line) }, slides: { ru: frames.map(slide) }, verticalSlides: { ru: vertical.map(slide) }, stories: { ru: [] }, ctaMode: "demo", directKeyword: ad.keyword, offer: ad.offer, qualifyingQuestion: ad.qualifyingQuestion, media: { videoSeconds: 15, audio: "none", type: "native Canva page sequence" }, distribution: { status: "draft_blocked_no_budget", primaryLocale: "ru", nativeAction: "send_instagram_message", canvaSourceDesignIds: designIds, attribution: ads.attribution }, operatorNotes: "Лента: основное изображение 4:5; доказательство и заключительная карточка приложены отдельно. Вертикальная версия: MP4 15 секунд и три исходных кадра. Нативные размещения и кнопку проверяют в Meta после согласования бюджета. Кампания не создана." });
  intake.push({ originalId: ad.id, locale: "ru", canvaDesignIds: designIds, frames: refs.map((x) => path.resolve(pageFor(x.group, x.spec.page).file)), stories: [], verticalFrames: ad.storyPages.map((n) => path.resolve(pageFor("stories", n).file)), video: path.resolve(nativeVideo(ad.id).file) });
}
await mkdir(packageDirectory, { recursive: true });
const candidate = `${base}/campaign-v5.json`;
const intakeFile = `${base}/native-intake.json`;
const campaignText = JSON.stringify(campaign, null, 2) + "\n";
await writeFile(candidate, campaignText);
await writeFile(intakeFile, JSON.stringify({ packages: intake }, null, 2) + "\n");
const run = (script, args = []) => {
  const result = spawnSync(process.execPath, [`scripts/marketing/instagram/${script}`, ...args], { cwd: root, env: { ...process.env, BAZAAR_INSTAGRAM_CAMPAIGN: path.resolve(candidate) }, encoding: "utf8", timeout: 180000 });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || "Packaging failed");
  process.stdout.write(result.stdout);
};
run("prepare.mjs");
run("ingest.mjs", [intakeFile]);
const manifest = await readJson(`${packageDirectory}/manifest.json`);
if (manifest.length !== 18 || new Set(manifest.map((x) => x.id)).size !== 18) throw new Error("Expected 18 complete packages");
for (const row of manifest) await verifyPackage(row, packageDirectory);
run("workflow.mjs", ["export"]);
const queue = await readJson(`${packageDirectory}/approved-queue.json`);
if (queue.length) throw new Error("Publication approval was not granted");
if (process.argv.includes("--promote")) {
  const current = await readFile(`${docs}/campaign.json`, "utf8");
  if (JSON.parse(current).version !== 5) {
    const archive = `${base}/previous-revision-3`;
    await mkdir(archive, { recursive: true });
    await writeFile(`${archive}/campaign.json`, current);
    for (const file of ["manifest.json", "briefs.json", "approved-queue.json", "approvals.json"]) {
      try { await copyFile(`artifacts/instagram-canva-20261103/${file}`, `${archive}/${file}`); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }
  await writeFile(`${docs}/campaign.json.tmp`, campaignText);
  await rename(`${docs}/campaign.json.tmp`, `${docs}/campaign.json`);
}
await writeFile(`${docs}/native-v5-release-verification.json`, JSON.stringify({ revision: 5, status: "complete_file_packages_not_approved_for_publication", promoted: process.argv.includes("--promote"), directory: packageDirectory, campaignHash: hash(campaignText), nativePngs: 98, reels: 6, adVideos: 4, storyFrames: 42, carouselSlides: 18, packageCount: manifest.length, packages: manifest.map((x) => ({ id: x.id, files: x.files.length, approvalHash: x.approvalHash, canvaDesignIds: x.canvaDesignIds })), approvedQueueCount: 0, publicationEnabled: false, paidBudget: null }, null, 2) + "\n");
console.log("Native release verified. No approval, scheduling or publishing performed.");
