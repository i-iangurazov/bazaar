import { createPrivateKey, createSign, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { assertExternalProviderCallAllowed } from "@/server/config/runtime";
import { listMobilePushTargets, MobilePlatform } from "@/server/services/mobileDevices";

type MobilePushPayload = {
  title: string;
  body: string;
  path: string;
  category: "ORDER" | "INTEGRATION" | "LOW_STOCK" | "SYSTEM";
};

const cleanPayload = (input: MobilePushPayload): MobilePushPayload => ({
  title: input.title.trim().slice(0, 100),
  body: input.body.trim().slice(0, 240),
  path:
    input.path.startsWith("/") && !input.path.startsWith("//")
      ? input.path.slice(0, 300)
      : "/dashboard",
  category: input.category,
});

const base64UrlJson = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

const resolveServiceAccount = () => {
  const encoded = process.env.FCM_SERVICE_ACCOUNT_JSON_BASE64?.trim();
  const raw = encoded
    ? Buffer.from(encoded, "base64").toString("utf8")
    : process.env.FCM_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) throw new Error("fcmCredentialsUnavailable");
  const parsed = JSON.parse(raw) as {
    client_email?: string;
    private_key?: string;
    project_id?: string;
    token_uri?: string;
  };
  if (!parsed.client_email || !parsed.private_key || !parsed.project_id) {
    throw new Error("fcmCredentialsInvalid");
  }
  return parsed as Required<Pick<typeof parsed, "client_email" | "private_key" | "project_id">> & {
    token_uri?: string;
  };
};

const signJwt = (
  header: { alg: "RS256" | "ES256"; [key: string]: unknown },
  claims: object,
  privateKey: string,
) => {
  const unsigned = `${base64UrlJson(header)}.${base64UrlJson(claims)}`;
  const signer = createSign("SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign({
    key: createPrivateKey(privateKey),
    dsaEncoding: header.alg === "ES256" ? "ieee-p1363" : "der",
  });
  return `${unsigned}.${signature.toString("base64url")}`;
};

let cachedFcmToken: { value: string; expiresAt: number } | null = null;
const getFcmAccessToken = async () => {
  if (cachedFcmToken && cachedFcmToken.expiresAt > Date.now() + 60_000) return cachedFcmToken.value;
  const account = resolveServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = account.token_uri || "https://oauth2.googleapis.com/token";
  const assertion = signJwt(
    { alg: "RS256", typ: "JWT" },
    {
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: tokenUri,
      iat: now,
      exp: now + 3600,
    },
    account.private_key,
  );
  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) throw new Error("fcmAuthenticationFailed");
  const body = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error("fcmAuthenticationFailed");
  cachedFcmToken = {
    value: body.access_token,
    expiresAt: Date.now() + Math.max(300, body.expires_in ?? 3600) * 1000,
  };
  return body.access_token;
};

const sendFcm = async (token: string, payload: MobilePushPayload) => {
  const account = resolveServiceAccount();
  const accessToken = await getFcmAccessToken();
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: payload.title, body: payload.body },
          data: { path: payload.path, category: payload.category },
          android: { priority: "HIGH", notification: { channel_id: "bazaar-important" } },
        },
      }),
    },
  );
  const responseBody = response.ok
    ? null
    : ((await response.json().catch(() => null)) as {
        error?: { details?: Array<{ errorCode?: string }> };
      } | null);
  const invalid =
    response.status === 404 ||
    Boolean(responseBody?.error?.details?.some((detail) => detail.errorCode === "UNREGISTERED"));
  return { ok: response.ok, invalid };
};

let cachedApnsJwt: { value: string; expiresAt: number } | null = null;
const getApnsJwt = () => {
  if (cachedApnsJwt && cachedApnsJwt.expiresAt > Date.now() + 60_000) return cachedApnsJwt.value;
  const teamId = process.env.APNS_TEAM_ID?.trim();
  const keyId = process.env.APNS_KEY_ID?.trim();
  const privateKey = process.env.APNS_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!teamId || !keyId || !privateKey) throw new Error("apnsCredentialsUnavailable");
  const now = Math.floor(Date.now() / 1000);
  const value = signJwt({ alg: "ES256", kid: keyId }, { iss: teamId, iat: now }, privateKey);
  cachedApnsJwt = { value, expiresAt: Date.now() + 45 * 60_000 };
  return value;
};

const sendApns = async (token: string, payload: MobilePushPayload) => {
  const bundleId = process.env.APNS_BUNDLE_ID?.trim() || "kg.bazaar.app";
  const host =
    process.env.APNS_ENVIRONMENT === "sandbox"
      ? "https://api.sandbox.push.apple.com"
      : "https://api.push.apple.com";
  const response = await fetch(`${host}/3/device/${encodeURIComponent(token)}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${getApnsJwt()}`,
      "apns-topic": bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-id": randomUUID(),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      aps: { alert: { title: payload.title, body: payload.body }, sound: "default" },
      path: payload.path,
      category: payload.category,
    }),
  });
  const responseBody = response.ok
    ? null
    : ((await response.json().catch(() => null)) as { reason?: string } | null);
  return {
    ok: response.ok,
    invalid: response.status === 410 || responseBody?.reason === "BadDeviceToken",
  };
};

export const sendMobilePushToUsers = async (
  prisma: PrismaClient,
  input: {
    organizationId: string;
    userIds: string[];
    payload: MobilePushPayload;
  },
) => {
  const mode = process.env.MOBILE_PUSH_MODE?.trim().toLowerCase() || "disabled";
  const targets = await listMobilePushTargets(prisma, {
    organizationId: input.organizationId,
    userIds: [...new Set(input.userIds)],
  });
  if (mode === "disabled")
    return { status: "disabled" as const, targeted: targets.length, sent: 0 };
  if (mode === "mock")
    return { status: "mocked" as const, targeted: targets.length, sent: targets.length };
  if (mode !== "live") throw new Error("mobilePushModeInvalid");
  assertExternalProviderCallAllowed("mobile-push");

  const payload = cleanPayload(input.payload);
  let sent = 0;
  const invalidIds: string[] = [];
  for (const target of targets) {
    const result =
      target.platform === MobilePlatform.IOS
        ? await sendApns(target.token, payload)
        : await sendFcm(target.token, payload);
    if (result.ok) sent += 1;
    if (result.invalid) invalidIds.push(target.id);
  }
  if (invalidIds.length) {
    await prisma.mobileDevice.updateMany({
      where: { id: { in: invalidIds }, organizationId: input.organizationId },
      data: { enabled: false },
    });
  }
  return {
    status: "completed" as const,
    targeted: targets.length,
    sent,
    invalid: invalidIds.length,
  };
};
