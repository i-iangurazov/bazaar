// Build a local review gallery from existing specialist-tool exports.
// Displays unmodified files. Does not draw or export artwork, approve or publish.
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import path from "node:path";

const root = "artifacts/instagram-canva-20261103";
const out = `${root}/review-p04-v4`;
const campaign = JSON.parse(
  await readFile("docs/marketing/instagram-2026-11/campaign.json", "utf8"),
);
const sources = JSON.parse(await readFile(`${root}/production/assets.json`, "utf8"));
const manifest = JSON.parse(await readFile(`${root}/manifest.json`, "utf8"));
const esc = (s = "") =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
await mkdir(`${out}/assets`, { recursive: true });
for (const s of sources) await copyFile(`${root}/${s.file}`, `${out}/assets/${s.id}.png`);
for (const row of manifest)
  for (const f of row.files) await copyFile(`${root}/${f.file}`, `${out}/assets/${f.file}`);

const nativeVertical = (id) => {
  const match = /^(r\d+)_ru_vertical_0([1-4])$/.exec(id);
  return match ? `${match[1]}_ru-${match[2]}.png` : `${id}.png`;
};
const image = (file, alt, label = "") =>
  `<figure><a href="assets/${esc(file)}" download><img loading="lazy" src="assets/${esc(file)}" alt="${esc(alt)}"></a>${label ? `<figcaption>${esc(label)}</figcaption>` : ""}</figure>`;
const cta = (i) =>
  i.ctaMode === "signup"
    ? "Регистрация"
    : i.ctaMode === "question"
      ? "Ответ на Stories"
      : `«${i.directKeyword}» в Direct`;
const time = (s) => s?.slice(11, 16) ?? "";
const briefLink = (i) => {
  const url = new URL("https://www.bazaar.kg/ru");
  url.search = new URLSearchParams({
    utm_source: "instagram",
    utm_medium: i.paid ? "paid_social" : "organic_social",
    utm_campaign: campaign.campaign,
    utm_content: `${i.id}_ru`,
  }).toString();
  return url.href;
};
const nativeInstructions = (i) =>
  (i.storyInteractions ?? []).map((x) => {
    if (x.type === "link_sticker")
      return `Кадр ${x.frame}: настоящий стикер «${x.text}» со ссылкой ${briefLink(i)}`;
    if (x.type === "poll")
      return `Кадр ${x.frame}: настоящий опрос «${x.question}», ответы: ${x.answers.join(" / ")}.`;
    if (x.type === "question_sticker")
      return `Кадр ${x.frame}: настоящий стикер вопроса «${x.question}».`;
    return `Кадр ${x.frame}: разрешить ответы на Stories.${x.keyword ? ` Ключевое слово «${x.keyword}».` : ""}`;
  });
const feed = campaign.items.filter((i) => i.format !== "stories");
const tiles = [...feed]
  .reverse()
  .map(
    (i) =>
      `<a class="tile" href="#${i.id}"><img src="assets/${esc(i.artworkSources.cover)}.png" alt="${esc(i.title.ru)}"><span>${i.id.toUpperCase()} · ${i.date.slice(5)}</span></a>`,
  )
  .join("");
const legacy = [
  ["DU1as05gmgx", "Кассы и смены в BAZAAR POS"],
  ["DU1adr9gvYA", "BAZAAR POS на двух языках"],
  ["DU1Z4sdApKw", "Что такое BAZAAR POS?"],
]
  .map(
    ([id, title], n) =>
      `<a class="tile" href="https://www.instagram.com/bazaar.pos/p/${id}/" target="_blank" rel="noreferrer"><img src="assets/existing-${n + 1}.png" alt="${esc(title)}"><span>Существующий пост</span></a>`,
  )
  .join("");

