import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  subscription: vi.fn(),
  whatsapp: vi.fn(),
  applySubscription: vi.fn(),
  applyWhatsApp: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));
vi.mock("@/server/db/prisma", () => ({
  prisma: {
    subscriptionInvoice: { findUnique: mocks.subscription },
    whatsAppInvoice: { findUnique: mocks.whatsapp },
  },
}));
vi.mock("@/server/billing/subscriptionPayments", () => ({
  applySubscriptionReceipt: mocks.applySubscription,
}));
vi.mock("@/server/whatsapp/payments", () => ({ applyWhatsAppReceipt: mocks.applyWhatsApp }));
vi.mock("@/server/logging", () => ({ getLogger: () => ({ info: mocks.info, warn: mocks.warn }) }));

import { handleGoPayNotification } from "@/server/billing/goPayWebhook";
import { goPayMerchantId } from "@/server/billing/paymentConfig";
import { GOPAY_ACKNOWLEDGED_EVENTS } from "@/server/billing/gopay";
import { POST, runtime, dynamic } from "@/app/api/billing/gopay/webhook/route";
import {
  goPayProtocolFixture,
  GOPAY_FIXTURE_API_KEY,
  GOPAY_FIXTURE_API_SECRET,
  GOPAY_FIXTURE_WEBHOOK_SECRET,
  type GoPayFixturePayment,
} from "../helpers/gopayProtocolFixture";

