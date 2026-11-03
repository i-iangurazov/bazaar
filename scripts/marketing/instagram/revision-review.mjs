// Review existing specialist-tool images. No artwork drawing, image editing or publication.
import { readFile, copyFile } from "node:fs/promises";
import { hash } from "./workflow.mjs";

const esc = (value = "") =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

export async function buildRevisionReview({ out, revisionPlan, revisionPreview, campaign }) {
  const draft = JSON.parse(
    await readFile("docs/marketing/instagram-2026-11/revision4-draft-preview.json", "utf8"),
  );
  const ads = JSON.parse(
    await readFile("docs/marketing/instagram-2026-11/revision4-ad-plan.json", "utf8"),
  );
  if (draft.publicationEnabled !== false || ads.paidBudget !== null) {
    throw new Error("Review must not enable publishing or assume an advertising budget");
  }
  const expected = { feed: 14, stories: 42, reels: 24, analyticsProof: 1 };
  const groupPages = {};
  for (const [kind, group] of Object.entries(draft.groups)) {
    if (group.pages.length !== expected[kind]) throw new Error(`Wrong ${kind} page count`);
    groupPages[kind] = [];
    for (const page of group.pages) {
      const bytes = await readFile(page.file);
      if (hash(bytes) !== page.sha256) throw new Error(`Stale Canva preview: ${page.file}`);
      if (page.sourceFile && hash(await readFile(page.sourceFile)) !== page.sourceSha256) {
        throw new Error(`Stale source behind Canva preview: ${page.sourceFile}`);
      }
      if (page.layout === "standalone_application_screen" && page.imageFillCount !== 1) {
        throw new Error(`Unexpected illustration or logo over an app frame: ${kind}/${page.page}`);
      }
      const filename = `revision4-draft-${kind}-${String(page.page).padStart(2, "0")}.png`;
      await copyFile(page.file, `${out}/assets/${filename}`);
      groupPages[kind].push({ ...page, filename });
    }
  }
  const carousels = [
    { ...revisionPreview, id: "p04", title: "Почему товара стало меньше?" },
    ...revisionPreview.additionalCarousels,
  ];
  const carouselPage = (id, number) => {
    const carousel = carousels.find((item) => item.id === id);
    const page = carousel?.pages.find((item) => item.number === number);
    if (!page) throw new Error(`Missing saved carousel ${id}/${number}`);
    return { ...page, filename: `revision4-${id}-${number}.png` };
  };
  const findPage = (reference) =>
    reference.carouselId
      ? carouselPage(reference.carouselId, reference.page)
      : groupPages[reference.group].find((page) => page.page === reference.page);
  const figure = (page, label) =>
    `<figure><a href="assets/${esc(page.filename)}"><img loading="lazy" width="${page.size[0]}" height="${page.size[1]}" src="assets/${esc(page.filename)}" alt="${esc(label)}"></a><figcaption>${esc(label)}</figcaption></figure>`;
  const feed = revisionPlan.items.filter((item) => item.format !== "stories");
  const cover = (item) =>
    item.format === "carousel"
      ? carouselPage(item.id, 1)
      : groupPages.feed.find((page) => page.itemId === item.id && page.role === "cover");
  const legacy = ["DU1as05gmgx", "DU1adr9gvYA", "DU1Z4sdApKw"]
    .map(
      (id, i) =>
        `<a class="tile" href="https://www.instagram.com/bazaar.pos/p/${id}/" target="_blank" rel="noreferrer"><img src="assets/existing-${i + 1}.png" alt="Существующий пост BAZAAR"><span>Существующий пост</span></a>`,
    )
    .join("");
  const anchor = (id) => (id === "p04" ? "current-carousel" : `current-${id}`);
  const stages = [
    { id: "start", label: "До выпуска", items: [] },
    {
      id: "week1",
      label: "После недели 1 · 5 новых публикаций",
      items: feed.filter((item) => item.day <= 7),
    },
    { id: "week2", label: "После недели 2 · 10 новых публикаций", items: feed },
  ];
  const grids = stages
    .map(
      (stage) =>
        `<div class="grid" data-current-grid="${stage.id}"${stage.id === "week2" ? "" : " hidden"}>${[
          ...stage.items,
        ]
          .reverse()
          .map(
            (item) =>
              `<a class="tile" href="#${anchor(item.id)}"><img src="assets/${esc(cover(item).filename)}" alt="${esc(item.title)}"><span>День ${item.day} · ${item.format === "reel" ? "Reels" : "Карусель"}</span></a>`,
          )
          .join("")}${legacy}</div>`,
    )
    .join("");
  const profile = `<section id="current-profile"><h2>Сетка профиля</h2><label for="current-profile-stage">Этап: </label><select id="current-profile-stage">${stages.map((stage) => `<option value="${stage.id}"${stage.id === "week2" ? " selected" : ""}>${stage.label}</option>`).join("")}</select><div><button data-ratio="3 / 4">Сетка 3:4</button> <button data-ratio="4 / 5">Исходные обложки 4:5</button></div>${grids}<p>Новые публикации появляются сверху слева. Десять новых обложек и три проверенных существующих поста. Размещение по дням сохраняется и в промежуточном виде после первой недели; отдельная публикация должна быть понятна сама по себе.</p></section>`;
  const reelSections = feed
    .filter((item) => item.format === "reel")
    .map((item) => {
      const scenes = groupPages.reels.filter((page) => page.itemId === item.id);
      const cards = groupPages.feed.filter((page) => page.itemId === item.id);
      return `<section id="current-${item.id}"><p class="eyebrow">День ${item.day} · Reels · черновик Canva</p><h2>${esc(item.title)}</h2><div class="strip">${scenes.map((page) => figure(page, `${page.scene} · ${page.layout === "standalone_application_screen" ? "Отдельный экран BAZAAR" : page.scene === 1 ? "Обложка" : "Следующий шаг"}`)).join("")}</div><p>Четыре сцены по 5 секунд. Проверка экспортированного MP4 — после сохранения.</p><details><summary>Обложка и заключительная карточка 4:5</summary><div class="strip">${cards.map((page) => figure(page, page.role === "cover" ? "Обложка 4:5" : "Следующий шаг 4:5")).join("")}</div></details><details><summary>Подпись</summary><pre>${esc(item.caption)}</pre></details></section>`;
    })
    .join("");
  const storySections = revisionPlan.items
    .map((item) => {
      const frames = groupPages.stories.filter((page) => page.itemId === item.id);
      const instructions = item.stories.flatMap((frame, i) => {
        if (!frame.interaction) return [];
        const interaction = frame.interaction;
        if (interaction.type === "link_sticker") {
          const url = new URL("https://www.bazaar.kg/signup");
          url.search = new URLSearchParams({
            utm_source: "instagram",
            utm_medium: "organic_social",
            utm_campaign: campaign.campaign,
            utm_content: `${item.id}_ru_story_${i + 1}`,
          }).toString();
          return [`Кадр ${i + 1}: настоящий стикер регистрации со ссылкой ${url.href}`];
        }
        if (interaction.type === "question_sticker")
          return [`Кадр ${i + 1}: настоящий стикер вопроса «${interaction.question}»`];
        if (interaction.type === "poll")
          return [
            `Кадр ${i + 1}: настоящий опрос «${interaction.question || "Как ищете товар на кассе?"}» — ${(interaction.answers ?? interaction.options ?? []).join(" / ")}`,
          ];
        return [
          `Кадр ${i + 1}: ${interaction.keyword ? `напишите «${interaction.keyword}» в Direct.` : "ответ на Stories или сообщение в Direct."}`,
        ];
      });
      return `<section id="current-story-${item.id}"><p class="eyebrow">День ${item.day} · Stories · три кадра</p><h2>${esc(item.title)}</h2><div class="strip stories">${frames.map((page) => figure(page, `Кадр ${page.frame} · ${page.layout === "standalone_application_screen" ? "Отдельный экран BAZAAR" : page.layout === "standalone_plan_information" ? "Информация" : "Карточка"}`)).join("")}</div>${instructions.length ? `<details><summary>Что добавить в Instagram</summary><ul>${instructions.map((line) => `<li>${esc(line)}</li>`).join("")}</ul><p>Интерактивные стикеры добавляются в Instagram. Их нет на изображении в виде некликабельных кнопок.</p></details>` : ""}</section>`;
    })
    .join("");
  const adSections = ads.concepts
    .map(
      (ad) =>
        `<section id="current-${ad.id}"><p class="eyebrow">Рекламная концепция · не запущена</p><h2>${esc(ad.title)}</h2><p>${esc(ad.offer)}</p><h3>Лента · основное изображение и отдельные доказательства</h3><div class="strip">${[ad.feed, ad.proof, ad.ending].map((reference, i) => figure(findPage(reference), ["Основное изображение 4:5", "Отдельный экран продукта", "Следующий шаг"][i])).join("")}</div><h3>Вертикальная версия · три сцены для видео</h3><div class="strip stories">${ad.storyPages
          .map((number, i) =>
            figure(
              groupPages.stories.find((page) => page.page === number),
              `Сцена ${i + 1}`,
            ),
          )
          .join(
            "",
          )}</div><details><summary>Текст и квалификация заявки</summary><pre>${esc(ad.caption)}</pre><p><b>Вопрос:</b> ${esc(ad.qualifyingQuestion)}</p><p>Платный источник Direct подтверждают по данным Meta, а не по ключевому слову.</p></details></section>`,
    )
    .join("");
  const extraFeed = groupPages.feed.filter((page) => page.role === "proof");
  const html = `${profile}<h2 id="current-reels">Шесть Reels · последовательности сцен</h2>${reelSections}<h2 id="current-stories">Stories · две недели</h2><p>В дни ленты: первые два кадра в 12:30, заключительный в 19:45; лента в 19:30. В дни без ленты: три кадра в 12:30. Это стартовая гипотеза по времени Бишкека; даты и корректировки выбираются по готовности и данным аккаунта.</p>${storySections}<h2 id="current-ads">Четыре рекламные концепции</h2><p>Бюджет не согласован. Основные форматы: одно изображение 4:5 и видео 9:16. Предпросмотр размещений в Meta остаётся перед запуском. Результат — квалифицированные обращения, стоимость регистрации и привлечение подписки.</p>${adSections}<details><summary>Дополнительные отдельные экраны 4:5 · касса и инвентаризация</summary><div class="strip">${extraFeed.map((page) => figure(page, page.itemId === "ad-pos" ? "Касса · поиск товара" : "Инвентаризация · строка сверки")).join("")}</div></details><section id="current-template"><h2>Повторный выпуск</h2><p>Доступный способ повторного выпуска: копия макета и замена подготовленных изображений через Canva. Так собрана эта серия. Оригинальный логотип сохраняется отдельно. Автозаполнение Canva ранее было ограничено тарифом; платное обновление не выполнялось.</p><p>Новый бриф → ImageGen по выбранному эталону → сборка в Canva → проверка → согласование → очередь публикации. Публикация сейчас выключена. Опросы и ссылки добавляются как настоящие стикеры Instagram.</p></section>`;
  return {
    profile,
    reels: `<h1>Шесть Reels · черновики Canva</h1>${reelSections}`,
    stories: `<h1>Stories · 14 дней × 3 кадра</h1>${storySections}`,
    ads: `<h1>Рекламные концепции · запуск выключен</h1>${adSections}`,
    navigation: `<nav><a class="link" href="#current-profile">Сетка</a><a class="link" href="#current-calendar">План</a><a class="link" href="#current-reels">Reels</a><a class="link" href="#current-stories">Stories</a><a class="link" href="#current-ads">Реклама</a><a class="link" href="#current-template">Повторный выпуск</a></nav>`,
    html,
  };
}
