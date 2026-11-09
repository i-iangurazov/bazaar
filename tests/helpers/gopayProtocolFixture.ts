import { createHmac } from "node:crypto";
import { expect, vi } from "vitest";

// Independent wire fixture: it deliberately does not import the GoPay adapter,
// signing implementation or receipt normalizer used by the application.
export const GOPAY_FIXTURE_API_KEY = "synthetic-gopay-api-key";
export const GOPAY_FIXTURE_API_SECRET = "synthetic-gopay-api-secret-20261109";
export const GOPAY_FIXTURE_WEBHOOK_SECRET = "synthetic-gopay-webhook-secret-20261109";

export type GoPayFixturePayment = {
  payment_id: string;
  order_id: string;
  amount: string;
  status: "CREATED" | "COMMITTED" | "FAILED" | "EXPIRED" | "CANCELLED";
  checkout_url: string;
  created_at: string;
  expires_at: string;
  committed_at: string | null;
  testing_mode?: boolean;
};

export function fixtureGoPaySignature(secret: string, nonce: string, rawBody: string) {
  return createHmac("sha512", secret).update(`${nonce}\n${rawBody}\n`).digest("hex").toUpperCase();
}

export function goPayProtocolFixture() {
  const payments = new Map<string, GoPayFixturePayment>();
  const nonces = new Set<string>();
  let initializationResponseLost = false;
  let initializationRequestLost = false;
  let statusOverride: Partial<GoPayFixturePayment> = {};
  let statusFailure = false;
  const json = (data: unknown) =>
    new Response(JSON.stringify({ status: "OK", code: "0000", data }), {
      headers: { "content-type": "application/json" },
    });

  const transport = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    expect(url.origin).toBe("https://api.gopay.kg");
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    const rawBody = String(init?.body ?? "");
    const nonce = headers.get("GoPay-Nonce") ?? "";
    expect(headers.get("GoPay-Api-Key")).toBe(GOPAY_FIXTURE_API_KEY);
    expect(nonce.length).toBeGreaterThan(0);
    expect(nonce.length).toBeLessThanOrEqual(32);
    expect(nonces.has(nonce)).toBe(false);
    nonces.add(nonce);
    expect(headers.get("GoPay-Signature")).toBe(
      fixtureGoPaySignature(GOPAY_FIXTURE_API_SECRET, nonce, rawBody),
    );
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    if (url.pathname === "/v1/payments") {
      expect(body).not.toHaveProperty("testing_mode");
      expect(typeof body.order_id).toBe("string");
      expect(String(body.order_id).length).toBeLessThanOrEqual(32);
      expect(body.amount).toMatch(/^\d+\.\d{2}$/);
      expect(Number(body.amount)).toBeGreaterThan(0);
      if (initializationRequestLost)
        throw new Error("Synthetic connection loss before provider accepted payment");
      const paymentId = (payments.size + 1).toString(16).padStart(32, "0");
      const payment: GoPayFixturePayment = {
        payment_id: paymentId,
        order_id: String(body.order_id),
        amount: String(body.amount),
        status: "CREATED",
        testing_mode: true,
        checkout_url: `https://pay.gopay.kg/p/${paymentId}/`,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
        committed_at: null,
      };
      payments.set(payment.order_id, payment);
      if (initializationResponseLost)
        throw new Error("Synthetic connection loss after provider created payment");
      return json(payment);
    }
    expect(url.pathname).toBe("/v1/payments/query");
    if (statusFailure) throw new Error("Synthetic GoPay status outage");
    const payment = body.payment_id
      ? [...payments.values()].find((value) => value.payment_id === body.payment_id)
      : payments.get(String(body.order_id));
    if (!payment)
      return new Response(
        JSON.stringify({ status: "FAIL", code: "4041", message: "Payment not found" }),
        {
          headers: { "content-type": "application/json" },
        },
      );
    return json({ ...payment, ...statusOverride });
  });

  function commit(payment: GoPayFixturePayment) {
    payment.status = "COMMITTED";
    payment.committed_at = new Date().toISOString();
    return payment;
  }

  function notification(
    payment: GoPayFixturePayment,
    options?: {
      secret?: string;
      changes?: Partial<GoPayFixturePayment>;
      event?: string;
      rawBody?: string;
    },
  ) {
    const value = { ...payment, ...options?.changes };
    const rawBody =
      options?.rawBody ??
      JSON.stringify({
        event: options?.event ?? `payment.${value.status.toLowerCase()}`,
        data: {
          payment_id: value.payment_id,
          order_id: value.order_id,
          amount: value.amount,
          status: value.status,
          testing_mode: value.testing_mode,
          created_at: value.created_at,
          committed_at: value.committed_at,
          bank_op_date: null,
        },
        created_at: new Date().toISOString(),
      });
    const nonce = "synthetic-webhook-nonce";
    return new Request("http://localhost/api/billing/gopay/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "GoPay-Nonce": nonce,
        "GoPay-Signature": fixtureGoPaySignature(
          options?.secret ?? GOPAY_FIXTURE_WEBHOOK_SECRET,
          nonce,
          rawBody,
        ),
      },
      body: rawBody,
    });
  }

  return {
    transport,
    payments,
    commit,
    notification,
    loseInitializationResponse: () => {
      initializationResponseLost = true;
    },
    loseInitializationRequest: () => {
      initializationRequestLost = true;
    },
    recoverInitialization: () => {
      initializationRequestLost = false;
      initializationResponseLost = false;
    },
    overrideStatus: (value: Partial<GoPayFixturePayment>) => {
      statusOverride = value;
    },
    failStatus: () => {
      statusFailure = true;
    },
    recoverStatus: () => {
      statusFailure = false;
    },
  };
}
