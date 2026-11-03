// Prepare text, verified offers and tracking links for specialised design tools.
// This script does not draw, render, resize or publish visual content.
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
const campaignFile = process.env.BAZAAR_INSTAGRAM_CAMPAIGN ?? "docs/marketing/instagram-2026-11/campaign.json";
const campaign = JSON.parse(
  await readFile(campaignFile, "utf8"),
);
const dir = campaign.packageDirectory ?? "artifacts/instagram-canva-20261103";
await mkdir(dir, { recursive: true });
const briefs = [];
for (const item of [...campaign.items, ...campaign.ads])
  for (const locale of campaign.locales ?? ["ru", "kg"]) {
    const id = `${item.id}_${locale}`;
    const landing = new URL(`https://www.bazaar.kg/${item.ctaMode === "signup" ? "signup" : locale}`);
    landing.search = new URLSearchParams({
      utm_source: "instagram",
      utm_medium: item.paid ? "paid_social" : "organic_social",
      utm_campaign: campaign.campaign,
      utm_content: id,
    }).toString();
    const demo = new URL("https://wa.me/996709911300");
    demo.searchParams.set(
      "text",
      `${locale === "ru" ? "Здравствуйте! Хочу посмотреть BAZAAR." : "Саламатсызбы! BAZAAR менен таанышкым келет."} [IG:${item.id.toUpperCase()}:${locale.toUpperCase()}]`,
    );
    const brief = {
      id,
      originalId: item.id,
      locale,
      type: item.paid ? "ad" : item.format,
      paid: !!item.paid,
      date: item.date ?? null,
      time: item.time ?? null,
      storyTime: item.storyTime ?? null,
      distribution: item.distribution ?? null,
      selectedForFirstRelease: !item.paid && locale === item.distribution?.primaryLocale,
      timezone: campaign.timezone,
      title: item.title[locale],
      caption: item.caption[locale],
      operatorNotes: item.operatorNotes ?? null,
      slides: item.slides?.[locale] ?? [],
      verticalSlides: item.verticalSlides?.[locale] ?? [],
      stories: item.stories?.[locale] ?? [],
      storyInteractions: (item.storyInteractions ?? []).map((interaction) => {
        if (interaction.type !== "link_sticker") return interaction;
        const url = new URL(landing);
        url.searchParams.set("utm_content", interaction.utmContent ?? id);
        return { ...interaction, url: url.href };
      }),
      ctaMode: item.ctaMode,
      directKeyword: item.directKeyword ?? null,
      artworkSources: item.artworkSources ?? null,
      brandRules: campaign.brandRules,
      landingUrl: landing.href,
      demoUrl: demo.href,
      status: "awaiting_specialist_design_exports",
    };
    briefs.push(brief);
    await writeFile(
      `${dir}/${id}-copy.txt`,
      `Подпись к публикации:\n${brief.caption || "В этот день — только Stories, подпись ленты не используется."}\n\nТекст карточек:\n${brief.slides.map((s, i) => `${i + 1}. ${s.title}\n${s.body}`).join("\n\n")}\n\n${brief.verticalSlides.length ? `Вертикальные сцены рекламы:\n${brief.verticalSlides.map((s, i) => `${i + 1}. ${s.title}\n${s.body}`).join("\n\n")}\n\n` : ""}Stories:\n${brief.stories.join("\n\n")}\n\nНастоящие стикеры Instagram (добавить при подготовке публикации):\n${JSON.stringify(brief.storyInteractions, null, 2)}\n\nСсылка с метками: ${brief.landingUrl}\n${brief.operatorNotes ? `\nЗаметки для ведущего аккаунта (не публиковать):\n${brief.operatorNotes}\n` : ""}`,
    );
    if (item.format === "reel") {
      const srt = item.frames[locale]
        .map(
          (line, i) =>
            `${i + 1}\n00:00:${String(i * 5).padStart(2, "0")},000 --> 00:00:${String((i + 1) * 5).padStart(2, "0")},000\n${line}\n`,
        )
        .join("\n");
      await writeFile(`${dir}/${id}.srt`, srt);
    }
  }
await writeFile(`${dir}/briefs.json`, JSON.stringify(briefs, null, 2));
for (const name of ["manifest.json", "approved-queue.json"]) {
  try {
    await access(`${dir}/${name}`);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    await writeFile(`${dir}/${name}`, "[]\n");
  }
}
console.log(
  `Prepared ${briefs.length} factual content briefs. No images, video, approvals or publications created.`,
);
