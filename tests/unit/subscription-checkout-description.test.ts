import { afterEach, describe, expect, it, vi } from "vitest";
import { initializeFreedomPay, signFreedomPay } from "@/server/billing/freedomPay";

const secret = "synthetic-checkout-description-secret";
const snapshot = (months: 1 | 6 | 12, kind: "RENEWAL" | "UPGRADE" = "RENEWAL") => ({
  version: 1,
  catalogVersion: "2026-11",
  kind,
  plan: "BUSINESS",
  months,
  extras: { stores: 0, productPacks: 0, userPacks: 0 },
  monthlyMinor: 350000,
  discountBps: 1500,
  fullAmountMinor: 4200000,
  amountMinor: 3570000,
  serviceValueMinor: 3570000,
  creditMinor: 0,
  organizationId: "synthetic-org",
  expectedPlan: "BUSINESS",
  expectedPeriodEnd: null,
  sourcePeriodId: null,
  startsAt: "2027-01-01T00:00:00.000Z",
  endsAt: "2028-01-01T00:00:00.000Z",
  cycleStartsAt: "2027-01-01T00:00:00.000Z",
  cycleEndsAt: "2028-01-01T00:00:00.000Z",
  anchorDay: 1,
  issuedAt: "2027-01-01T00:00:00.000Z",
  expiresAt: "2027-01-01T00:15:00.000Z",
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("gateway description represents the immutable invoice term", () => {
  it.each([
    ["en", 1, "RENEWAL", "Bazaar BUSINESS: access for 1 month"],
    ["en", 6, "RENEWAL", "Bazaar BUSINESS: access for 6 months"],
    ["en", 12, "RENEWAL", "Bazaar BUSINESS: access for 12 months"],
    ["en", 12, "UPGRADE", "Bazaar BUSINESS: upgrade, current 12-month term"],
    ["ru", 6, "RENEWAL", "Bazaar BUSINESS: доступ на 6 мес."],
    ["ru", 12, "UPGRADE", "Bazaar BUSINESS: повышение тарифа, текущий период 12 мес."],
    ["kg", 12, "RENEWAL", "Bazaar BUSINESS: 12 айга жеткилик"],
    ["kg", 6, "UPGRADE", "Bazaar BUSINESS: тарифти жогорулатуу, учурдагы 6 айлык мөөнөт"],
    ["en", null, "RENEWAL", "Bazaar BUSINESS: access for 1 month"],
  ] as const)(
    "sends the correct %s %s-month %s purpose",
    async (locale, months, kind, description) => {
      for (const [key, value] of Object.entries({
        BILLING_PAYMENTS_MODE: "sandbox",
        FREEDOMPAY_MERCHANT_ID: "90003",
        FREEDOMPAY_SECRET_KEY: secret,
        BILLING_PUBLIC_URL: "http://localhost:3120",
        BILLING_TERMS_URL: "http://localhost:3120/terms",
        BILLING_TERMS_VERSION: "qa-v1",
        BILLING_SELLER_NAME: "Synthetic seller",
        VERCEL_ENV: "development",
        HARDENING_EXTERNAL_PROVIDER_MODE: "sandbox",
      }))
        vi.stubEnv(key, value);
      const transport = vi.fn(async (_url: string, options: RequestInit) => {
        const request = Object.fromEntries(new URLSearchParams(options.body as URLSearchParams));
        expect(request.pg_description).toBe(description);
        expect(request.pg_description).not.toMatch(/synthetic-org|@|auto|recurr/i);
        const response = {
          pg_status: "ok",
          pg_payment_id: "12345",
          pg_redirect_url: "https://api.freedompay.kg/pay?id=12345",
          pg_salt: "synthetic",
        };
        const signature = signFreedomPay("init_payment.php", response, secret);
        return new Response(
          `<response>${Object.entries({ ...response, pg_sig: signature })
            .map(([key, value]) => `<${key}>${value}</${key}>`)
            .join("")}</response>`,
        );
      });
      vi.stubGlobal("fetch", transport);
      expect(
        await initializeFreedomPay({
          id: "synthetic-invoice",
          merchantId: "90003",
          amountMinor: 3570000,
          plan: "BUSINESS",
          isTest: true,
          locale,
          purchaseSnapshot: months ? snapshot(months, kind) : undefined,
        }),
      ).toMatchObject({ accepted: true, paymentId: "12345" });
      expect(transport).toHaveBeenCalledOnce();
    },
  );
});
