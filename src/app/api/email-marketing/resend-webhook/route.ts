import { createHmac, timingSafeEqual } from "node:crypto";

import { handleResendEmailWebhook } from "@/server/services/emailMarketing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

const getWebhookSecret = () => (process.env.RESEND_WEBHOOK_SECRET ?? "").trim();

const decodeSvixSecret = (secret: string) => {
  const normalized = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  const decoded = Buffer.from(normalized, "base64");
  return decoded.length ? decoded : Buffer.from(normalized, "utf8");
};

const secureCompare = (actual: string, expected: string) => {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
};

const verifyResendSignature = (input: {
  payload: string;
  headers: Headers;
  secret: string;
}) => {
  const id = input.headers.get("svix-id");
  const timestamp = input.headers.get("svix-timestamp");
  const signature = input.headers.get("svix-signature");
  if (!id || !timestamp || !signature) {
    return false;
  }

  const timestampSeconds = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(timestampSeconds)) {
    return false;
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > SIGNATURE_TOLERANCE_SECONDS) {
    return false;
  }

  const signedContent = `${id}.${timestamp}.${input.payload}`;
  const expected = createHmac("sha256", decodeSvixSecret(input.secret))
    .update(signedContent)
    .digest("base64");

  return signature
    .split(" ")
    .some((part) => {
      const [version, value] = part.split(",");
      return version === "v1" && Boolean(value) && secureCompare(value, expected);
    });
};

export const POST = async (request: Request) => {
  const secret = getWebhookSecret();
  if (!secret) {
    return new Response("resend_webhook_not_configured", { status: 500 });
  }

  const payload = await request.text();
  if (!verifyResendSignature({ payload, headers: request.headers, secret })) {
    return new Response("invalid_signature", { status: 400 });
  }

  let event: unknown;
  try {
    event = JSON.parse(payload);
  } catch {
    return new Response("invalid_payload", { status: 400 });
  }

  const result = await handleResendEmailWebhook({
    event: (event && typeof event === "object" ? event : {}) as Parameters<
      typeof handleResendEmailWebhook
    >[0]["event"],
    webhookEventId: request.headers.get("svix-id"),
  });

  return Response.json(result);
};
