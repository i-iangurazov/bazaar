import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  allowedGoPayCheckoutUrl,
  cancelGoPayPayment,
  getGoPayStatus,
  GOPAY_BODY_LIMIT,
  GOPAY_MAX_AMOUNT_MINOR,
  GOPAY_ACKNOWLEDGED_EVENTS,
  GOPAY_PAYMENT_EVENT_STATUSES,
  initializeGoPay,
  parseGoPayWebhook,
  readGoPayBody,
  signGoPay,
  verifyGoPaySignature,
} from "@/server/billing/gopay";

const credentials = { apiKey: "synthetic-api-key", apiSecret: "synthetic-api-secret" };
const webhookSecret = "synthetic-independent-webhook-secret";
const orderId = "b3e958601023487cbd471385238c7e33";
const paymentId = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4";
const checkoutUrl = `https://pay.gopay.kg/p/${paymentId}/`;
const input = {
  orderId,
  amountMinor: 175050,
  description: "Подписка Bazaar — 6 месяцев",
  isTest: true,
};

const data = (overrides: Record<string, unknown> = {}) => ({
  payment_id: paymentId,
  order_id: orderId,
  amount: "1750.50",
  status: "CREATED",
  testing_mode: true,
  checkout_url: checkoutUrl,
  created_at: "2026-11-09T12:00:00Z",
  expires_at: "2026-11-09T13:00:00Z",
  committed_at: null,
  ...overrides,
});
const response = (overrides: Record<string, unknown> = {}) =>
  Response.json({ status: "OK", code: "0000", data: data(overrides) });
const signedWebhook = (value: unknown, secret = webhookSecret) => {
  const rawBody = JSON.stringify(value);
  const nonce = "synthetic-delivery-nonce";
  // Independently generate provider fixtures from the published wire contract.
  const signature = createHmac("sha512", secret)
    .update(nonce + "\n" + rawBody + "\n", "utf8")
    .digest("hex")
    .toUpperCase();
  return { rawBody, headers: { nonce, signature } };
};
const event = (overrides: Record<string, unknown> = {}) => ({
  event: "payment.committed",
  created_at: "2026-11-09T12:00:20.123456Z",
  data: data({ status: "COMMITTED" }),
  ...overrides,
});