const sections = campaign.items
  .map((i) => {
    const ready = manifest.some((x) => x.id === `${i.id}_ru`);
    const content =
      i.format === "reel"
        ? `<div class="video"><video controls preload="none" poster="assets/${i.artworkSources.cover}.png" src="assets/${i.id}_ru.mp4"></video><p>20 секунд · 1080×1920 · четыре карточки по 5 секунд · без звука. Canva; предметные иллюстрации, без записи экрана продукта.</p><a href="assets/${i.id}_ru.mp4" download>Скачать MP4</a></div>`
        : i.format === "carousel"
          ? `<div class="strip">${i.artworkSources.frames.map((x, n) => image(`${x}.png`, i.slides.ru[n].title, `Слайд ${n + 1} · исходник; экспорт 1080×1350 ожидается`)).join("")}</div>`
          : "";
    const stories = `<h3>Stories · 3 кадра</h3><div class="strip stories">${i.artworkSources.stories.map((x, n) => image(ready ? `${i.id}_ru-story-${n + 1}.png` : `${x}.png`, i.storySlides.ru[n].title, `${n + 1} · ${time(i.distribution.storyFrames[n].at)} · ${ready ? "1080×1920" : "исходник; финальный экспорт ожидается"}`)).join("")}</div>`;
    return `<section id="${i.id}"><p class="eyebrow">День ${i.day} · ${i.date} · ${i.format === "reel" ? "Reels" : i.format === "carousel" ? "Карусель" : "Только Stories"}${i.distribution.feedAt ? ` · лента ${time(i.distribution.feedAt)}` : ""}</p><h2>${esc(i.title.ru)}</h2><p><b>Действие:</b> ${esc(cta(i))}. <span class="badge">${ready ? "Полный черновой пакет; не согласован" : "Изображения созданы; финальный экспорт ожидается"}</span></p>${content}${stories}<details><summary>Подпись, стикеры и ссылки</summary><pre>${esc(i.caption.ru || "В этот день публикации в ленте нет.")}</pre><ul>${nativeInstructions(
      i,
    )
      .map((x) => `<li>${esc(x)}</li>`)
      .join(
        "",
      )}</ul><p>Положение стикеров проверить в Instagram перед публикацией.</p>${i.ctaMode === "signup" ? `<p><a href="${esc(briefLink(i))}" target="_blank" rel="noreferrer">Размеченная ссылка для Stories</a></p>` : ""}</details></section>`;
  })
  .join("");
const ads = campaign.ads
  .map(
    (i) =>
      `<section id="${i.id}"><p class="eyebrow">${i.id.toUpperCase()} · реклама · не запущена</p><h2>${esc(i.title.ru)}</h2><p>Бюджет не согласован. Нативное действие: «Отправить сообщение». ${esc(cta(i))}.</p><h3>Лента · 3 карточки</h3><div class="strip">${i.artworkSources.frames.map((x, n) => image(`${x}.png`, i.slides.ru[n].title, `Кадр ${n + 1} · исходник`)).join("")}</div><h3>Вертикальное размещение · 3 карточки</h3><div class="strip stories">${i.artworkSources.verticalFrames.map((x, n) => image(nativeVertical(x), i.verticalSlides.ru[n].title, `Кадр ${n + 1}`)).join("")}</div><details><summary>Текст объявления и измерение</summary><pre>${esc(i.caption.ru)}</pre><p>Считать обращение рекламным только при подтверждении источника по данным объявления/диалога Meta. Общее ключевое слово с органикой не доказывает платный источник.</p></details></section>`,
  )
  .join("");

