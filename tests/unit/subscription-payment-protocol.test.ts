import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  allowedCheckoutUrl,
  parseFreedomPayXml,
  parsePaymentNotification,
  signFreedomPay,
  verifyFreedomPay,
} from "@/server/billing/freedomPay";
import {
  getSubscriptionPaymentConfig,
  selfServeSignupEnabled,
} from "@/server/billing/paymentConfig";
import { extendSubscriptionMonth, kgsToMinor, minorToKgs } from "@/server/billing/paymentMath";
import { resolveOrganizationAccessState } from "@/server/services/planLimits";

describe("subscription payment protocol and money", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("matches Freedom Pay's documented sorted-value signature, including unknown fields", () => {
    const fields = {
      pg_order_id: "23",
      pg_merchant_id: "12345",
      pg_amount: "25",
      pg_description: "test",
      pg_salt: "molbulak",
      custom: "value",
    };
    const expected = createHash("md5")
      .update("init_payment.php;value;25;test;12345;23;molbulak;test-secret")
      .digest("hex");
    expect(signFreedomPay("init_payment.php", fields, "test-secret")).toBe(expected);
    const signed = { ...fields, pg_sig: expected };
    expect(() => verifyFreedomPay("init_payment.php", signed, "test-secret")).not.toThrow();
    expect(() =>
      verifyFreedomPay("init_payment.php", { ...signed, custom: "changed" }, "test-secret"),
    ).toThrow("billingInvalidSignature");
    expect(() => verifyFreedomPay("get_status3.php", signed, "test-secret")).toThrow(
      "billingInvalidSignature",
    );
  });
  it("decodes XML text and repeated/nested fields without converting signed values", () => {
    const fields = parseFreedomPayXml(
      '<?xml version="1.0"?><response>\n<pg_amount>001.50</pg_amount><pg_redirect_url>https://api.freedompay.kg/pay?a=1&amp;b=2</pg_redirect_url><items><item><b>2</b><a>1</a></item><item><b>4</b><a>3</a></item></items></response>',
    );
    expect(fields.pg_amount).toBe("001.50");
    expect(fields.pg_redirect_url).toBe("https://api.freedompay.kg/pay?a=1&b=2");
    expect(signFreedomPay("result", fields, "secret")).toBe(
      createHash("md5")
        .update("result;1;2;3;4;001.50;https://api.freedompay.kg/pay?a=1&b=2;secret")
        .digest("hex"),
    );
  });
  it.each([
    '<!DOCTYPE response [<!ENTITY x SYSTEM "file:///etc/passwd">]><response><pg_status>&x;</pg_status></response>',
    "<response><pg_status>ok</response>",
    "<request><pg_status>ok</pg_status></request>",
    '<response><pg_status attr="x">ok</pg_status></response>',
    "<response><pg_status>" + "x".repeat(65_536) + "</pg_status></response>",
  ])("rejects malformed/oversized/entity XML without accepting provider data", (xml) => {
    expect(() => parseFreedomPayXml(xml)).toThrow("billingInvalidProviderResponse");
  });
  it("rejects duplicate notification fields and oversized bodies", async () => {
    await expect(
      parsePaymentNotification(
        new Request("http://localhost", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: "pg_order_id=one&pg_order_id=two",
        }),
      ),
    ).rejects.toThrow();
    await expect(
      parsePaymentNotification(
        new Request("http://localhost", { method: "POST", body: "x".repeat(65_537) }),
      ),
    ).rejects.toThrow();
  });
  it.each([
    "https://evil.test/pay",
    "https://api.freedompay.kg.evil.test",
    "http://api.freedompay.kg/pay",
    "https://user:password@api.freedompay.kg/pay",
    "javascript:alert(1)",
  ])("rejects an unsafe hosted checkout URL %s", (url) =>
    expect(allowedCheckoutUrl(url)).toBe(false),
  );
  it("accepts the documented Kyrgyz payment host", () =>
    expect(allowedCheckoutUrl("https://api.freedompay.kg/pay.html?customer=synthetic")).toBe(true));
  it("represents KGS as exact minor units", () => {
    expect(kgsToMinor("1890.50")).toBe(189050);
    expect(minorToKgs(189050)).toBe("1890.50");
    expect(kgsToMinor("0.01")).toBe(1);
  });
  it.each(["0", "-1", "1.001", "NaN", "Infinity", "1e3", "21474836.48"])(
    "rejects non-billable amounts %s",
    (amount) => expect(() => kgsToMinor(amount)).toThrow("billingInvalidAmount"),
  );
  it("keeps January 31's billing anchor through February and March", () => {
    const feb = extendSubscriptionMonth(new Date("2027-01-31T10:12:30.123Z"), 31);
    expect(feb.toISOString()).toBe("2027-02-28T10:12:30.123Z");
    expect(extendSubscriptionMonth(feb, 31).toISOString()).toBe("2027-03-31T10:12:30.123Z");
    expect(extendSubscriptionMonth(new Date("2028-01-31T10:12:30Z"), 31).toISOString()).toBe(
      "2028-02-29T10:12:30.000Z",
    );
  });
  it("protects manual approved access but expires self-serve access on every request", () => {
    const org = {
      plan: "BUSINESS" as const,
      subscriptionStatus: "ACTIVE",
      trialEndsAt: new Date("2026-01-01"),
      currentPeriodEndsAt: new Date("2026-02-01"),
    };
    const now = new Date("2026-03-01");
    expect(
      resolveOrganizationAccessState({ ...org, subscriptionBillingMode: "MANUAL" }, now).hasAccess,
    ).toBe(true);
    expect(
      resolveOrganizationAccessState({ ...org, subscriptionBillingMode: "SELF_SERVE" }, now)
        .hasAccess,
    ).toBe(false);
  });
  it("does not label a new unpaid self-serve trial as a paid subscription", () => {
    const end = new Date("2027-01-01");
    expect(
      resolveOrganizationAccessState(
        {
          plan: "STARTER",
          subscriptionStatus: "ACTIVE",
          subscriptionBillingMode: "SELF_SERVE",
          trialEndsAt: end,
          currentPeriodEndsAt: end,
        },
        new Date("2026-12-01"),
      ),
    ).toMatchObject({ trialActive: true, subscriptionActive: false, hasAccess: true });
  });
});