describe("GoPay's authenticated JSON protocol", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  beforeEach(() => vi.stubEnv("HARDENING_EXTERNAL_PROVIDER_MODE", "mock"));

  it("signs exact UTF-8 bytes, newlines and uppercase SHA-512, including whitespace", () => {
    const body = '{ "order_id": "example", "description": "Кыргызча — оплата" }';
    const nonce = "0123456789abcdef0123456789abcdef";
    const expected = createHmac("sha512", credentials.apiSecret)
      .update(Buffer.from(`${nonce}\n${body}\n`, "utf8"))
      .digest("hex")
      .toUpperCase();
    expect(signGoPay(nonce, body, credentials.apiSecret)).toBe(expected);
    expect(() =>
      verifyGoPaySignature(body, { nonce, signature: expected }, credentials.apiSecret),
    ).not.toThrow();
    expect(() =>
      verifyGoPaySignature(body + " ", { nonce, signature: expected }, credentials.apiSecret),
    ).toThrow("billingInvalidSignature");
  });

  it.each([
    { nonce: null, signature: "A".repeat(128) },
    { nonce: "", signature: "A".repeat(128) },
    { nonce: "x".repeat(33), signature: "A".repeat(128) },
    { nonce: "nonce\r\nheader", signature: "A".repeat(128) },
    { nonce: "nonce", signature: null },
    { nonce: "nonce", signature: "x".repeat(128) },
    { nonce: "nonce", signature: "A".repeat(127) },
  ])("rejects malformed authentication headers", (headers) => {
    expect(() => verifyGoPaySignature("{}", headers, webhookSecret)).toThrow(
      "billingInvalidSignature",
    );
  });

  it("creates the exact KGS payment using a fresh nonce without deprecated mode overrides", async () => {
    const fetch = vi.fn().mockImplementation(async () => response());
    vi.stubGlobal("fetch", fetch);
    await expect(
      initializeGoPay(
        { ...input, returnUrl: "https://bazaar.example/billing?invoice=qa", lifetimeSeconds: 3600 },
        credentials,
      ),
    ).resolves.toEqual({
      paymentId,
      orderId,
      amountMinor: 175050,
      status: "CREATED",
      isTest: true,
      checkoutUrl,
    });
    await initializeGoPay(input, credentials);
    const [url, request] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.gopay.kg/v1/payments");
    expect(request).toMatchObject({ method: "POST", redirect: "error", cache: "no-store" });
    expect(request.signal).toBeInstanceOf(AbortSignal);
    const fields = JSON.parse(request.body as string);
    expect(fields).toEqual({
      order_id: orderId,
      amount: "1750.50",
      description: input.description,
      success_url: "https://bazaar.example/billing?invoice=qa",
      failure_url: "https://bazaar.example/billing?invoice=qa",
      lifetime: 3600,
    });
    expect(fields).not.toHaveProperty("testing_mode");
    const headers = new Headers(request.headers);
    const nonce = headers.get("GoPay-Nonce")!;
    expect(nonce).toMatch(/^[a-f0-9]{32}$/);
    expect(headers.get("GoPay-Api-Key")).toBe(credentials.apiKey);
    expect(headers.get("GoPay-Signature")).toBe(
      createHmac("sha512", credentials.apiSecret)
        .update(`${nonce}\n${request.body}\n`, "utf8")
        .digest("hex")
        .toUpperCase(),
    );
    expect(new Headers(fetch.mock.calls[1][1].headers).get("GoPay-Nonce")).not.toBe(nonce);
  });

  it.each([1, GOPAY_MAX_AMOUNT_MINOR])(
    "preserves exact provider boundary amount %s minor units",
    async (amountMinor) => {
      const amount = `${Math.floor(amountMinor / 100)}.${String(amountMinor % 100).padStart(2, "0")}`;
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ amount })));
      await expect(initializeGoPay({ ...input, amountMinor }, credentials)).resolves.toMatchObject({
        amountMinor,
      });
    },
  );

  it.each([0, -1, 1.5, NaN, Infinity, GOPAY_MAX_AMOUNT_MINOR + 1])(
    "rejects invalid requested amount %s before any request",
    async (amountMinor) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      await expect(initializeGoPay({ ...input, amountMinor }, credentials)).rejects.toThrow(
        "billingInvalidAmount",
      );
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    { orderId: "x".repeat(33) },
    { orderId: "" },
    { description: "x".repeat(256) },
    { description: " " },
    { lifetimeSeconds: 299 },
    { lifetimeSeconds: 86401 },
    { lifetimeSeconds: 300.5 },
    { returnUrl: "http://bazaar.example/billing" },
    { returnUrl: "https://user:password@bazaar.example/billing" },
  ])("rejects invalid provider input before any request", async (overrides) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(initializeGoPay({ ...input, ...overrides }, credentials)).rejects.toThrow(
      "billingInvalidProviderResponse",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { amount: "1e3" },
    { amount: "NaN" },
    { amount: "0" },
    { amount: "1750.501" },
    { amount: "1000000.00" },
    { amount: 1750.5 },
    { amount: "1750.51" },
    { status: "PENDING" },
    { status: "refunded" },
    { status: "__proto__" },
    { status: ["COMMITTED"] },
    { currency: "USD" },
    { testing_mode: "true" },
    { testing_mode: false },
    { testing_mode: undefined },
    { order_id: "another-order" },
    { payment_id: "not-a-payment-id" },
    { checkout_url: "https://pay.gopay.kg.evil.example/pay" },
  ])("rejects malformed, mismatched or unsafe create responses", async (overrides) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(overrides)));
    await expect(initializeGoPay(input, credentials)).rejects.toThrow(
      "billingInvalidProviderResponse",
    );
  });

  it("recognizes absent testing_mode as Live and checks the caller's expected mode", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ testing_mode: undefined })));
    await expect(initializeGoPay({ ...input, isTest: false }, credentials)).resolves.toMatchObject({
      isTest: false,
    });
  });

  it("accepts the hosted checkout host returned by the authenticated real Test API", async () => {
    const actualCheckout = `https://payment.gopay.kg/p/${paymentId}`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ checkout_url: actualCheckout })));
    await expect(initializeGoPay(input, credentials)).resolves.toMatchObject({
      checkoutUrl: actualCheckout,
    });
    expect(allowedGoPayCheckoutUrl(actualCheckout)).toBe(true);
  });

  it("queries either missing or known provider IDs and rejects cross-invoice receipts", async () => {
    const fetch = vi.fn().mockImplementation(async () => response({ status: "COMMITTED" }));
    vi.stubGlobal("fetch", fetch);
    const lookup = { orderId, providerPaymentId: paymentId, isTest: true };
    await expect(getGoPayStatus(lookup, credentials)).resolves.toMatchObject({
      status: "COMMITTED",
    });
    expect(fetch.mock.calls[0][0]).toBe("https://api.gopay.kg/v1/payments/query");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      order_id: orderId,
      payment_id: paymentId,
    });
    await getGoPayStatus({ orderId, isTest: true }, credentials);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ order_id: orderId });
    fetch.mockResolvedValue(response({ payment_id: "f".repeat(32) }));
    await expect(getGoPayStatus(lookup, credentials)).rejects.toThrow(
      "billingInvalidProviderResponse",
    );
  });

  it("cancels only an unpaid payment and cannot represent a refund or completed cancellation", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ status: "CANCELLED" }));
    vi.stubGlobal("fetch", fetch);
    const lookup = { orderId, providerPaymentId: paymentId, isTest: true };
    await expect(cancelGoPayPayment(lookup, credentials)).resolves.toMatchObject({
      status: "CANCELLED",
    });
    expect(fetch.mock.calls[0][0]).toBe("https://api.gopay.kg/v1/payments/cancel");
    fetch.mockResolvedValue(response({ status: "COMMITTED" }));
    await expect(cancelGoPayPayment(lookup, credentials)).rejects.toThrow(
      "billingInvalidProviderResponse",
    );
  });

  it("keeps a duplicate-order result unresolved with its non-sensitive provider code", async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        status: "FAIL",
        code: "0006",
        error_message: "private provider diagnostic",
      }),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(initializeGoPay(input, credentials)).rejects.toMatchObject({
      message: "billingProviderUnavailable",
      details: { provider: "GOPAY", providerCode: "0006" },
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    { status: "FAIL", code: "0000" },
    { status: "OK", code: "0006", data: data() },
    { data: data() },
    { status: "OK", code: 0, data: data() },
  ])("never accepts a response without both success indicators", async (envelope) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(envelope)));
    await expect(initializeGoPay(input, credentials)).rejects.toThrow();
  });

  it("does not expose a network error containing credentials and does not retry creates", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("network failure synthetic-api-secret"));
    vi.stubGlobal("fetch", fetch);
    await expect(initializeGoPay(input, credentials)).rejects.toMatchObject({
      message: "billingProviderUnavailable",
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([301, 400, 429, 503])("does not accept HTTP %s as successful payment", async (status) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(Response.json({ status: "OK", code: "0000", data: data() }, { status })),
    );
    await expect(initializeGoPay(input, credentials)).rejects.toThrow("billingProviderUnavailable");
  });

  it.each(["{", "[]", "null", "42", JSON.stringify({ status: "OK", code: "0000", data: null })])(
    "rejects malformed response JSON %s",
    async (body) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
      await expect(initializeGoPay(input, credentials)).rejects.toThrow(
        "billingInvalidProviderResponse",
      );
    },
  );

  it("rejects oversized provider responses without trusting Content-Length", async () => {
    const body = " ".repeat(GOPAY_BODY_LIMIT + 1);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(body, { headers: { "content-length": "1" } })),
    );
    await expect(initializeGoPay(input, credentials)).rejects.toThrow(
      "billingInvalidProviderResponse",
    );
  });

  it("honors the external-provider kill switch and rejects missing or header-injected credentials", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("HARDENING_EXTERNAL_PROVIDER_MODE", "disabled");
    await expect(initializeGoPay(input, credentials)).rejects.toThrow("billingPaymentsUnavailable");
    vi.stubEnv("HARDENING_EXTERNAL_PROVIDER_MODE", "mock");
    await expect(
      initializeGoPay(input, { ...credentials, apiKey: "key\nInjected: x" }),
    ).rejects.toThrow("billingPaymentsUnavailable");
    await expect(initializeGoPay(input, { ...credentials, apiSecret: "" })).rejects.toThrow(
      "billingPaymentsUnavailable",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    "http://pay.gopay.kg/p/id",
    "https://pay.gopay.kg.evil.example/",
    "https://user:password@pay.gopay.kg/p/id",
    "https://pay.gopay.kg:9443/p/id",
    "https://payment.gopay.kg.evil.example/p/id",
    "https://payment-gopay.kg/p/id",
    "https://user:password@payment.gopay.kg/p/id",
    "https://payment.gopay.kg:9443/p/id",
    "http://payment.gopay.kg/p/id",
    "javascript:alert(1)",
    "https://evil.example/pay",
  ])("rejects unsafe checkout URL %s", (url) => expect(allowedGoPayCheckoutUrl(url)).toBe(false));
});

