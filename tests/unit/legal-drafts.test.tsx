// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { legalDraftPreviewAllowed } from "@/lib/legalPreview";
import { legalCopy } from "@/content/legal";
import { sellerDraft } from "@/content/legal/seller";
import { syntheticSellerEnvironment, syntheticSeller } from "../helpers/legalSeller";
import { legalDocumentIds, sellerFields } from "@/content/legal/types";
import { LegalDocument } from "@/components/legal/legal-document";
import { LEGAL_TERMS_VERSION } from "@/lib/legalPublication";

const mocks = vi.hoisted(() => ({
  host: "localhost:3134",
  locale: "ru",
  getLocale: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: () => new Headers({ host: mocks.host }) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next-intl/server", () => ({ getLocale: mocks.getLocale }));
import LegalDraftPage, { generateMetadata } from "@/app/legal/[document]/page";

const localPreview = { NODE_ENV: "development", BAZAAR_LEGAL_PREVIEW: "1" };

afterEach(() => {
  vi.unstubAllEnvs();
  mocks.host = "localhost:3134";
  mocks.getLocale.mockReset();
});

describe("legal draft publication boundary", () => {
  it.each(["localhost", "localhost:3134", "127.0.0.1:3134", "[::1]:3134"])(
    "allows explicitly enabled local development on %s",
    (host) => {
      expect(legalDraftPreviewAllowed(localPreview, host)).toBe(true);
    },
  );

  it.each([
    { NODE_ENV: "production", BAZAAR_LEGAL_PREVIEW: "1" },
    { NODE_ENV: "test", BAZAAR_LEGAL_PREVIEW: "1" },
    { NODE_ENV: "development" },
    { ...localPreview, BAZAAR_LEGAL_PREVIEW: "true" },
    { ...localPreview, VERCEL: "1" },
    { ...localPreview, VERCEL_ENV: "preview" },
    { ...localPreview, VERCEL_ENV: "production" },
    { ...localPreview, VERCEL_ENV: "development" },
  ])("rejects unpublished draft environment %j", (env) => {
    expect(legalDraftPreviewAllowed(env, "localhost:3134")).toBe(false);
  });

  it.each([
    null,
    "bazaar.kg",
    "www.bazaar.kg",
    "192.168.1.2:3134",
    "localhost.evil.example",
    "localhost:3134@evil.example",
    "localhost/offer",
  ])("rejects a non-loopback host %s", (host) => {
    expect(legalDraftPreviewAllowed(localPreview, host)).toBe(false);
  });

  it("blocks both page and metadata before reading any translated draft in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BAZAAR_LEGAL_PREVIEW", "1");
    for (const document of legalDocumentIds) {
      await expect(LegalDraftPage({ params: Promise.resolve({ document }) })).rejects.toThrow("NOT_FOUND");
      await expect(generateMetadata({ params: Promise.resolve({ document }) })).rejects.toThrow("NOT_FOUND");
    }
    expect(mocks.getLocale).not.toHaveBeenCalled();
  });

  it("blocks local previews by default and rejects unknown documents", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BAZAAR_LEGAL_PREVIEW", "");
    await expect(LegalDraftPage({ params: Promise.resolve({ document: "offer" }) })).rejects.toThrow("NOT_FOUND");
    vi.stubEnv("BAZAAR_LEGAL_PREVIEW", "1");
    vi.stubEnv("VERCEL", "0");
    vi.stubEnv("VERCEL_ENV", "");
    await expect(LegalDraftPage({ params: Promise.resolve({ document: "unknown" }) })).rejects.toThrow("NOT_FOUND");
  });

  it("renders a locally approved preview with noindex metadata", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BAZAAR_LEGAL_PREVIEW", "1");
    vi.stubEnv("VERCEL", "0");
    vi.stubEnv("VERCEL_ENV", "");
    mocks.getLocale.mockResolvedValue("ky");
    for (const [key, value] of Object.entries(syntheticSellerEnvironment)) vi.stubEnv(key, value);
    const result = await LegalDraftPage({ params: Promise.resolve({ document: "offer" }) });
    expect(result.props.copy).toBe(legalCopy.kg);
    expect(result.props.seller.taxId).toBe(syntheticSeller.taxId);
    expect(await generateMetadata({ params: Promise.resolve({ document: "offer" }) })).toMatchObject({
      title: expect.stringContaining(legalCopy.kg.draft),
      robots: { index: false, follow: false, noarchive: true },
    });
  });

  it("renders the approved production edition without exposing the private registered address", async () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const [key, value] of Object.entries(syntheticSellerEnvironment)) vi.stubEnv(key, value);
    vi.stubEnv("BILLING_LEGAL_RELEASE_APPROVED", LEGAL_TERMS_VERSION);
    vi.stubEnv("BILLING_SUPPORT_EMAIL_VERIFIED", "1");
    vi.stubEnv(
      "BILLING_PUBLIC_CONTACT_ADDRESS",
      "Кыргызстан, Бишкек, тестовый адрес для корреспонденции 1",
    );
    mocks.host = "bazaar.kg";
    mocks.getLocale.mockResolvedValue("ru");
    for (const document of legalDocumentIds) {
      const result = await LegalDraftPage({ params: Promise.resolve({ document }) });
      expect(result.props.draft).toBe(false);
      expect(result.props.seller.registeredAddress).toBeNull();
      expect(result.props.seller.correspondenceAddress).toContain("тестовый адрес");
      const metadata = await generateMetadata({ params: Promise.resolve({ document }) });
      expect(metadata.title).toBe(`${legalCopy.ru.documents[document].title} · Bazaar`);
    }
  });
});

