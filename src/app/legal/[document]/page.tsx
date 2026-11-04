import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { LegalDocument } from "@/components/legal/legal-document";
import { MarketingLocaleSwitcher } from "@/components/marketing/MarketingLocaleSwitcher";
import { legalCopy } from "@/content/legal";
import { sellerDraft } from "@/content/legal/seller";
import { legalDocumentIds, type LegalDocumentId } from "@/content/legal/types";
import { legalDraftPreviewAllowed } from "@/lib/legalPreview";
import { defaultLocale, normalizeLocale } from "@/lib/locales";

// Do not pre-render draft text into a public static page or cache a local preview.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const getDocument = async (id: string) => {
  if (!legalDraftPreviewAllowed(process.env, headers().get("host"))) notFound();
  if (!legalDocumentIds.includes(id as LegalDocumentId)) notFound();
  const locale = normalizeLocale(await getLocale()) ?? defaultLocale;
  return { documentId: id as LegalDocumentId, copy: legalCopy[locale] };
};

export const generateMetadata = async ({
  params,
}: {
  params: { document: string };
}): Promise<Metadata> => {
  const { documentId, copy } = await getDocument(params.document);
  return {
    title: `${copy.documents[documentId].title} · ${copy.draft}`,
    description: copy.documents[documentId].description,
    robots: { index: false, follow: false, noarchive: true },
  };
};

export default async function LegalDraftPage({ params }: { params: { document: string } }) {
  const { documentId, copy } = await getDocument(params.document);
  return (
    <LegalDocument
      documentId={documentId}
      copy={copy}
      seller={sellerDraft}
      localeControl={<MarketingLocaleSwitcher />}
    />
  );
}
