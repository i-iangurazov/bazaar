import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const webhookSideEffects = vi.hoisted(() => ({
  handleResendEmailWebhook: vi.fn(async () => ({ processed: true })),
}));

vi.mock("@/server/services/emailMarketing", () => webhookSideEffects);

import { POST } from "@/app/api/email-marketing/resend-webhook/route";

const secretBytes = Buffer.from("route-test-secret");
const secret = `whsec_${secretBytes.toString("base64")}`;

const signedRequest = (payload: string, options?: { signaturePayload?: string }) => {
  const id = "msg_route_test";
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const signature = createHmac("sha256", secretBytes)
    .update(`${id}.${timestamp}.${options?.signaturePayload ?? payload}`)
    .digest("base64");
  return new Request("http://localhost/api/email-marketing/resend-webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${signature}`,
    },
    body: payload,
  });
};

describe("Resend webhook route", () => {
  beforeEach(() => {
    process.env.RESEND_WEBHOOK_SECRET = secret;
    webhookSideEffects.handleResendEmailWebhook.mockClear();
  });

  afterEach(() => {
    delete process.env.RESEND_WEBHOOK_SECRET;
  });

  it("verifies the exact raw body before parsing and forwards the signed event id", async () => {
    const payload = JSON.stringify({
      type: "email.delivered",
      data: { email_id: "email_123" },
    });
    const response = await POST(signedRequest(payload));

    expect(response.status).toBe(200);
    expect(webhookSideEffects.handleResendEmailWebhook).toHaveBeenCalledWith({
      event: { type: "email.delivered", data: { email_id: "email_123" } },
      webhookEventId: "msg_route_test",
    });
  });

  it("rejects a signature generated for a different body", async () => {
    const validBody = JSON.stringify({ type: "email.delivered" });
    const tamperedBody = JSON.stringify({ type: "email.bounced" });
    const response = await POST(
      signedRequest(tamperedBody, { signaturePayload: validBody }),
    );

    expect(response.status).toBe(400);
    expect(webhookSideEffects.handleResendEmailWebhook).not.toHaveBeenCalled();
  });
});
