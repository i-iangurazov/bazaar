import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createSyntheticEmailGallery } from "./transactionalEmailFixture";

/** Called only by the explicit synthetic-preview test flag, never by the application. */
export async function writeSyntheticEmailPreview(directory: string) {
  await mkdir(directory, { recursive: true });
  await copyFile(join(process.cwd(), "public/brand/logo.png"), join(directory, "logo.png"));
  const gallery = createSyntheticEmailGallery();
  for (const item of gallery) {
    await writeFile(join(directory, `${item.name}.html`), item.html, "utf8");
    await writeFile(join(directory, `${item.name}.txt`), `${item.subject}\n\n${item.text}`, "utf8");
  }
  await writeFile(
    join(directory, "manifest.json"),
    JSON.stringify(
      gallery.map(({ name, locale, subject }) => ({
        name,
        locale,
        subject,
        html: `${name}.html`,
        text: `${name}.txt`,
      })),
      null,
      2,
    ),
    "utf8",
  );
  const options =
    gallery.map(({ name }) => `<option value="${name}.html">${name}</option>`).join("") +
    '<option value="marketing-v2.html">marketing-v2 (synthetic merchant campaign)</option>';
  await writeFile(
    join(directory, "index.html"),
    `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Синтетические письма Bazaar</title><style>body{margin:24px;background:#e5e7eb;color:#111827;font:16px Arial,sans-serif}header{max-width:1000px;margin:auto auto 24px}label{display:block;margin:16px 0}select{max-width:100%;padding:10px}main{display:flex;flex-wrap:wrap;justify-content:center;align-items:start;gap:24px}section{min-width:0}iframe{border:1px solid #9ca3af;height:960px;background:white;max-width:100%}p{line-height:1.5}a{color:#1d4ed8}</style></head><body><header><h1>Письма Bazaar: синтетические данные</h1><p>Реальные генераторы; отправка, база данных и провайдеры не используются. Ссылки внутри писем ведут на синтетические адреса. Макеты ниже показывают ширину 560 и 375 пикселей.</p><label>Письмо <select id="email">${options}</select></label><a id="standalone" href="${gallery[0].name}.html" target="_blank">Открыть отдельно</a></header><main><section><h2>560 px</h2><iframe id="desktop" title="Письмо, ширина 560 пикселей" width="560" src="${gallery[0].name}.html"></iframe></section><section><h2>375 px</h2><iframe id="mobile" title="Письмо, ширина 375 пикселей" width="375" src="${gallery[0].name}.html"></iframe></section></main><script>document.querySelector('#email').addEventListener('change',function(){document.querySelector('#desktop').src=this.value;document.querySelector('#mobile').src=this.value;document.querySelector('#standalone').href=this.value;});</script></body></html>`,
    "utf8",
  );
  return gallery.length;
}