describe("merchant activation gates", () => {
  const env = {
    BILLING_PAYMENTS_MODE: "sandbox",
    FREEDOMPAY_MERCHANT_ID: "12345",
    FREEDOMPAY_SECRET_KEY: "synthetic-test-secret",
    BILLING_PUBLIC_URL: "https://bazaar.example",
    BILLING_TERMS_URL: "https://bazaar.example/terms",
    BILLING_TERMS_VERSION: "2026-10",
    BILLING_SELLER_NAME: "Synthetic QA",
  };
  it("defaults to disabled and never enrolls existing organizations", () =>
    expect(getSubscriptionPaymentConfig({})).toMatchObject({ mode: "disabled", ready: false }));
  it("requires complete configuration and explicit confirmation for live", () => {
    expect(getSubscriptionPaymentConfig(env).ready).toBe(true);
    expect(getSubscriptionPaymentConfig({ ...env, BILLING_PAYMENTS_MODE: "live" }).ready).toBe(
      false,
    );
    expect(
      getSubscriptionPaymentConfig({
        ...env,
        BILLING_PAYMENTS_MODE: "live",
        BILLING_LIVE_ACTIVATION_CONFIRMED: "1",
      }).ready,
    ).toBe(true);
    expect(getSubscriptionPaymentConfig({ ...env, VERCEL_ENV: "production" }).ready).toBe(false);
    expect(
      getSubscriptionPaymentConfig({ ...env, HARDENING_EXTERNAL_PROVIDER_MODE: "disabled" }).ready,
    ).toBe(false);
    expect(
      getSubscriptionPaymentConfig({ ...env, BILLING_PUBLIC_URL: "https://bazaar.example/else" })
        .ready,
    ).toBe(false);
  });
  it("requires both merchant readiness and the rollout flag for future signups", () => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    vi.stubEnv("HARDENING_EXTERNAL_PROVIDER_MODE", "");
    vi.stubEnv("BILLING_SELF_SERVE_SIGNUP", "0");
    expect(selfServeSignupEnabled()).toBe(false);
    vi.stubEnv("BILLING_SELF_SERVE_SIGNUP", "1");
    expect(selfServeSignupEnabled()).toBe(true);
    vi.unstubAllEnvs();
  });
});