describe("reviewable legal pages", () => {
  it.each(["ru", "kg", "en"] as const)(
    "contains complete document and seller translations in %s",
    (locale) => {
      const copy = legalCopy[locale];
      expect(Object.keys(copy.documents)).toEqual([...legalDocumentIds]);
      expect(Object.keys(copy.sellerLabels)).toEqual([...sellerFields]);
      for (const id of legalDocumentIds) {
        const sections = copy.documents[id].sections;
        expect(sections.map((s) => s.id)).toEqual(
          legalCopy.ru.documents[id].sections.map((s) => s.id),
        );
        expect(sections.map((s) => s.paragraphs.length)).toEqual(
          legalCopy.ru.documents[id].sections.map((s) => s.paragraphs.length),
        );
        const root = document.createElement("div");
        root.innerHTML = renderToStaticMarkup(
          <LegalDocument documentId={id} copy={copy} seller={syntheticSeller} />,
        );
        expect(root.querySelectorAll("h1")).toHaveLength(1);
        expect(root.querySelector('[role="note"]')?.textContent).toBe(copy.draftNotice);
        expect(root.querySelector('[aria-current="page"]')?.getAttribute("href")).toBe(
          `/legal/${id}`,
        );
        expect(root.querySelectorAll("[data-seller-field]")).toHaveLength(sellerFields.length);
        expect(root.querySelector("form")).toBeNull();
        expect(root.querySelector('a[href="mailto:seller@example.invalid"]')).not.toBeNull();
        expect(root.querySelector('a[href^="tel:"]')).not.toBeNull();
        expect(root.textContent).not.toMatch(/undefined|\[object Object\]|\{\{/);
        for (const link of root.querySelectorAll('a[href^="#"]')) {
          expect(root.querySelector(link.getAttribute("href")!)).not.toBeNull();
        }
        for (const otherId of legalDocumentIds) {
          expect(root.querySelector(`a[href="/legal/${otherId}"]`)).not.toBeNull();
        }
      }
    },
  );

  it("uses approved seller contacts and the KGS account while withholding the private home address", () => {
    expect(sellerDraft.phone).toBe("+996 709 911 300");
    expect(sellerDraft.email).toBe("support@bazaar.kg");
    expect(sellerDraft.accountCurrency).toBe("KGS");
    expect(sellerDraft.accountNumber).toBeNull();
    expect(sellerDraft.registrationNumber).toBeNull();
    expect(sellerDraft.registeredAddress).toBeNull();
    expect(sellerDraft.correspondenceAddress).toBeNull();
  });
});
