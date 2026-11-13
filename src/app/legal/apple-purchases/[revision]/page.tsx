import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { LegalDocument } from "@/components/legal/legal-document";
import { MarketingLocaleSwitcher } from "@/components/marketing/MarketingLocaleSwitcher";
import { legalCopy } from "@/content/legal";
import { sellerDraft } from "@/content/legal/seller";
import { applePurchaseLegalCopy } from "@/content/legal/applePurchases";
import { defaultLocale, normalizeLocale } from "@/lib/locales";
import { legalDraftPreviewAllowed } from "@/lib/legalPreview";
import { legalPublicationState } from "@/lib/legalPublication";
import { applePurchaseLegalPublication, applePurchaseLegalPreviewAllowed, APPLE_PURCHASE_TERMS_REVISION } from "@/lib/applePurchaseLegal";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const content = async (revision: string) => {
  if (revision !== APPLE_PURCHASE_TERMS_REVISION) notFound();
  const publication = applePurchaseLegalPublication();
  const host = (await headers()).get("host");
  if (!publication.published && !applePurchaseLegalPreviewAllowed(host)) notFound();
  // Hosted review of the copy does not publish an unapproved seller's private
  // environment values. Approved public details or explicit localhost review
  // retain their established behaviour.
  const seller = publication.published || legalPublicationState().published || legalDraftPreviewAllowed(process.env, host)
    ? publication.seller : sellerDraft;
  const locale = normalizeLocale(await getLocale()) ?? defaultLocale;
  return { publication, locale, apple: applePurchaseLegalCopy[locale], seller };
};
export async function generateMetadata({ params }: { params: Promise<{ revision: string }> }): Promise<Metadata> {
  const { publication, apple } = await content((await params).revision);
  return { title: `${apple.document.title} · ${publication.published ? "Bazaar" : apple.draft}`,
    description: apple.document.description, robots: { index: false, follow: false, noarchive: true } };
}
export default async function ApplePurchaseTermsPage({ params }: { params: Promise<{ revision: string }> }) {
  const { publication, locale, apple, seller } = await content((await params).revision);
  return <LegalDocument documentId={null} documentOverride={apple.document}
    copy={{ ...legalCopy[locale], draft: apple.draft, published: apple.published, draftNotice: apple.draftNotice, sellerIntro: apple.sellerIntro }}
    seller={seller} draft={!publication.published} localeControl={<MarketingLocaleSwitcher />} />;
}
