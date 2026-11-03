// Display unmodified Canva previews and verify their provenance. This does not draw artwork.
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const root = process.cwd();
const docs = path.join(root, "docs/marketing/instagram-2026-11");
const production = path.join(root, "artifacts/instagram-canva-20261103/production/revision5");
const out = path.join(root, "artifacts/instagram-canva-20261103/review-native-v5");
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const plan = await readJson(path.join(docs, "native-v5-plan.json"));
const previews = await readJson(path.join(docs, "native-v5-preview.json"));
const editorial = await readJson(path.join(docs, "revision-plan.json"));
const ads = await readJson(path.join(docs, "revision4-ad-plan.json"));
const videos = await readJson(path.join(production, "exports/video-evidence.json")).catch((error) => {
  if (error.code === "ENOENT") return [];
  throw error;
});
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
if (plan.publicationEnabled !== false || ads.paidBudget !== null || previews.pages.length !== 98) throw new Error("Invalid review or release state");
await mkdir(path.join(out, "assets"), { recursive: true });
for (const video of videos) {
  const bytes = await readFile(path.join(root, video.file));
  if (sha(bytes) !== video.sha256 || video.fullDecode !== "passed") throw new Error(`Unverified video: ${video.id}`);
  await copyFile(path.join(root, video.file), path.join(out, "assets", `${video.id}.mp4`));
}
const sourceLink = (id, group) => {
  const split = plan.splitDesigns?.find((x) => x.key === id);
  const url = split?.editUrl ?? plan.designs[group].urls.edit_url;
  return `<p><a href="${esc(url)}" target="_blank" rel="noopener">Редактировать в Canva</a></p>`;
};
const videoPreview = (id) => videos.some((x) => x.id === `${id}_ru`)
  ? `<video class="video" controls preload="metadata" src="assets/${esc(id)}_ru.mp4"></video><p><a href="assets/${esc(id)}_ru.mp4" download>Скачать проверенный MP4</a></p>`
  : "<p>Видеофайл ещё не выгружен.</p>";
