// Export the exact page copy for the owner's review; never write to public/.
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LegalDocument } from "../../src/components/legal/legal-document";
import { Button } from "../../src/components/ui/button";
import { legalCopy } from "../../src/content/legal";
import { sellerDraft } from "../../src/content/legal/seller";
import { legalDocumentIds, sellerFields } from "../../src/content/legal/types";

Object.assign(globalThis, { React });
const output = path.resolve(".local/legal-drafts-20261104");
fs.mkdirSync(output, { recursive: true });
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
for (const locale of ["ru", "kg", "en"] as const) {
  const copy = legalCopy[locale];
  for (const documentId of legalDocumentIds) {
    const body = renderToStaticMarkup(
      <LegalDocument
        documentId={documentId}
        copy={copy}
        seller={sellerDraft}
        localeControl={
          <nav aria-label="Language" className="flex gap-2">
            {(["ru", "kg", "en"] as const).map((language) => (
              <Button
                key={language}
                asChild
                size="sm"
                variant={language === locale ? "primary" : "secondary"}
              >
                <a href={`${documentId}.${language}.html`}>{language.toUpperCase()}</a>
              </Button>
            ))}
          </nav>
        }
      />,
    )
      .replaceAll(
        /href="\/legal\/(offer|refunds|requisites|payment)"/g,
        (_, id: string) => `href="${id}.${locale}.html"`,
      )
      .replaceAll('href="/privacy"', 'href="https://www.bazaar.kg/privacy"')
      .replaceAll('href="/#pricing"', 'href="https://www.bazaar.kg/#pricing"')
      .replaceAll('href="/"', 'href="https://www.bazaar.kg/"');
    fs.writeFileSync(
      path.join(output, `${documentId}.${locale}.html`),
      `<!doctype html><html lang="${locale === "kg" ? "ky" : locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>${copy.documents[documentId].title} · ${copy.draft}</title><style>${styles}\n${fontCss}</style></head><body>${body}</body></html>`,
    );
  }
}
const ru = legalCopy.ru;
const markdown =
  [
    "# Проекты юридических документов Bazaar",
    ru.draftNotice,
    "Дата подготовки: 2026-11-04. Не опубликовано. Сроки 10/3 рабочих дня предложены для согласования владельцем; остальные ограничения и следующие шаги описаны в README.md.",
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
console.log(
  "Exported 12 local HTML previews and the combined Russian draft; no public files written.",
);
