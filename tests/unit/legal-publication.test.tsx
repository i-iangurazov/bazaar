// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { legalPublicationState, LEGAL_TERMS_VERSION } from "@/lib/legalPublication";
import { getSubscriptionPaymentConfig } from "@/server/billing/paymentConfig";
import { sellerDraft } from "@/content/legal/seller";
import { syntheticSellerEnvironment, syntheticSeller } from "../helpers/legalSeller";
import { loadPublicSellerLegalName, loadSellerDetails } from "@/server/legal/seller";
import { legalCopy } from "@/content/legal";
import { legalDocumentIds, sellerFields } from "@/content/legal/types";
import { LegalDocument } from "@/components/legal/legal-document";

const approved = {
  ...syntheticSellerEnvironment,
  BILLING_LEGAL_RELEASE_APPROVED: LEGAL_TERMS_VERSION,
  BILLING_SUPPORT_EMAIL_VERIFIED: "1",
  // Synthetic fixture only; never an address that should be published.
  BILLING_PUBLIC_CONTACT_ADDRESS: "Кыргызстан, Бишкек, тестовый адрес для корреспонденции 1",
};
const live = {
  ...approved,
  BILLING_PAYMENTS_MODE: "live",
  BILLING_LIVE_ACTIVATION_CONFIRMED: "1",
  FREEDOMPAY_MERCHANT_ID: "12345",
  FREEDOMPAY_SECRET_KEY: "synthetic-test-only-merchant-secret",
  BILLING_PUBLIC_URL: "https://bazaar.kg",
  BILLING_TERMS_URL: "https://bazaar.kg/legal/offer",
  BILLING_TERMS_VERSION: LEGAL_TERMS_VERSION,
  BILLING_SELLER_NAME: syntheticSeller.legalName!,
  VERCEL_ENV: "production",
};
afterEach(() => vi.unstubAllEnvs());

