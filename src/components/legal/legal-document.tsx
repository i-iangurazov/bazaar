import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, FileText, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  legalDocumentIds,
  sellerFields,
  type LegalCopy,
  type LegalDocumentId,
  type SellerDetails,
} from "@/content/legal/types";

export function LegalDocument({
  documentId,
  copy,
  seller,
  localeControl,
  draft = true,
}: {
  documentId: LegalDocumentId;
  copy: LegalCopy;
  seller: SellerDetails;
  localeControl?: ReactNode;
  draft?: boolean;
}) {
  const document = copy.documents[documentId];
  return (
    <main
      className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-8 sm:py-10"
      data-legal-draft={draft ? "" : undefined}
      data-legal-published={draft ? undefined : ""}
    >
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <Button asChild variant="ghost" className="-ml-3">
            <Link href="/">
              <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
              {copy.back}
            </Link>
          </Button>
          {localeControl}
        </div>
        <div className="mb-8 space-y-4">
          <Badge variant={draft ? "warning" : "muted"}>{draft ? copy.draft : copy.published}</Badge>
          <h1 className="max-w-4xl text-3xl font-semibold tracking-tight sm:text-4xl">
            {document.title}
          </h1>
          <p className="max-w-3xl text-base leading-7 text-muted-foreground">
            {document.description}
          </p>
          {draft ? (
            <p
              role="note"
              className="max-w-4xl rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm leading-6"
            >
              {copy.draftNotice}
            </p>
          ) : null}
        </div>

        <div className="grid min-w-0 gap-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10">
          <aside className="min-w-0">
            <nav
              aria-label={copy.navigation}
              className="flex flex-wrap gap-2 lg:sticky lg:top-6 lg:flex-col lg:items-stretch"
            >
              {legalDocumentIds.map((id) => (
                <Button
                  key={id}
                  asChild
                  variant={id === documentId ? "secondary" : "ghost"}
                  className="h-auto min-h-11 justify-start whitespace-normal px-3 py-2 text-left"
                >
                  <Link href={`/legal/${id}`} aria-current={id === documentId ? "page" : undefined}>
                    <FileText className="mr-2 h-4 w-4 shrink-0" aria-hidden="true" />
                    {copy.documents[id].title}
                  </Link>
                </Button>
              ))}
              <Button
                asChild
                variant="ghost"
                className="h-auto min-h-11 justify-start whitespace-normal px-3 py-2 text-left"
              >
                <Link href="/privacy">
                  <ShieldCheck className="mr-2 h-4 w-4 shrink-0" aria-hidden="true" />
                  {copy.privacy}
                </Link>
              </Button>
              <Button
                asChild
                variant="ghost"
                className="h-auto min-h-11 justify-start whitespace-normal px-3 py-2 text-left"
              >
                <Link href="/#pricing">{copy.pricing}</Link>
              </Button>
            </nav>
          </aside>

          <article className="min-w-0 space-y-8 [overflow-wrap:anywhere]">
            <Card>
              <CardContent>
                <nav aria-label={copy.contents}>
                  <p className="mb-3 text-sm font-semibold">{copy.contents}</p>
                  <ol className="space-y-2">
                    {document.sections.map((section) => (
                      <li key={section.id}>
                        <a
                          href={`#${section.id}`}
                          className="rounded-sm text-sm leading-6 text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {section.title}
                        </a>
                      </li>
                    ))}
                    <li>
                      <a
                        href="#seller-details"
                        className="rounded-sm text-sm leading-6 text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {copy.sellerTitle}
                      </a>
                    </li>
                  </ol>
                </nav>
              </CardContent>
            </Card>
            {document.sections.map((section) => (
              <section key={section.id} id={section.id} className="scroll-mt-6 space-y-3">
                <h2 className="text-xl font-semibold tracking-tight">{section.title}</h2>
                {section.paragraphs.map((paragraph, index) => (
                  <p key={index} className="text-base leading-7 text-muted-foreground">
                    {paragraph}
                  </p>
                ))}
              </section>
            ))}
            {documentId === "payment" ? (
              <section className="space-y-4" aria-label={copy.paymentSystemsTitle}>
                <h2 className="text-xl font-semibold tracking-tight">{copy.paymentSystemsTitle}</h2>
                <div className="flex flex-wrap items-center gap-5 rounded-lg border border-border bg-white p-5">
                  {/* Local vector payment marks retain their original SVGs; raster optimization is unnecessary. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/brand/payments/visa.svg"
                    alt="Visa"
                    width={90}
                    height={40}
                    className="h-8 w-20 object-contain"
                  />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/brand/payments/mastercard.svg"
                    alt="Mastercard"
                    width={70}
                    height={44}
                    className="h-10 w-16 object-contain"
                  />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/brand/payments/elcart.svg"
                    alt="Элкарт"
                    width={96}
                    height={44}
                    className="h-10 w-24 object-contain"
                  />
                </div>
                <p className="text-sm leading-6 text-muted-foreground">
                  {copy.paymentSystemsNotice}
                </p>
              </section>
            ) : null}
            <section id="seller-details" className="scroll-mt-6 space-y-4">
              <h2 className="text-xl font-semibold tracking-tight">{copy.sellerTitle}</h2>
              <p className="text-sm leading-6 text-muted-foreground">{copy.sellerIntro}</p>
              <Card>
                <CardContent>
                  <dl className="divide-y divide-border">
                    {sellerFields
                      .filter((field) => draft || seller[field])
                      .map((field) => (
                        <div
                          key={field}
                          className="grid min-w-0 gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:gap-6"
                          data-seller-field={field}
                        >
                          <dt className="text-sm font-medium">{copy.sellerLabels[field]}</dt>
                          <dd
                            className={`min-w-0 text-sm leading-6 ${seller[field] ? "text-foreground" : "text-muted-foreground"}`}
                          >
                            {seller[field] && (field === "email" || field === "phone") ? (
                              <a
                                className="text-primary underline underline-offset-4"
                                href={
                                  field === "email"
                                    ? `mailto:${seller[field]}`
                                    : `tel:${seller[field]!.replace(/[^+0-9]/g, "")}`
                                }
                              >
                                {seller[field]}
                              </a>
                            ) : (
                              seller[field] || copy.missing
                            )}
                          </dd>
                        </div>
                      ))}
                  </dl>
                </CardContent>
              </Card>
            </section>
          </article>
        </div>
      </div>
    </main>
  );
}