await writeFile(
  `${out}/index.html`,
  `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BAZAAR — двухнедельный выпуск</title><style>
html{scroll-behavior:smooth}body{margin:0;background:#f2f5fc;color:#10182f;font:16px/1.5 system-ui,sans-serif}main{max-width:1140px;margin:auto;padding:28px 22px}h1{font-size:30px;line-height:1.2}h2{line-height:1.2}nav{display:flex;gap:10px;flex-wrap:wrap;margin:20px 0}button,a.link{font:inherit;background:white;border:1px solid #c7d5f6;border-radius:8px;padding:8px 14px;color:#063cd2;cursor:pointer}a{color:#063cd2;overflow-wrap:anywhere}.notice{background:#fff;padding:18px;border-left:4px solid #063cd2}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;max-width:750px;margin:24px auto}.tile{position:relative;display:block;overflow:hidden;aspect-ratio:3/4;background:white}.tile img{width:100%;height:100%;object-fit:cover}.tile span{position:absolute;bottom:5px;left:5px;background:#fffe;color:#10182f;font-size:11px;padding:2px 5px}section{background:white;padding:22px;border-radius:12px;margin:24px 0;scroll-margin-top:15px}.strip{display:flex;gap:12px;overflow-x:auto;padding:10px 0 18px}.strip figure{margin:0;flex:none;width:260px}.strip img{display:block;width:100%;height:auto;border:1px solid #e8ecf4}.stories figure{width:220px}figcaption,.eyebrow{font-size:13px;color:#4e5d77}video{display:block;width:min(100%,340px);max-height:680px;background:#dde6f8}.video p{max-width:600px}pre{white-space:pre-wrap;font:inherit;overflow-wrap:anywhere}summary{cursor:pointer;color:#063cd2}.badge{display:inline-block;padding:3px 8px;background:#eaf0ff;font-size:13px;border-radius:4px}td,th{text-align:left;padding:7px 10px;border-bottom:1px solid #e8ecf4;vertical-align:top}table{border-collapse:collapse;width:100%}.table-wrap{overflow-x:auto}@media(max-width:600px){main{padding:18px 10px}section{padding:16px}.tile span{font-size:9px}.strip figure{width:250px}.stories figure{width:220px}h1{font-size:26px}}
</style></head><body><main><h1>BAZAAR · двухнедельный выпуск</h1><p>Просмотр материалов перед согласованием. Публикация выключена.</p><div class="notice"><b>Создано:</b> 10 обложек, 16 слайдов каруселей, 42 кадра Stories и 4 рекламные концепции в двух форматах. Шесть настоящих MP4 из Canva.<br><b>Полностью проверены по комплектности:</b> 6 черновых пакетов Reels и 18 поддерживающих Stories. Остальным карточкам нужен финальный экспорт из приложения.<br>Утверждённых пакетов 0. Даты 4–17 ноября — проект; при задержке начало сдвигается целиком.</div><nav><a class="link" href="#calendar">План</a><a class="link" href="#r01">Материалы по дням</a><a class="link" href="#ads">Рекламные концепции</a><button data-ratio="4 / 5">Обложки 4:5</button><button data-ratio="3 / 4">Сетка 3:4</button><button data-ratio="1 / 1">Проверить 1:1</button></nav><h2>Как будет выглядеть сетка</h2><div class="grid">${tiles}${legacy}</div><p>Десять новых обложек и три существующих поста. Новые сверху слева. Веб-ячейка 3:4 измерена в личном Chrome; мобильная обрезка и права публикации ещё не проверены. Старые посты показаны экранными превью.</p><section id="calendar"><h2>14 дней · время Бишкека</h2><div class="table-wrap"><table><thead><tr><th>Дата</th><th>Материал</th><th>Действие</th></tr></thead><tbody>${campaign.items.map((i) => `<tr><td>${i.date.slice(5)}</td><td><a href="#${i.id}">${esc(i.title.ru)}</a></td><td>${esc(cta(i))}</td></tr>`).join("")}</tbody></table></div><p>В дни ленты Stories: 12:30, 12:30, 19:45; лента: 19:30. В дни без ленты — три Stories в 12:30. Стартовая гипотеза для проверки по данным аккаунта.</p></section>${sections}<h2 id="ads">Рекламные концепции · без запуска</h2>${ads}<p>Основной результат: квалифицированные обращения и регистрации бизнеса. Фотографии товаров — иллюстрации ИИ, без вымышленных клиентских результатов. Эта страница показывает готовые изображения и видео; она не создаёт постеры.</p></main><script>for(const b of document.querySelectorAll('button[data-ratio]'))b.addEventListener('click',()=>{for(const t of document.querySelectorAll('.tile'))t.style.aspectRatio=b.dataset.ratio});</script></body></html>`,
);
console.log(
  `Review gallery: ${path.resolve(out, "index.html")}. No artwork created or publication performed.`,
);