describe("deliberate legal publication and residential-address privacy", () => {
  it("publishes only the separately approved public name without releasing private seller details", () => {
    expect(loadPublicSellerLegalName(syntheticSellerEnvironment)).toBeNull();
    const env = {
      ...syntheticSellerEnvironment,
      BAZAAR_PUBLIC_LEGAL_NAME: "  ИП Тестовый Поставщик  ",
      BILLING_SELLER_REGISTERED_ADDRESS: "private-home-address",
    };
    expect(loadPublicSellerLegalName(env)).toBe("ИП Тестовый Поставщик");
    expect(legalPublicationState(env).published).toBe(false);
    expect(legalPublicationState(env).seller.registeredAddress).toBeNull();
    expect(legalPublicationState(env).seller.correspondenceAddress).toBeNull();
  });
  it.each(["", " ", "x", "<address>private</address>", "Name\naddress", "x".repeat(241)])(
    "omits invalid public owner names: %s",
    (name) => expect(loadPublicSellerLegalName({ BAZAAR_PUBLIC_LEGAL_NAME: name })).toBeNull(),
  );
  it("does not publish completed seller data without each release prerequisite", () => {
    expect(legalPublicationState({}).published).toBe(false);
    for (const key of [
      "BILLING_LEGAL_RELEASE_APPROVED",
      "BILLING_SUPPORT_EMAIL_VERIFIED",
      "BILLING_PUBLIC_CONTACT_ADDRESS",
      "BILLING_SELLER_TAX_ID",
      "BILLING_SELLER_ACCOUNT_NUMBER",
      "BILLING_SELLER_REGISTRATION_NUMBER",
    ]) {
      const missing = { ...approved, [key]: "" };
      expect(legalPublicationState(missing).published, key).toBe(false);
    }
    expect(
      legalPublicationState({ ...approved, BILLING_LEGAL_RELEASE_APPROVED: "1" }).published,
    ).toBe(false);
    expect(
      legalPublicationState({ ...approved, BILLING_LEGAL_RELEASE_APPROVED: "2026-11-06-v1" })
        .published,
    ).toBe(false);
  });
  it("keeps registration and banking defaults empty and reads only explicit server seller values", () => {
    const empty = loadSellerDetails({});
    for (const field of [
      "legalName",
      "entrepreneurName",
      "taxId",
      "registrationNumber",
      "registrationDate",
      "registrationAuthority",
      "bankName",
      "beneficiary",
      "accountNumber",
      "bankCode",
    ] as const)
      expect(empty[field]).toBeNull();
    expect(loadSellerDetails(syntheticSellerEnvironment)).toEqual(syntheticSeller);
    expect(
      loadSellerDetails({
        NEXT_PUBLIC_BILLING_SELLER_TAX_ID: "public-value",
        BILLING_SELLER_REGISTERED_ADDRESS: "private-home-address",
      }).taxId,
    ).toBeNull();
    expect(
      loadSellerDetails({ BILLING_SELLER_REGISTERED_ADDRESS: "private-home-address" })
        .registeredAddress,
    ).toBeNull();
  });
  it.each([
    "",
    "Бишкек",
    "<address>Example</address>",
    "Будет заполнено позже",
    "placeholder address",
    "address\nline",
    "x".repeat(501),
  ])("rejects missing, placeholder or unsafe public address %s", (address) => {
    expect(
      legalPublicationState({ ...approved, BILLING_PUBLIC_CONTACT_ADDRESS: address }).published,
    ).toBe(false);
  });
  it("publishes only an explicitly supplied correspondence address and never copies a home address", () => {
    const result = legalPublicationState(approved);
    expect(result.published).toBe(true);
    expect(result.seller.registeredAddress).toBeNull();
    expect(result.seller.correspondenceAddress).toBe(approved.BILLING_PUBLIC_CONTACT_ADDRESS);
    expect(result.seller.accountCurrency).toBe("KGS");
    expect(sellerDraft.registeredAddress).toBeNull();
    expect(sellerDraft.correspondenceAddress).toBeNull();
  });
  it.each(["ru", "kg", "en"] as const)(
    "renders all four approved %s pages without placeholders or draft notices",
    (locale) => {
      const copy = legalCopy[locale];
      for (const documentId of legalDocumentIds) {
        const root = document.createElement("div");
        root.innerHTML = renderToStaticMarkup(
          <LegalDocument
            documentId={documentId}
            copy={copy}
            seller={legalPublicationState(approved).seller}
            draft={false}
          />,
        );
        expect(root.querySelector("[data-legal-published]")).not.toBeNull();
        expect(root.querySelector("[data-legal-draft]")).toBeNull();
        expect(root.querySelector('[role="note"]')).toBeNull();
        expect(root.textContent).not.toContain(copy.missing);
        expect(root.textContent).not.toContain(copy.draftNotice);
        expect(root.querySelector('[data-seller-field="registeredAddress"]')).toBeNull();
        expect(root.querySelectorAll("[data-seller-field]")).toHaveLength(sellerFields.length - 1);
        expect(
          root.querySelector('[data-seller-field="correspondenceAddress"]')?.textContent,
        ).toContain(approved.BILLING_PUBLIC_CONTACT_ADDRESS);
        if (documentId === "payment")
          expect([...root.querySelectorAll("img")].map((img) => img.alt)).toEqual([
            "Visa",
            "Mastercard",
            "Элкарт",
          ]);
      }
    },
  );
});

describe("live checkout must bind to the real published offer", () => {
  it("allows complete production configuration without making a provider request", () => {
    expect(getSubscriptionPaymentConfig(live).ready).toBe(true);
    expect(
      getSubscriptionPaymentConfig({
        ...live,
        BILLING_PUBLIC_URL: "https://www.bazaar.kg",
        BILLING_TERMS_URL: "https://www.bazaar.kg/legal/offer",
      }).ready,
    ).toBe(true);
  });
  it.each([
    { BILLING_LEGAL_RELEASE_APPROVED: "" },
    { BILLING_SUPPORT_EMAIL_VERIFIED: "" },
    { BILLING_PUBLIC_CONTACT_ADDRESS: "" },
    { BILLING_LIVE_ACTIVATION_CONFIRMED: "" },
    { BILLING_TERMS_VERSION: "old-version" },
    { BILLING_SELLER_NAME: "Another seller" },
    { BILLING_TERMS_URL: "https://evil.example/legal/offer" },
    { BILLING_TERMS_URL: "https://bazaar.kg/terms" },
    { BILLING_TERMS_URL: "https://bazaar.kg/legal/offer?preview=1" },
    {
      BILLING_PUBLIC_URL: "https://bazaar-preview.vercel.app",
      BILLING_TERMS_URL: "https://bazaar-preview.vercel.app/legal/offer",
    },
    { VERCEL_ENV: "preview" },
    { VERCEL_ENV: "development" },
    { FREEDOMPAY_SECRET_KEY: "short" },
    { HARDENING_EXTERNAL_PROVIDER_MODE: "disabled" },
  ])("keeps live checkout disabled for incomplete or mismatched release %j", (change) => {
    expect(getSubscriptionPaymentConfig({ ...live, ...change }).ready).toBe(false);
  });
});
