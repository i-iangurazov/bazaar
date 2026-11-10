import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { LegalDocument } from "@/components/legal/legal-document";
import { MarketingLocaleSwitcher } from "@/components/marketing/MarketingLocaleSwitcher";
import { legalCopy } from "@/content/legal";
import { legalDocumentIds, type LegalDocumentId } from "@/content/legal/types";
import { legalDraftPreviewAllowed } from "@/lib/legalPreview";
import { defaultLocale, normalizeLocale } from "@/lib/locales";
import { legalPublicationState } from "@/lib/legalPublication";

// Do not pre-render draft text into a public static page or cache a local preview.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const getDocument = async (id: string) => {
  const publication = legalPublicationState();
  if (!publication.published && !legalDraftPreviewAllowed(process.env, (await headers()).get("host")))
    notFound();
  if (!legalDocumentIds.includes(id as LegalDocumentId)) notFound();
  const locale = normalizeLocale(await getLocale()) ?? defaultLocale;
  return { documentId: id as LegalDocumentId, copy: legalCopy[locale], publication };
};

export const generateMetadata = async ({
  params: paramsPromise,
}: {
  params: Promise<{ document: string }>;
}): Promise<Metadata> => {
  const params = await paramsPromise;

  const { documentId, copy, publication } = await getDocument(params.document);
  return {
    title: `${copy.documents[documentId].title} · ${publication.published ? "Bazaar" : copy.draft}`,
    description: copy.documents[documentId].description,
    robots: { index: false, follow: false, noarchive: true },
  };
};

export default async function LegalDraftPage({ params: paramsPromise }: { params: Promise<{ document: string }> }) {
  const params = await paramsPromise;

  const { documentId, copy, publication } = await getDocument(params.document);
  return (
    <LegalDocument
      documentId={documentId}
      copy={copy}
      seller={publication.seller}
      draft={!publication.published}
      localeControl={<MarketingLocaleSwitcher />}
    />
  );
}
