// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LEGAL_TERMS_VERSION } from "@/lib/legalPublication";
import { applePurchaseLegalCopy } from "@/content/legal/applePurchases";
import { syntheticSellerEnvironment } from "../helpers/legalSeller";
import { hardeningPreviewEnv } from "../helpers/hardeningPreviewEnv";
import { LegalDocument } from "@/components/legal/legal-document";

const mock = vi.hoisted(() => ({ host: "www.bazaar.kg", locale: "ru", reads: vi.fn() }));
vi.mock("next/headers", () => ({ headers: () => new Headers({ host: mock.host }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("next-intl/server", () => ({ getLocale: async () => { mock.reads(); return mock.locale; } }));
// Import JSX while NODE_ENV is the test runtime. Importing jsx-dev-runtime for
// the first time inside a production-env policy fixture changes its exports.
import ApplePurchaseTermsPage, { generateMetadata } from "@/app/legal/apple-purchases/[revision]/page";
const page = { default: ApplePurchaseTermsPage, generateMetadata };
const configure = (env: Record<string, string | undefined>) => { for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v); };
const published = {
  ...syntheticSellerEnvironment, BILLING_LEGAL_RELEASE_APPROVED: LEGAL_TERMS_VERSION,
  BILLING_SUPPORT_EMAIL_VERIFIED: "1", BILLING_PUBLIC_CONTACT_ADDRESS: "Synthetic correspondence address 100",
  APPLE_LEGAL_RELEASE_APPROVED: "2026-11-13-v1",
};
const preview = hardeningPreviewEnv("postgresql://synthetic@isolated.example.invalid/apple_legal?sslmode=require");
beforeEach(() => { vi.resetModules(); mock.host = "www.bazaar.kg"; mock.locale = "ru"; mock.reads.mockClear(); });
afterEach(() => { vi.unstubAllEnvs(); });

describe("scoped Apple terms without a global financial-version change", () => {
  it("retains v2 and keeps production NEW checkout gated without changing historical financial data", async () => {
    const legal = await import("@/lib/applePurchaseLegal");
    expect(LEGAL_TERMS_VERSION).toBe("2026-11-11-v2");
    expect(legal.applePurchaseLegalPublication({}).published).toBe(false);
    expect(legal.newApplePurchaseLegalConsent("Production", undefined, {})).toEqual({ allowed: false, consent: null });
    expect(legal.newApplePurchaseLegalConsent("Sandbox", undefined, {})).toEqual({ allowed: true, consent: null });
    expect(legal.newApplePurchaseLegalConsent("Sandbox", legal.APPLE_PURCHASE_TERMS_REVISION, {}).allowed).toBe(false);
  });
  it("freezes the exact scoped revision, existing common version and URL only after explicit publication", async () => {
    const legal = await import("@/lib/applePurchaseLegal");
    expect(legal.applePurchaseLegalPublication(published).published).toBe(true);
    expect(legal.newApplePurchaseLegalConsent("Production", undefined, published).allowed).toBe(false);
    expect(legal.newApplePurchaseLegalConsent("Production", "stale", published).allowed).toBe(false);
    expect(legal.newApplePurchaseLegalConsent("Production", legal.APPLE_PURCHASE_TERMS_REVISION, published)).toEqual({ allowed: true,
      consent: { version: 1, revision: "2026-11-13-v1", termsVersion: "2026-11-11-v2", termsUrl: "https://www.bazaar.kg/legal/apple-purchases/2026-11-13-v1" } });
    expect(legal.applePurchaseLegalPublication({ ...published, BILLING_SUPPORT_EMAIL_VERIFIED: "0" }).published).toBe(false);
  });
  it("does not replace foundation/recovery readiness with a new approval gate", async () => {
    const { appleBillingConfig } = await import("@/server/billing/appleConfig");
    const env = { APPLE_BILLING_MODE: "sandbox", APPLE_APP_ID: "1234567890", APPLE_IAP_KEY_ID: "SYNTHETIC",
      APPLE_IAP_ISSUER_ID: "SYNTHETIC", APPLE_IAP_PRIVATE_KEY: "SYNTHETIC PRIVATE KEY", APPLE_BILLING_TERMS_VERSION: LEGAL_TERMS_VERSION,
      APPLE_BILLING_TERMS_APPROVED: "true", APPLE_BILLING_SALES_APPROVED: "true", APPLE_BILLING_CATALOG_JSON: JSON.stringify([
        { offerKey: "synthetic", productId: "synthetic.apple.legal", productType: "NON_RENEWING", approved: true }]) };
    expect(appleBillingConfig(env)).toMatchObject({ foundationReady: true, ready: true, termsVersion: LEGAL_TERMS_VERSION,
      termsRevision: null, termsUrl: "https://www.bazaar.kg/legal/offer" });
    expect(appleBillingConfig({ ...env, ...published })).toMatchObject({ foundationReady: true, ready: true,
      termsRevision: "2026-11-13-v1", termsUrl: "https://www.bazaar.kg/legal/apple-purchases/2026-11-13-v1" });
  });
});

describe("versioned Apple legal publication and isolated draft review", () => {
  it("blocks unpublished production page and metadata before translated text is read", async () => {
    configure({ NODE_ENV: "production", APPLE_LEGAL_RELEASE_APPROVED: "", VERCEL_ENV: "production" });
    const args = { params: Promise.resolve({ revision: "2026-11-13-v1" }) };
    await expect(page.default(args)).rejects.toThrow("NOT_FOUND");
    await expect(page.generateMetadata(args)).rejects.toThrow("NOT_FOUND");
    expect(mock.reads).not.toHaveBeenCalled();
  });
  it("renders the actual version as noindex draft in a fully guarded hosted Preview without final approval", async () => {
    configure({ ...preview, ...syntheticSellerEnvironment, BILLING_LEGAL_RELEASE_APPROVED: "", APPLE_LEGAL_RELEASE_APPROVED: "" });
    const legal = await import("@/lib/applePurchaseLegal");
    expect(legal.applePurchaseLegalPublication().published).toBe(false);
    const result = await page.default({ params: Promise.resolve({ revision: legal.APPLE_PURCHASE_TERMS_REVISION }) });
    expect(result.props.draft).toBe(true);
    expect(result.props.seller.accountNumber).toBeNull();
    expect(result.props.seller.taxId).toBeNull();
    expect(result.props.documentOverride).toEqual(applePurchaseLegalCopy.ru.document);
    expect(await page.generateMetadata({ params: Promise.resolve({ revision: legal.APPLE_PURCHASE_TERMS_REVISION }) }))
      .toMatchObject({ title: expect.stringContaining(applePurchaseLegalCopy.ru.draft), robots: { index: false, follow: false, noarchive: true } });
  });
  it("returns an HTTP404 for an Apple draft even when the common web edition is approved", async () => {
    configure({ NODE_ENV: "production", VERCEL_ENV: "production", ...published, APPLE_LEGAL_RELEASE_APPROVED: "" });
    const { NextRequest } = await import("next/server"), { middleware } = await import("@/middleware");
    const result = await middleware(new NextRequest("https://www.bazaar.kg/legal/apple-purchases/2026-11-13-v1"));
    expect(result.status).toBe(404); expect(result.headers.get("x-robots-tag")).toContain("noindex");
  });
  it("permits only the exact versioned Apple draft through the fully guarded Preview middleware", async () => {
    configure({ ...preview, APPLE_LEGAL_RELEASE_APPROVED: "" });
    const { NextRequest } = await import("next/server"), { middleware } = await import("@/middleware");
    const result = await middleware(new NextRequest("https://preview.example.invalid/legal/apple-purchases/2026-11-13-v1"));
    expect(result.headers.get("x-middleware-next")).toBe("1");
    expect((await middleware(new NextRequest("https://preview.example.invalid/legal/apple-purchases/unreviewed"))).status).toBe(404);
  });
  it.each([
    { VERCEL_ENV: "production" }, { HARDENING_PREVIEW_GUARD: "0" },
    { VERCEL_PROJECT_ID: "prj_Foreign" }, { HARDENING_PREVIEW_EXPECTED_DATABASE_HOST: "foreign.invalid" },
    { BLOB_EXPORT_STORE_ID: "store_Foreign" }, { IMAGE_STORAGE_PROVIDER: "local", EXPORT_STORAGE_PROVIDER: "local" },
    { OPENAI_API_KEY: "synthetic-forbidden" }, { ALLOW_TEST_DB_RESET: "1" },
  ])("rejects a spoofed or unsafe Preview boundary %j", async (patch) => {
    configure({ ...preview, ...patch, APPLE_LEGAL_RELEASE_APPROVED: "" });
    const legal = await import("@/lib/applePurchaseLegal");
    expect(legal.applePurchaseLegalPreviewAllowed("preview.example.invalid")).toBe(false);
  });
  it("allows explicit localhost review, rejects other revisions and keeps public approval independent", async () => {
    configure({ NODE_ENV: "development", VERCEL: "0", VERCEL_ENV: "", BAZAAR_LEGAL_PREVIEW: "1", APPLE_LEGAL_RELEASE_APPROVED: "" });
    mock.host = "localhost:3134";
    const legal = await import("@/lib/applePurchaseLegal");
    expect(legal.applePurchaseLegalPreviewAllowed(mock.host)).toBe(true);
    await expect(page.default({ params: Promise.resolve({ revision: "later-unreviewed" }) })).rejects.toThrow("NOT_FOUND");
    expect(legal.applePurchaseLegalPublication().published).toBe(false);
  });
  it.each(["ru", "kg", "en"] as const)("renders complete scoped copy and real section anchors in %s", async (locale) => {
    configure({ NODE_ENV: "production", VERCEL_ENV: "production", ...published }); mock.locale = locale;
    const legal = await import("@/lib/applePurchaseLegal");
    const result = await page.default({ params: Promise.resolve({ revision: legal.APPLE_PURCHASE_TERMS_REVISION }) });
    expect(result.props.draft).toBe(false); expect(result.props.seller.registeredAddress).toBeNull();
    const root = document.createElement("div"); root.innerHTML = renderToStaticMarkup(
      <LegalDocument documentId={null} documentOverride={result.props.documentOverride}
        copy={result.props.copy} seller={result.props.seller} draft={result.props.draft} />,
    );
    expect(root.querySelectorAll("h1")).toHaveLength(1);
    for (const id of ["scope", "term", "price", "organization", "upgrade", "messages", "restore", "refunds"])
      expect(root.querySelector(`#${id}`)).not.toBeNull();
    expect(root.textContent).toMatch(/Apple/); expect(root.textContent).toMatch(/15%/); expect(root.textContent).toMatch(/1, 6/);
    expect(root.querySelector('a[href="/legal/payment"]')).toBeNull();
    expect(root.querySelector('a[href="/legal/offer"]')).not.toBeNull();
    expect(root.querySelector('a[href="/#pricing"]')).toBeNull();
    expect(root.querySelector('a[href="/privacy"]')).not.toBeNull();
    expect(applePurchaseLegalCopy[locale].document.sections.map(s => s.paragraphs.length)).toEqual(Array(8).fill(2));
  });
});