const expected = { carousels: 18, feed: 14, stories: 42, reels: 24 };
const media = new Map();
for (const [key, design] of Object.entries(plan.designs)) {
  if (design.pages.length !== expected[key]) throw new Error(`Unexpected ${key} page count`);
  for (const page of design.pages) {
    const evidence = previews.pages.find((x) => x.group === key && x.page === page.page);
    if (!evidence || evidence.nativeTextCount !== 2 || evidence.originalLogoCount !== 1) throw new Error(`Missing native layers: ${key}/${page.page}`);
    const bytes = await readFile(path.join(root, evidence.file));
    if (sha(bytes) !== evidence.sha256) throw new Error(`Stale Canva preview: ${evidence.file}`);
    for (const source of evidence.sources) {
      if (sha(await readFile(path.join(root, source.file))) !== source.sha256) throw new Error(`Stale source: ${source.file}`);
    }
    const filename = `${key}-${String(page.page).padStart(2, "0")}.png`;
    await copyFile(path.join(root, evidence.file), path.join(out, "assets", filename));
    media.set(`${key}/${page.page}`, { ...page, filename, group: key, actualSize: evidence.size });
  }
}
const get = (group, page) => {
  const result = media.get(`${group}/${page}`);
  if (!result) throw new Error(`Missing page ${group}/${page}`);
  return result;
};
const fig = (page, label = page.headline.replaceAll("\n", " ")) => `<figure><a href="assets/${page.filename}"><img loading="lazy" width="${page.actualSize[0]}" height="${page.actualSize[1]}" src="assets/${page.filename}" alt="${esc(label)}"></a><figcaption>${esc(label)} · ${page.layout === "application" ? "Отдельный экран приложения" : page.layout === "information" ? "Нативный текст" : "Текст, логотип и фото отдельно"}</figcaption></figure>`;
const itemPages = (group, id) => [...media.values()].filter((x) => x.group === group && x.itemId === id);
const cover = (id) => itemPages("carousels", id).find((x) => x.slide === 1) || itemPages("feed", id).find((x) => x.role === "cover");
const feedItems = editorial.items.filter((x) => x.format !== "stories");
const legacyIds = ["DU1as05gmgx", "DU1adr9gvYA", "DU1Z4sdApKw"];
for (let i = 1; i <= 3; i++) await copyFile(path.join(root, `artifacts/instagram-canva-20261103/review-p04-v4/assets/existing-${i}.png`), path.join(out, `assets/existing-${i}.png`));
const legacy = legacyIds.map((id, i) => `<a class="tile" href="https://www.instagram.com/bazaar.pos/p/${id}/"><img src="assets/existing-${i + 1}.png" alt="Существующий пост BAZAAR"><span>Существующий пост</span></a>`).join("");
const grids = [{ id: "start", days: 0 }, { id: "week1", days: 7 }, { id: "week2", days: 14 }].map((stage) => `<div class="grid" data-stage="${stage.id}"${stage.id === "week2" ? "" : " hidden"}>${feedItems.filter((x) => x.day <= stage.days).reverse().map((x) => `<a class="tile" href="index.html#${x.id}"><img src="assets/${cover(x.id).filename}" alt="${esc(x.title)}"><span>День ${x.day} · ${x.format === "reel" ? "Reels" : "Карусель"}</span></a>`).join("")}${legacy}</div>`).join("");
const grid = `<section id="grid"><h2>Сетка профиля</h2><label>Этап <select id="stage"><option value="start">Сейчас</option><option value="week1">После первой недели</option><option value="week2" selected>После двух недель</option></select></label><button data-ratio="3 / 4">Профиль 3:4</button><button data-ratio="4 / 5">Исходник 4:5</button>${grids}<p>Порядок: новые публикации сверху слева. В сетке — 10 новых обложек и 3 существующих поста. Кадрирование профиля показано отдельно от исходных файлов.</p></section>`;
const carouselSections = editorial.items.filter((x) => x.format === "carousel").map((item) => `<section id="${item.id}"><p>День ${item.day} · Карусель</p><h2>${esc(item.title)}</h2>${sourceLink(item.id, "carousels")}<div class="strip">${itemPages("carousels", item.id).map((x) => fig(x, `${x.slide}. ${x.headline.replaceAll("\n", " ")}`)).join("")}</div><details><summary>Подпись</summary><pre>${esc(item.caption)}</pre></details></section>`).join("");
const reelSections = editorial.items.filter((x) => x.format === "reel").map((item) => `<section id="${item.id}"><p>День ${item.day} · Reels</p><h2>${esc(item.title)}</h2>${sourceLink(item.id, "reels")}${videoPreview(item.id)}<div class="strip vertical">${itemPages("reels", item.id).map((x) => fig(x, `${x.scene}. ${x.headline.replaceAll("\n", " ")}`)).join("")}</div><p>4 сцены по 5 секунд, без звука. Скриншоты приложения показаны отдельными сценами. Ниже — предпросмотры исходных страниц Canva.</p><details><summary>Обложка и заключительная карточка 4:5</summary><div class="strip">${itemPages("feed", item.id).map((x) => fig(x)).join("")}</div></details><details><summary>Подпись</summary><pre>${esc(item.caption)}</pre></details></section>`).join("");
const stories = editorial.items.map((item) => `<section id="story-${item.id}"><p>День ${item.day} · 3 Stories</p><h2>${esc(item.title)}</h2><div class="strip vertical">${itemPages("stories", item.id).map((x) => fig(x, `Кадр ${x.frame}: ${x.headline.replaceAll("\n", " ")}`)).join("")}</div><details><summary>Действие в Instagram</summary><ul>${itemPages("stories", item.id).filter((x) => x.interaction).map((x) => {
  const a = x.interaction;
  if (a.type === "link_sticker") return `<li>Кадр ${x.frame}: настоящий стикер «Создать аккаунт». Ссылка с метками: <a href="https://www.bazaar.kg/signup?utm_source=instagram&amp;utm_medium=organic_social&amp;utm_campaign=kg_store_launch_202611&amp;utm_content=s14_ru_story_3">Регистрация BAZAAR</a>.</li>`;
  if (a.type === "poll") return `<li>Кадр ${x.frame}: опрос «${esc(a.question)}» — ${esc((a.answers || []).join(" / "))}.</li>`;
  if (a.type === "question_sticker") return `<li>Кадр ${x.frame}: стикер вопроса «${esc(a.question)}».</li>`;
  return `<li>Кадр ${x.frame}: ${a.keyword ? `напишите «${esc(a.keyword)}» в Direct` : "ответ на Stories или сообщение в Direct"}.</li>`;
}).join("")}</ul><p>Опросы и ссылки добавляются как настоящие стикеры Instagram. На карточках нет нарисованных кнопок.</p></details></section>`).join("");
const findAd = (ref) => ref.carouselId ? itemPages("carousels", ref.carouselId).find((x) => x.slide === ref.page) : ref.group === "analyticsProof" ? get("feed", 14) : get(ref.group, ref.page);
const adSections = ads.concepts.map((ad) => `<section id="${ad.id}"><p>Рекламная концепция · не запущена</p><h2>${esc(ad.title)}</h2><p>${esc(ad.offer)}</p><div class="strip">${[ad.feed, ad.proof, ad.ending].map(findAd).map((x) => fig(x)).join("")}</div><h3>Вертикальная версия</h3><div class="strip vertical">${ad.storyPages.map((n) => fig(get("stories", n))).join("")}</div><details><summary>Текст и квалификация обращения</summary><pre>${esc(ad.caption)}</pre><p>${esc(ad.qualifyingQuestion)}</p></details></section>`).join("");
const css = `*{box-sizing:border-box}body{margin:0;background:#f4f6fb;color:#10162b;font:16px/1.5 system-ui,sans-serif}main{max-width:1240px;margin:auto;padding:28px}h1{font-size:30px}h2{font-size:25px}section{padding:24px;background:white;border-radius:16px;margin:24px 0;scroll-margin-top:18px}nav{display:flex;gap:18px;flex-wrap:wrap;margin:20px 0}a{color:#063cd8}button,select{font:inherit;padding:8px 12px;margin:4px;border:1px solid #c7cfdf;background:white;border-radius:8px;color:#10162b}img{display:block;max-width:100%;height:auto}.strip{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;align-items:start}.strip.vertical{grid-template-columns:repeat(3,minmax(0,1fr))}figure{margin:0}figcaption{font-size:13px;margin-top:8px;color:#4d586e}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}details{margin-top:16px}summary{cursor:pointer}.notice{border-left:4px solid #063cd8;padding:12px 16px;background:#eaf0ff}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:3px;max-width:720px;margin:20px auto}.grid[hidden]{display:none}.tile{position:relative;aspect-ratio:var(--tile-ratio,3/4);overflow:hidden;background:#e5eaf2}.tile img{width:100%;height:100%;object-fit:cover}.tile span{position:absolute;bottom:0;left:0;right:0;font-size:11px;background:#fffffff0;color:#10162b;padding:3px 5px}.proof{max-width:1000px;margin:auto}@media(max-width:700px){main{padding:12px}section{padding:16px}.strip,.strip.vertical{grid-template-columns:1fr}h1{font-size:25px}.grid{gap:2px}.tile span{font-size:9px}}`;
const saved = plan.sourceSaveStatus === "committed" && previews.status === "saved_native_sources_verified";
const sourceStatus = saved ? "Все 98 страниц сохранены и повторно проверены в Canva." : "Все 98 страниц — черновик до подтверждения сохранения.";
const sourceList = `<section><h2>Редактируемые исходники</h2><p><a href="${esc(plan.canvaFolder?.url ?? plan.designs.carousels.urls.edit_url)}" target="_blank" rel="noopener">Открыть папку выпуска в Canva</a></p><ul>${Object.entries(plan.designs).map(([key, design]) => `<li><a href="${esc(design.urls.edit_url)}" target="_blank" rel="noopener">${esc({carousels:"4 карусели",feed:"Обложки и рекламные адаптации",stories:"Stories",reels:"Сцены 6 Reels"}[key])}</a> · ${design.pages.length} страниц</li>`).join("")}</ul><p>В галерее — предпросмотры Canva уменьшенного размера. Для публикации нужны полноразмерные экспорты. Проверено MP4: ${videos.length}. Публикация и рекламный запуск выключены.</p></section>`;
const header = `<h1>BAZAAR · редактируемая редакция 5</h1><p class="notice">Тексты — нативные объекты Canva. Логотип и фотография — отдельные слои. Реальные экраны находятся на самостоятельных страницах. ${sourceStatus} Публикация выключена, рекламный бюджет не задан.</p><nav><a href="index.html">Весь выпуск</a><a href="grid.html">Сетка</a><a href="carousels.html">Карусели</a><a href="reels.html">Reels</a><a href="stories.html">Stories</a><a href="ads.html">Реклама</a></nav>`;
const script = `<script>document.querySelector('#stage')?.addEventListener('change',e=>document.querySelectorAll('[data-stage]').forEach(g=>g.hidden=g.dataset.stage!==e.target.value));document.querySelectorAll('[data-ratio]').forEach(b=>b.addEventListener('click',()=>document.documentElement.style.setProperty('--tile-ratio',b.dataset.ratio)));</script>`;
const doc = (body) => `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BAZAAR · Редактируемый выпуск v5</title><style>${css}.video{display:block;width:min(100%,360px);height:auto;margin-bottom:16px}</style><main>${header}${sourceList}${body}</main>${script}</html>`;
const workflow = `<section><h2>Как редактировать и повторять выпуск</h2><p><a href="https://www.canva.com/design/DAHZ4ucV4ig/1J_zpTRC7RZhQIfsmGkSnA/edit">Проверенный нативный мастер в Canva</a>. Двойной щелчок по заголовку или подписи открывает текст. Логотип и фото выбираются отдельно в панели «Слои». Оригинальный заголовок изменяли, сохраняли, открывали повторно и восстанавливали.</p><p>Новая тема → копия проверенного мастера → замена текста и фотографии → проверка обещаний, сетки и мобильного вида → согласование → экспорт → разрешённая очередь. На иллюстративных фотографиях нет впаянных надписей. Скриншоты интерфейса остаются достоверными изображениями приложения.</p><p>Основные показатели: квалифицированные обращения от уникальных бизнесов, стоимость обращения, регистрации и подтверждённого привлечения подписки. Время выпуска — гипотеза по Бишкеку: Stories в 12:30, лента в 19:30, заключительный кадр в 19:45. Даты ещё не назначены.</p></section>`;
for (const [name, body] of Object.entries({ "index.html": grid + carouselSections + reelSections + stories + adSections + workflow, "grid.html": grid, "carousels.html": carouselSections, "reels.html": reelSections, "stories.html": stories, "ads.html": adSections })) await writeFile(path.join(out, name), doc(body));
await writeFile(path.join(production, "review-build.json"), JSON.stringify({ output: out, previews: previews.pages.length, nativeTextObjects: 196, publicationEnabled: false, paidBudget: null }, null, 2));
console.log(`Native review: ${out} · 98 unmodified Canva previews`);
