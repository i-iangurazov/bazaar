import { defaultLocale, normalizeLocale } from "@/lib/locales";
import { marketingHomePath, marketingSiteUrl } from "@/lib/marketingSeo";

type MarketingStructuredDataOptions = {
  locale: string;
  description: string;
  offers: readonly { name: string; price: string | number }[];
};

const websiteId = `${marketingSiteUrl}/#website`;
const organizationId = `${marketingSiteUrl}/#organization`;
const softwareId = `${marketingSiteUrl}/#software`;

/** Public identity and the same offers displayed by the marketing page. */
export const getMarketingStructuredData = ({
  locale,
  description,
  offers,
}: MarketingStructuredDataOptions) => {
  const normalizedLocale = normalizeLocale(locale) ?? defaultLocale;
  const language = normalizedLocale === "kg" ? "ky" : normalizedLocale;
  const homeUrl = `${marketingSiteUrl}${marketingHomePath(normalizedLocale)}`;

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite" as const,
        "@id": websiteId,
        name: "BAZAAR",
        alternateName: ["Базар", "bazaar.kg"],
        url: `${marketingSiteUrl}/`,
        inLanguage: ["ru", "ky", "en"],
        publisher: { "@id": organizationId },
        mainEntity: { "@id": softwareId },
      },
      {
        "@type": "Organization" as const,
        "@id": organizationId,
        name: "BAZAAR",
        alternateName: ["Базар", "bazaar.kg"],
        url: `${marketingSiteUrl}/`,
        logo: {
          "@type": "ImageObject" as const,
          url: `${marketingSiteUrl}/brand/logo.png`,
          width: 724,
          height: 181,
        },
        sameAs: ["https://www.instagram.com/bazaar.pos/"],
        contactPoint: {
          "@type": "ContactPoint" as const,
          contactType: "customer support",
          telephone: "+996709911300",
          email: "support@bazaar.kg",
        },
      },
      {
        "@type": "SoftwareApplication" as const,
        "@id": softwareId,
        name: "BAZAAR",
        alternateName: "Базар",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web, iOS PWA, Android PWA",
        description,
        inLanguage: language,
        url: homeUrl,
        publisher: { "@id": organizationId },
        isPartOf: { "@id": websiteId },
        offers: offers.map(({ name, price }) => ({
          "@type": "Offer" as const,
          name,
          price: String(price),
          priceCurrency: "KGS",
        })),
      },
    ],
  };
};

/** Keep public copy inside its JSON-LD script even when it contains HTML-like text. */
export const serializeMarketingStructuredData = (data: unknown): string =>
  JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
