// Export the exact page copy for the owner's review; never write to public/.
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LegalDocument } from "../../src/components/legal/legal-document";
import { Button } from "../../src/components/ui/button";
import { legalCopy } from "../../src/content/legal";
import { sellerDraft } from "../../src/content/legal/seller";
import { loadSellerDetails, SELLER_ENV_FIELDS } from "../../src/server/legal/seller";
import { syntheticSeller } from "../../tests/helpers/legalSeller";
import { legalDocumentIds, sellerFields } from "../../src/content/legal/types";

Object.assign(globalThis, { React });
const output = path.resolve(".local/legal-drafts-20261104");
fs.mkdirSync(output, { recursive: true });
fs.chmodSync(output, 0o700);
// Read only the seller allowlist. Never import all local API/provider secrets
// into the preview process or copy them to exported HTML.
const sellerEnvironment: Record<string, string | undefined> = {};
const sellerKeys = new Set<string>(Object.values(SELLER_ENV_FIELDS));
for (const key of sellerKeys) if (process.env[key]) sellerEnvironment[key] = process.env[key];
if (fs.existsSync(".env.local")) {
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = /^(BILLING_SELLER_[A-Z_]+)=(.*)$/.exec(line.trim());
    if (!match || !sellerKeys.has(match[1]) || sellerEnvironment[match[1]]) continue;
    const raw = match[2].trim();
    sellerEnvironment[match[1]] = raw.startsWith('"') ? JSON.parse(raw) : raw.replace(/^'|'$/g, "");
  }
}
const localSeller = loadSellerDetails(sellerEnvironment);
const styles = fs
  .readdirSync(".next/static/css", { recursive: true })
  .map(String)
  .filter((name) => name.endsWith(".css"))
  .map((name) => fs.readFileSync(path.join(".next/static/css", name), "utf8"))
  .join("\n");
if (!styles.includes("bg-background"))
  throw new Error("Compiled application CSS is required for the review export");
const font = fs.readFileSync("public/fonts/inter/InterVariable.woff2").toString("base64");
const fontCss = `@font-face{font-family:Inter;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:100 900;font-display:swap}body{font-family:Inter,system-ui,sans-serif}`;
for (const published of [false, true]) {
  for (const locale of ["ru", "kg", "en"] as const) {
    const copy = legalCopy[locale];
    // A visibly synthetic address exists only in the ignored, local visual fixture.
    // It is never a public seller value or an accepted address for the acquiring application.
    const seller = published
      ? {
          ...(localSeller.taxId ? localSeller : syntheticSeller),
          correspondenceAddress: "LOCAL QA FIXTURE — NOT A REAL ADDRESS",
        }
      : localSeller;
    const prefix = published ? "review-published-" : "";
    for (const documentId of legalDocumentIds) {
      const body = renderToStaticMarkup(
        <LegalDocument
          documentId={documentId}
          copy={copy}
          seller={seller}
          draft={!published}
          localeControl={
            <nav aria-label="Language" className="flex gap-2">
              {(["ru", "kg", "en"] as const).map((language) => (
                <Button
                  key={language}
                  asChild
                  size="sm"
                  variant={language === locale ? "primary" : "secondary"}
                >
                  <a href={`${prefix}${documentId}.${language}.html`}>{language.toUpperCase()}</a>
                </Button>
              ))}
            </nav>
          }
        />,
      )
        .replaceAll(
          /href="\/legal\/(offer|refunds|requisites|payment)"/g,
          (_, id: string) => `href="${prefix}${id}.${locale}.html"`,
        )
        .replaceAll('href="/privacy"', 'href="https://www.bazaar.kg/privacy"')
        .replaceAll('href="/#pricing"', 'href="https://www.bazaar.kg/#pricing"')
        .replaceAll('href="/"', 'href="https://www.bazaar.kg/"')
        .replaceAll(
          /src="\/brand\/payments\/([a-z]+)\.svg"/g,
          (_, name: string) =>
            `src="data:image/svg+xml;base64,${fs.readFileSync(`public/brand/payments/${name}.svg`).toString("base64")}"`,
        );
      fs.writeFileSync(
        path.join(output, `${prefix}${documentId}.${locale}.html`),
        `<!doctype html><html lang="${locale === "kg" ? "ky" : locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>${copy.documents[documentId].title} · ${published ? "LOCAL LAYOUT REVIEW" : copy.draft}</title><style>${styles}\n${fontCss}</style></head><body>${body}</body></html>`,
      );
      fs.chmodSync(path.join(output, `${prefix}${documentId}.${locale}.html`), 0o600);
    }
  }
}
const ru = legalCopy.ru;
const markdown =
  [
    "# Проекты юридических документов Bazaar",
    ru.draftNotice,
    "Обновлено: 2026-11-11. Этот экспорт не публикуется. Коммерческая сетка 2 000 / 3 500 / 5 500 KGS, скидки 5% за полгода и 15% за год сохраняются. Владелец разрешил отдельно заданный публичный адрес до номера дома без этажа и квартир; частный адрес из свидетельства не копируется. Сомовый счёт ИП в Бакай и рабочая почта support@bazaar.kg подготовлены отдельно. Владелец окончательно утвердил 3 рабочих дня на рассмотрение возврата и 2 на передачу поручения о банковском возврате после одобрения; банковский срок зачисления отдельный. Ограничения публикации и следующие шаги описаны в README.md.",
    ...legalDocumentIds.flatMap((id) => [
      `## ${ru.documents[id].title}`,
      ru.documents[id].description,
      ...ru.documents[id].sections.flatMap((section) => [
        `### ${section.title}`,
        ...section.paragraphs,
      ]),
    ]),
    `## ${ru.sellerTitle}`,
    ...sellerFields.map(
      (field) => `- **${ru.sellerLabels[field]}:** ${sellerDraft[field] || ru.missing}`,
    ),
  ].join("\n\n") + "\n";
fs.mkdirSync("docs/legal", { recursive: true });
fs.writeFileSync("docs/legal/drafts-ru.md", markdown);
// Personal seller values remain in ignored local review files only.
fs.writeFileSync(
  path.join(output, "drafts-ru.private.md"),
  markdown.slice(0, markdown.indexOf(`## ${ru.sellerTitle}`)) +
    [
      `## ${ru.sellerTitle}`,
      ...sellerFields.map(
        (field) => `- **${ru.sellerLabels[field]}:** ${localSeller[field] || ru.missing}`,
      ),
    ].join("\n\n") +
    "\n",
  { mode: 0o600 },
);
console.log(
  "Exported 12 draft HTML previews, 12 publication layout fixtures and the combined Russian draft; no public files written.",
);