describe("GoPay typed webhook authentication and receipt validation", () => {
  it.each([
    ["payment.committed", "COMMITTED"],
    ["payment.failed", "FAILED"],
    ["payment.expired", "EXPIRED"],
    ["payment.cancelled", "CANCELLED"],
  ])("accepts the documented signed %s event", (name, status) => {
    const signed = signedWebhook(event({ event: name, data: data({ status }) }));
    expect(parseGoPayWebhook(signed.rawBody, signed.headers, webhookSecret)).toEqual({
      event: name,
      createdAt: "2026-11-09T12:00:20.123456Z",
      payment: { paymentId, orderId, amountMinor: 175050, status, isTest: true },
    });
  });

  it("requires the independent webhook secret and verifies before parsing", () => {
    const signed = signedWebhook(event());
    expect(() => parseGoPayWebhook(signed.rawBody, signed.headers, credentials.apiSecret)).toThrow(
      "billingInvalidSignature",
    );
    expect(() =>
      parseGoPayWebhook(
        signed.rawBody.replace("1750.50", "2000.00"),
        signed.headers,
        webhookSecret,
      ),
    ).toThrow("billingInvalidSignature");
    expect(() => parseGoPayWebhook("{", signed.headers, webhookSecret)).toThrow(
      "billingInvalidSignature",
    );
  });

  it("rejects matching signatures over oversized payloads", () => {
    const signed = signedWebhook(event({ future: "x".repeat(GOPAY_BODY_LIMIT) }));
    expect(() => parseGoPayWebhook(signed.rawBody, signed.headers, webhookSecret)).toThrow(
      "billingInvalidProviderResponse",
    );
  });

  it.each([
    { data: data({ status: "FAILED" }) },
    { data: data({ status: "CREATED" }) },
    { data: data({ amount: "1750.001" }) },
    { data: data({ amount: "0.00" }) },
    { data: data({ amount: 1750 }) },
    { data: data({ testing_mode: "false" }) },
    { data: data({ testing_mode: null }) },
    { data: data({ payment_id: "A".repeat(32) }) },
    { data: data({ order_id: "x".repeat(33) }) },
    { created_at: "2026-11-09T12:00:20" },
    { created_at: "invalid" },
    { data: [] },
    { data: null },
    { event: "" },
  ])("rejects signed but malformed or inconsistent payment events", (overrides) => {
    const signed = signedWebhook(event(overrides));
    expect(() => parseGoPayWebhook(signed.rawBody, signed.headers, webhookSecret)).toThrow(
      "billingInvalidProviderResponse",
    );
  });

  it("recognizes Live only from a non-test receipt and ignores future fields", () => {
    const signed = signedWebhook(
      event({
        data: data({
          status: "COMMITTED",
          testing_mode: undefined,
          future_provider_field: { enabled: true },
        }),
        future_envelope_field: "allowed",
      }),
    );
    expect(parseGoPayWebhook(signed.rawBody, signed.headers, webhookSecret)).toMatchObject({
      payment: { isTest: false },
    });
  });

  it.each([...GOPAY_ACKNOWLEDGED_EVENTS, "payment.future_status"])(
    "authenticates but ignores unrelated event %s",
    (name) => {
      const signed = signedWebhook({ event: name, data: { arbitrary: true } });
      expect(parseGoPayWebhook(signed.rawBody, signed.headers, webhookSecret)).toEqual({
        event: name,
        ignored: true,
      });
      expect(() => parseGoPayWebhook(signed.rawBody, signed.headers, "wrong-secret")).toThrow(
        "billingInvalidSignature",
      );
    },
  );

  it("defines only the four payment transitions as access-reconciliation events", () => {
    expect(GOPAY_PAYMENT_EVENT_STATUSES).toEqual({
      "payment.committed": "COMMITTED",
      "payment.failed": "FAILED",
      "payment.expired": "EXPIRED",
      "payment.cancelled": "CANCELLED",
    });
    expect(GOPAY_ACKNOWLEDGED_EVENTS).toEqual(
      expect.arrayContaining([
        "receipt.sent",
        "static_qr.state_changed",
        "subscription.activated",
        "subscription.paused",
        "subscription.suspended",
        "subscription.cancelled",
        "subscription.completed",
        "invoice.created",
        "invoice.paid",
        "test.ping",
      ]),
    );
  });

  it("retains raw UTF-8 bytes including BOM for authentication instead of silently normalizing them", async () => {
    const raw = '\uFEFF{"event":"test.ping"}';
    const decoded = await readGoPayBody(new Response(raw));
    expect(decoded).toBe(raw);
    const signed = signedWebhook({ event: "test.ping" });
    expect(() => parseGoPayWebhook(decoded, signed.headers, webhookSecret)).toThrow(
      "billingInvalidSignature",
    );
  });

  it("authenticates a raw body split across a multibyte UTF-8 character", async () => {
    const raw = JSON.stringify({ event: "test.ping", data: { text: "Кыргызча" } });
    const bytes = new TextEncoder().encode(raw);
    const split = bytes.findIndex((value) => value >= 0xc0) + 1;
    const body = new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(controller) {
        controller.enqueue(bytes.slice(0, split));
        controller.enqueue(bytes.slice(split));
        controller.close();
      },
    });
    const decoded = await readGoPayBody({ headers: new Headers(), body });
    const nonce = "split-unicode-delivery";
    const signature = createHmac("sha512", webhookSecret)
      .update(`${nonce}\n${raw}\n`, "utf8")
      .digest("hex")
      .toUpperCase();
    expect(decoded).toBe(raw);
    expect(parseGoPayWebhook(decoded, { nonce, signature }, webhookSecret)).toEqual({
      event: "test.ping",
      ignored: true,
    });
  });

  it("rejects invalid UTF-8 rather than changing the bytes covered by a signature", async () => {
    await expect(readGoPayBody(new Response(new Uint8Array([0xc3, 0x28])))).rejects.toThrow(
      "billingInvalidProviderResponse",
    );
  });

  it("bounds declared and streamed body size", async () => {
    await expect(
      readGoPayBody(
        new Response("{}", { headers: { "content-length": String(GOPAY_BODY_LIMIT + 1) } }),
      ),
    ).rejects.toThrow("billingInvalidProviderResponse");
    const cancel = vi.fn();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(GOPAY_BODY_LIMIT));
        controller.enqueue(new Uint8Array([1]));
        controller.close();
      },
      cancel,
    });
    await expect(readGoPayBody({ headers: new Headers(), body: stream })).rejects.toThrow(
      "billingInvalidProviderResponse",
    );
    expect(stream.locked).toBe(false);
  });
});