describe("GoPay Live webhook HTTP boundary", () => {
  let fixture: ReturnType<typeof goPayProtocolFixture>;
  let payment: GoPayFixturePayment;
  const invoice = () => ({
    id: "synthetic-subscription-invoice",
    provider: "GOPAY",
    providerOrderId: payment.order_id,
    organizationId: "synthetic-organization",
    merchantId: goPayMerchantId(GOPAY_FIXTURE_API_KEY),
    providerPaymentId: payment.payment_id,
    amountMinor: 175050,
    currency: "KGS",
    isTest: false,
    status: "PENDING",
  });
  const expectNoApplication = () => {
    expect(mocks.applySubscription).not.toHaveBeenCalled();
    expect(mocks.applyWhatsApp).not.toHaveBeenCalled();
  };
  const expectNoLookup = () => {
    expect(mocks.subscription).not.toHaveBeenCalled();
    expect(mocks.whatsapp).not.toHaveBeenCalled();
    expect(fixture.transport).not.toHaveBeenCalled();
    expectNoApplication();
  };

  beforeEach(() => {
    vi.resetAllMocks();
    for (const [key, value] of Object.entries({
      GOPAY_API_KEY: GOPAY_FIXTURE_API_KEY,
      GOPAY_API_SECRET: GOPAY_FIXTURE_API_SECRET,
      GOPAY_WEBHOOK_SECRET: GOPAY_FIXTURE_WEBHOOK_SECRET,
      GOPAY_PREVIOUS_API_KEY: "",
      GOPAY_PREVIOUS_API_SECRET: "",
      BILLING_PAYMENT_PROVIDER: "gopay",
      BILLING_PAYMENTS_MODE: "live",
      HARDENING_EXTERNAL_PROVIDER_MODE: "mock",
      VERCEL_ENV: "production",
    }))
      vi.stubEnv(key, value);
    fixture = goPayProtocolFixture();
    payment = {
      payment_id: "1".repeat(32),
      order_id: "2".repeat(32),
      amount: "1750.50",
      status: "COMMITTED",
      checkout_url: `https://payment.gopay.kg/p/${"1".repeat(32)}`,
      created_at: "2026-11-10T10:00:00Z",
      expires_at: "2026-11-10T10:15:00Z",
      committed_at: "2026-11-10T10:01:00Z",
    };
    fixture.payments.set(payment.order_id, payment);
    vi.stubGlobal("fetch", fixture.transport);
    mocks.subscription.mockResolvedValue(invoice());
    mocks.whatsapp.mockResolvedValue(null);
    mocks.applySubscription.mockResolvedValue({ ...invoice(), status: "PAID" });
    mocks.applyWhatsApp.mockResolvedValue({ ...invoice(), status: "PAID" });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("publishes only the Node dynamic POST handler", () => {
    expect(POST).toBe(handleGoPayNotification);
    expect(runtime).toBe("nodejs");
    expect(dynamic).toBe("force-dynamic");
  });

  it("reconciles a real-shaped Live event with an independently signed API query before applying it", async () => {
    const response = await POST(fixture.notification(payment));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ received: true });
    expect(mocks.subscription).toHaveBeenCalledWith({
      where: { providerOrderId: payment.order_id },
    });
    expect(mocks.whatsapp).not.toHaveBeenCalled();
    expect(fixture.transport).toHaveBeenCalledTimes(1);
    expect(mocks.applySubscription).toHaveBeenCalledWith({
      invoiceId: invoice().id,
      source: "CALLBACK",
      receipt: expect.objectContaining({
        provider: "GOPAY",
        merchantId: invoice().merchantId,
        orderId: payment.order_id,
        paymentId: payment.payment_id,
        amountMinor: 175050,
        currency: "KGS",
        isTest: false,
        state: "PAID",
        eventKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    });
  });

  it("routes a persisted WhatsApp invoice independently of subscription checkout", async () => {
    mocks.subscription.mockResolvedValue(null);
    mocks.whatsapp.mockResolvedValue({ ...invoice(), id: "wa_synthetic" });
    expect((await POST(fixture.notification(payment))).status).toBe(200);
    expect(mocks.applyWhatsApp).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceId: "wa_synthetic" }),
    );
    expect(mocks.applySubscription).not.toHaveBeenCalled();
  });

  it("passes the same semantic event identity to the atomic grant core for concurrent duplicate deliveries", async () => {
    const responses = await Promise.all([1, 2, 3].map(() => POST(fixture.notification(payment))));
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
    expect(mocks.applySubscription).toHaveBeenCalledTimes(3);
    const keys = mocks.applySubscription.mock.calls.map(([input]) => input.receipt.eventKey);
    expect(new Set(keys).size).toBe(1);
    expect(
      mocks.applySubscription.mock.calls.every(([input]) => input.receipt.state === "PAID"),
    ).toBe(true);
  });

  it.each(["FAILED", "EXPIRED", "CANCELLED"] as const)(
    "does not let a delayed %s event override authoritative payment success",
    async (status) => {
      const response = await POST(fixture.notification(payment, { changes: { status } }));
      expect(response.status).toBe(200);
      expect(mocks.applySubscription.mock.calls[0][0].receipt.state).toBe("PAID");
    },
  );

  it("does not grant access from a committed event while the authenticated API still says unpaid", async () => {
    payment.status = "CREATED";
    const response = await POST(
      fixture.notification(payment, { changes: { status: "COMMITTED" } }),
    );
    expect(response.status).toBe(200);
    expect(mocks.applySubscription.mock.calls[0][0].receipt.state).toBe("PENDING");
  });

  it.each(["payment.failed", "payment.expired", "payment.cancelled"])(
    "applies the final API state for %s",
    async (event) => {
      payment.status = event
        .slice("payment.".length)
        .toUpperCase() as GoPayFixturePayment["status"];
      expect((await POST(fixture.notification(payment))).status).toBe(200);
      expect(mocks.applySubscription.mock.calls[0][0].receipt.state).toBe(
        payment.status === "EXPIRED" ? "EXPIRED" : "FAILED",
      );
    },
  );

  it.each([GOPAY_FIXTURE_API_SECRET, "synthetic-wrong-webhook-secret"])(
    "authenticates with the independent signing secret before any database or API lookup",
    async (secret) => {
      expect((await POST(fixture.notification(payment, { secret }))).status).toBe(401);
      expectNoLookup();
    },
  );

  it("rejects tampering with exact signed bytes before lookup", async () => {
    const request = fixture.notification(payment);
    const raw = await request.text();
    const tampered = new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: raw + " ",
    });
    expect((await POST(tampered)).status).toBe(401);
    expectNoLookup();
  });

  it.each([{ amount: "1750.51" }, { payment_id: "3".repeat(32) }, { testing_mode: true }])(
    "rejects signed cross-invoice amount/identity/mode changes before provider lookup",
    async (changes) => {
      const response = await POST(fixture.notification(payment, { changes }));
      expect(response.status).toBe(409);
      expect(fixture.transport).not.toHaveBeenCalled();
      expectNoApplication();
    },
  );

  it("refuses a persisted Test invoice on production", async () => {
    payment.testing_mode = true;
    mocks.subscription.mockResolvedValue({ ...invoice(), isTest: true });
    expect((await POST(fixture.notification(payment))).status).toBe(409);
    expect(fixture.transport).not.toHaveBeenCalled();
    expectNoApplication();
  });

  it.each(["unknown", "legacy-provider"])(
    "acknowledges a signed %s order without creating Bazaar access",
    async (kind) => {
      mocks.subscription.mockResolvedValue(
        kind === "unknown" ? null : { ...invoice(), provider: "FREEDOMPAY" },
      );
      expect((await POST(fixture.notification(payment))).status).toBe(200);
      expect(fixture.transport).not.toHaveBeenCalled();
      expectNoApplication();
    },
  );

  it.each([...GOPAY_ACKNOWLEDGED_EVENTS, "payment.future_status"])(
    "authenticates and acknowledges %s without interpreting it as a Bazaar purchase",
    async (event) => {
      const response = await POST(
        fixture.notification(payment, {
          rawBody: JSON.stringify({
            event,
            data: { amount: "999999.99", subscription_status: "active" },
          }),
        }),
      );
      expect(response.status).toBe(200);
      expectNoLookup();
    },
  );

  it("retries a temporary status outage and settles after recovery without a second payment", async () => {
    fixture.failStatus();
    expect((await POST(fixture.notification(payment))).status).toBe(503);
    expectNoApplication();
    fixture.recoverStatus();
    expect((await POST(fixture.notification(payment))).status).toBe(200);
    expect(mocks.applySubscription).toHaveBeenCalledTimes(1);
    expect(fixture.payments.size).toBe(1);
  });

  it("reports a temporary provider/protocol outage as 503 without confirming payment", async () => {
    fixture.overrideStatus({ checkout_url: "https://untrusted.example/payment" });
    expect((await POST(fixture.notification(payment))).status).toBe(503);
    expectNoApplication();
    expect(mocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "provider", status: 503 }),
      "payment webhook",
    );
  });

  it("rejects a Test status returned for an expected Live invoice without applying access", async () => {
    fixture.overrideStatus({ testing_mode: true });
    expect((await POST(fixture.notification(payment))).status).toBe(503);
    expectNoApplication();
  });

  it("preserves retries when database/application processing fails", async () => {
    mocks.subscription.mockRejectedValueOnce(new Error("synthetic database unavailable"));
    expect((await POST(fixture.notification(payment))).status).toBe(503);
    expect(fixture.transport).not.toHaveBeenCalled();
    mocks.applySubscription.mockRejectedValueOnce(new Error("synthetic transaction rollback"));
    expect((await POST(fixture.notification(payment))).status).toBe(503);
    expect((await POST(fixture.notification(payment))).status).toBe(200);
  });

  it.each(["disabled", "obsolete-provider-setting"])(
    "keeps persisted GoPay reconciliation working when new checkout is %s",
    async (mode) => {
      if (mode === "disabled") vi.stubEnv("BILLING_PAYMENTS_MODE", "disabled");
      else vi.stubEnv("BILLING_PAYMENT_PROVIDER", "freedompay");
      expect((await POST(fixture.notification(payment))).status).toBe(200);
      expect(mocks.applySubscription.mock.calls[0][0].receipt.state).toBe("PAID");
    },
  );

  it("queries a historical invoice using only its explicitly retained matching API credentials", async () => {
    vi.stubEnv("GOPAY_API_KEY", "synthetic-replacement-key");
    vi.stubEnv("GOPAY_API_SECRET", "synthetic-replacement-secret");
    vi.stubEnv("GOPAY_PREVIOUS_API_KEY", GOPAY_FIXTURE_API_KEY);
    vi.stubEnv("GOPAY_PREVIOUS_API_SECRET", GOPAY_FIXTURE_API_SECRET);
    expect((await POST(fixture.notification(payment))).status).toBe(200);
    expect(fixture.transport).toHaveBeenCalledTimes(1);
  });

  it("does not acknowledge a known invoice whose retained credentials are missing", async () => {
    vi.stubEnv("GOPAY_API_KEY", "synthetic-different-merchant-key");
    expect((await POST(fixture.notification(payment))).status).toBe(503);
    expect(fixture.transport).not.toHaveBeenCalled();
    expectNoApplication();
  });

  it.each(["secret", "external-calls"])(
    "fails closed when webhook configuration lacks %s",
    async (kind) => {
      if (kind === "secret") vi.stubEnv("GOPAY_WEBHOOK_SECRET", "");
      else vi.stubEnv("HARDENING_EXTERNAL_PROVIDER_MODE", "disabled");
      expect((await POST(fixture.notification(payment))).status).toBe(503);
      expectNoLookup();
    },
  );

  it("does not put raw payloads, API credentials or signatures in diagnostic logs", async () => {
    fixture.failStatus();
    await POST(fixture.notification(payment));
    const logs = JSON.stringify([mocks.info.mock.calls, mocks.warn.mock.calls]);
    for (const secret of [
      GOPAY_FIXTURE_API_KEY,
      GOPAY_FIXTURE_API_SECRET,
      GOPAY_FIXTURE_WEBHOOK_SECRET,
      payment.order_id,
      payment.payment_id,
    ])
      expect(logs).not.toContain(secret);
    expect(logs).toContain("not_acknowledged");
  });
});
