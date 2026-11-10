import { afterEach, describe, expect, it, vi } from "vitest";
import { LEGAL_TERMS_VERSION } from "@/lib/legalPublication";
import {
  getGoPayCredentials,
  getSubscriptionPaymentConfig,
  goPayMerchantId,
  paymentOrderId,
  selfServeSignupEnabled,
} from "@/server/billing/paymentConfig";
import { syntheticSeller, syntheticSellerEnvironment } from "../helpers/legalSeller";
import {
  GOPAY_FIXTURE_API_KEY,
  GOPAY_FIXTURE_API_SECRET,
  GOPAY_FIXTURE_WEBHOOK_SECRET,
} from "../helpers/gopayProtocolFixture";

const sandbox = {
  BILLING_PAYMENT_PROVIDER: "gopay",
  BILLING_PAYMENTS_MODE: "sandbox",
  GOPAY_API_KEY: GOPAY_FIXTURE_API_KEY,
  GOPAY_API_SECRET: GOPAY_FIXTURE_API_SECRET,
  GOPAY_WEBHOOK_SECRET: GOPAY_FIXTURE_WEBHOOK_SECRET,
  BILLING_PUBLIC_URL: "http://localhost:3120",
  BILLING_TERMS_URL: "http://localhost:3120/terms",
  BILLING_TERMS_VERSION: "synthetic-qa-v1",
  BILLING_SELLER_NAME: "Synthetic seller",
  VERCEL_ENV: "development",
};
const live = {
  ...sandbox,
  ...syntheticSellerEnvironment,
  BILLING_PAYMENTS_MODE: "live",
  BILLING_LIVE_ACTIVATION_CONFIRMED: "1",
  BILLING_PUBLIC_URL: "https://bazaar.kg",
  BILLING_TERMS_URL: "https://bazaar.kg/legal/offer",
  BILLING_TERMS_VERSION: LEGAL_TERMS_VERSION,
  BILLING_SELLER_NAME: syntheticSeller.legalName!,
  BILLING_LEGAL_RELEASE_APPROVED: LEGAL_TERMS_VERSION,
  BILLING_SUPPORT_EMAIL_VERIFIED: "1",
  BILLING_PUBLIC_CONTACT_ADDRESS: "Кыргызстан, Бишкек, синтетический адрес для обращений 1",
  VERCEL_ENV: "production",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("GoPay merchant configuration and historical credential isolation", () => {
  it("defaults new purchases to GoPay while keeping an unconfigured checkout disabled", () => {
    expect(getSubscriptionPaymentConfig({})).toMatchObject({
      provider: "GOPAY",
      mode: "disabled",
      ready: false,
    });
    expect(
      getSubscriptionPaymentConfig({ ...sandbox, BILLING_PAYMENT_PROVIDER: "" }),
    ).toMatchObject({ provider: "GOPAY", ready: true });
    expect(
      getSubscriptionPaymentConfig({ ...sandbox, BILLING_PAYMENT_PROVIDER: undefined }),
    ).toMatchObject({ provider: "GOPAY", ready: true });
  });

  it("never creates a new FreedomPay checkout from an obsolete provider setting", () => {
    expect(
      getSubscriptionPaymentConfig({
        ...sandbox,
        BILLING_PAYMENT_PROVIDER: "freedompay",
        FREEDOMPAY_MERCHANT_ID: "90001",
        FREEDOMPAY_SECRET_KEY: "synthetic-freedom-secret",
      }),
    ).toMatchObject({ provider: "GOPAY", ready: false });
  });

  it("enables an isolated GoPay sandbox without FreedomPay credentials or external requests", () => {
    const fetcher = vi.fn(() => {
      throw new Error("Configuration must not contact a provider");
    });
    vi.stubGlobal("fetch", fetcher);
    expect(getSubscriptionPaymentConfig(sandbox)).toMatchObject({
      provider: "GOPAY",
      mode: "sandbox",
      ready: true,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["GOPAY_API_KEY", "GOPAY_API_SECRET", "GOPAY_WEBHOOK_SECRET"])(
    "requires complete independent credentials: %s",
    (key) => {
      expect(getSubscriptionPaymentConfig({ ...sandbox, [key]: "" }).ready).toBe(false);
      expect(getSubscriptionPaymentConfig({ ...sandbox, [key]: "too-short" }).ready).toBe(false);
    },
  );

  it.each([
    ["GOPAY_API_KEY", "synthetic-key\nwith-newline"],
    ["GOPAY_API_KEY", "synthetic-key\rwith-return"],
    ["GOPAY_API_KEY", "synthetic-key\0with-null"],
    ["GOPAY_API_KEY", "synthetic-key\twith-tab"],
    ["GOPAY_API_KEY", "k".repeat(513)],
    ["GOPAY_API_SECRET", "synthetic-secret\nwith-newline"],
    ["GOPAY_API_SECRET", "synthetic-secret\0with-null"],
    ["GOPAY_API_SECRET", "s".repeat(4097)],
    ["GOPAY_WEBHOOK_SECRET", "synthetic-webhook\rwith-return"],
    ["GOPAY_WEBHOOK_SECRET", "synthetic-webhook\0with-null"],
    ["GOPAY_WEBHOOK_SECRET", "w".repeat(4097)],
  ])(
    "disables checkout before initialization when %s has control characters or exceeds its limit",
    (key, value) => {
      expect(getSubscriptionPaymentConfig({ ...sandbox, [key]: value }).ready).toBe(false);
    },
  );

  it("accepts complete credentials at the documented application length boundaries", () => {
    expect(
      getSubscriptionPaymentConfig({
        ...sandbox,
        GOPAY_API_KEY: "k".repeat(512),
        GOPAY_API_SECRET: "s".repeat(4096),
        GOPAY_WEBHOOK_SECRET: "w".repeat(4096),
      }).ready,
    ).toBe(true);
  });

  it("rejects unknown provider selections even when valid legacy credentials exist", () => {
    expect(
      getSubscriptionPaymentConfig({
        ...sandbox,
        BILLING_PAYMENT_PROVIDER: "typo-provider",
        FREEDOMPAY_MERCHANT_ID: "90001",
        FREEDOMPAY_SECRET_KEY: "synthetic-freedom-secret",
      }).ready,
    ).toBe(false);
  });

  it("does not expose GoPay Test checkout on production or under the external-call kill switch", () => {
    expect(getSubscriptionPaymentConfig({ ...sandbox, VERCEL_ENV: "production" }).ready).toBe(
      false,
    );
    expect(
      getSubscriptionPaymentConfig({ ...sandbox, HARDENING_EXTERNAL_PROVIDER_MODE: "disabled" })
        .ready,
    ).toBe(false);
  });

  it("permits Live only with explicitly approved and consistent seller, offer and production configuration", () => {
    expect(getSubscriptionPaymentConfig(live).ready).toBe(true);
    expect(getSubscriptionPaymentConfig({ ...sandbox, BILLING_PAYMENTS_MODE: "live" }).ready).toBe(
      false,
    );
  });

  it.each([
    ["BILLING_LIVE_ACTIVATION_CONFIRMED", "0"],
    ["BILLING_LEGAL_RELEASE_APPROVED", "draft"],
    ["BILLING_SUPPORT_EMAIL_VERIFIED", "0"],
    ["BILLING_PUBLIC_CONTACT_ADDRESS", ""],
    ["BILLING_SELLER_ACCOUNT_CURRENCY", "USD"],
    ["BILLING_TERMS_VERSION", "old-consent"],
    ["BILLING_SELLER_NAME", "Another seller"],
    ["BILLING_PUBLIC_URL", "https://unrelated.example"],
    ["BILLING_TERMS_URL", "https://bazaar.kg/unpublished-draft"],
    ["VERCEL_ENV", "preview"],
    ["HARDENING_EXTERNAL_PROVIDER_MODE", "disabled"],
  ])("denies Live when prerequisite %s differs", (key, value) => {
    expect(getSubscriptionPaymentConfig({ ...live, [key]: value }).ready).toBe(false);
  });

  it("keeps a historical FreedomPay invoice independent of the current GoPay selection", () => {
    expect(
      getSubscriptionPaymentConfig(
        {
          ...sandbox,
          GOPAY_API_SECRET: "",
          FREEDOMPAY_MERCHANT_ID: "90001",
          FREEDOMPAY_SECRET_KEY: "synthetic-freedom-secret",
        },
        "FREEDOMPAY",
      ),
    ).toMatchObject({ provider: "FREEDOMPAY", merchantId: "90001", ready: true });
  });

  it("rejects a noncanonical production port even with an otherwise consistent offer URL", () => {
    expect(
      getSubscriptionPaymentConfig({
        ...live,
        BILLING_PUBLIC_URL: "https://bazaar.kg:8443",
        BILLING_TERMS_URL: "https://bazaar.kg:8443/legal/offer",
      }).ready,
    ).toBe(false);
  });

  it("stores a stable merchant fingerprint rather than the secret API key", () => {
    const id = goPayMerchantId(GOPAY_FIXTURE_API_KEY);
    expect(id).toMatch(/^gopay:[a-f0-9]{32}$/);
    expect(id).not.toContain(GOPAY_FIXTURE_API_KEY);
    expect(goPayMerchantId(GOPAY_FIXTURE_API_KEY)).toBe(id);
    expect(goPayMerchantId("different-synthetic-key")).not.toBe(id);
    expect(goPayMerchantId("")).toBe("");
  });

  it("uses only the matching current or explicitly retained previous credentials for an existing invoice", () => {
    const previousKey = "synthetic-previous-gopay-key";
    const previousSecret = "synthetic-previous-gopay-secret";
    vi.stubEnv("GOPAY_API_KEY", GOPAY_FIXTURE_API_KEY);
    vi.stubEnv("GOPAY_API_SECRET", GOPAY_FIXTURE_API_SECRET);
    vi.stubEnv("GOPAY_PREVIOUS_API_KEY", previousKey);
    vi.stubEnv("GOPAY_PREVIOUS_API_SECRET", previousSecret);
    expect(getGoPayCredentials(goPayMerchantId(GOPAY_FIXTURE_API_KEY))).toEqual({
      apiKey: GOPAY_FIXTURE_API_KEY,
      apiSecret: GOPAY_FIXTURE_API_SECRET,
    });
    expect(getGoPayCredentials(goPayMerchantId(previousKey))).toEqual({
      apiKey: previousKey,
      apiSecret: previousSecret,
    });
    expect(() => getGoPayCredentials(goPayMerchantId("unrelated-merchant-key"))).toThrow(
      "GoPay credentials unavailable for invoice",
    );
    vi.stubEnv("GOPAY_PREVIOUS_API_SECRET", "");
    expect(() => getGoPayCredentials(goPayMerchantId(previousKey))).toThrow(
      "GoPay credentials unavailable for invoice",
    );
  });

  it("separates subscription and WhatsApp order identities within the provider's 32-character limit", () => {
    const sourceId = "wa_" + "a".repeat(32);
    const subscription = paymentOrderId("subscription", sourceId);
    const whatsapp = paymentOrderId("whatsapp", sourceId);
    expect(subscription).toMatch(/^[a-f0-9]{32}$/);
    expect(whatsapp).toMatch(/^[a-f0-9]{32}$/);
    expect(subscription).not.toBe(whatsapp);
    expect(paymentOrderId("subscription", sourceId)).toBe(subscription);
    expect(paymentOrderId("whatsapp", sourceId + "b")).not.toBe(whatsapp);
  });

  it("requires explicit trial rollout independently of provider readiness", () => {
    for (const [key, value] of Object.entries(sandbox)) vi.stubEnv(key, value);
    vi.stubEnv("HARDENING_EXTERNAL_PROVIDER_MODE", "sandbox");
    vi.stubEnv("BILLING_SELF_SERVE_SIGNUP", "0");
    expect(selfServeSignupEnabled()).toBe(false);
    vi.stubEnv("BILLING_SELF_SERVE_SIGNUP", "1");
    expect(selfServeSignupEnabled()).toBe(true);
    vi.stubEnv("GOPAY_WEBHOOK_SECRET", "");
    expect(selfServeSignupEnabled()).toBe(true);
    expect(getSubscriptionPaymentConfig().ready).toBe(false);
  });
});
