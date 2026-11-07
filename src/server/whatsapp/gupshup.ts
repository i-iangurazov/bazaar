import { z } from "zod";
import { AppError } from "@/server/services/errors";
import { whatsappConfig } from "./config";

const BASE = "https://partner.gupshup.io/partner";
const appIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{6,100}$/);
export class WhatsAppUnknownSend extends Error {
  constructor() {
    super("whatsappDeliveryUnknown");
  }
}

async function providerJson(
  path: string,
  token: string,
  init: RequestInit = {},
  header = "Authorization",
) {
  if (process.env.HARDENING_EXTERNAL_PROVIDER_MODE === "disabled")
    throw new AppError("whatsappNotReady", "CONFLICT", 409);
  try {
    const config = whatsappConfig();
    // Universal Tokens use Bearer authentication on all partner endpoints;
    // app-scoped legacy tokens retain the documented raw Authorization header.
    const universal = token === config.partnerToken && Boolean(token);
    const headers = new Headers(init.headers);
    headers.set(universal ? "Authorization" : header, universal ? `Bearer ${token}` : token);
    const response = await fetch(BASE + path, {
      ...init,
      cache: "no-store",
      redirect: "error",
      headers,
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      // No response text or secret-bearing URL goes into an error/log.
      if (response.status === 401 || response.status === 403)
        throw new AppError("whatsappReconnectRequired", "CONFLICT", 409);
      if (response.status === 429)
        throw new AppError("whatsappProviderBusy", "TOO_MANY_REQUESTS", 429);
      throw new AppError("whatsappProviderUnavailable", "INTERNAL_SERVER_ERROR", 502);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("body");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 262144) {
        await reader.cancel();
        throw new Error("size");
      }
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("whatsappProviderUnavailable", "INTERNAL_SERVER_ERROR", 502);
  }
}

export function allowedWhatsAppOnboardingUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      ["gupshup.io", "gupshup.ai"].some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      )
    );
  } catch {
    return false;
  }
}

export async function createGupshupApp(name: string) {
  const value = await providerJson(
    "/app",
    whatsappConfig().partnerToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ name, templateMessaging: "false", disableOptinPrefUrl: "false" }),
    },
    "token",
  );
  return z.object({ appId: appIdSchema }).parse(value).appId;
}
export async function gupshupAppDetails(appId: string) {
  const value = await providerJson(
    `/app/${appIdSchema.parse(appId)}/details`,
    whatsappConfig().partnerToken,
    {},
    "token",
  );
  return z
    .object({
      appDetails: z.object({
        id: appIdSchema,
        name: z.string(),
        live: z.boolean(),
        stopped: z.boolean().optional(),
        phone: z.string().optional(),
        phoneNumberId: z.string().optional(),
        wabaId: z.string().optional(),
      }),
    })
    .parse(value).appDetails;
}
export async function gupshupAppToken(appId: string) {
  const value = await providerJson(
    `/app/${appIdSchema.parse(appId)}/token`,
    whatsappConfig().partnerToken,
  );
  const parsed = z
    .object({ token: z.object({ token: z.string().min(16).max(4096), active: z.boolean() }) })
    .parse(value);
  if (!parsed.token.active) throw new AppError("whatsappReconnectRequired", "CONFLICT", 409);
  return parsed.token.token;
}
export async function gupshupOnboardingLink(appId: string, user: string, locale: string) {
  const query = new URLSearchParams({
    regenerate: "false",
    user,
    lang: locale === "ru" ? "Russian" : "English",
  });
  const value = await providerJson(
    `/app/${appIdSchema.parse(appId)}/onboarding/embed/link?${query}`,
    whatsappConfig().partnerToken,
    {},
    "token",
  );
  const parsed = z
    .object({ status: z.literal("success"), link: z.string().max(8192) })
    .parse(value);
  if (!allowedWhatsAppOnboardingUrl(parsed.link))
    throw new AppError("whatsappProviderUnavailable", "INTERNAL_SERVER_ERROR", 502);
  return parsed.link;
}
export async function configureGupshupWebhook(
  appId: string,
  appToken: string,
  connectionId: string,
  secret: string,
) {
  const config = whatsappConfig();
  const path = `/app/${appIdSchema.parse(appId)}/subscription`;
  const subscriptions = z
    .object({
      status: z.literal("success"),
      subscriptions: z.array(z.object({ id: z.union([z.string(), z.number()]), tag: z.string() })),
    })
    .parse(await providerJson(path, appToken)).subscriptions;
  const existing = subscriptions.find((item) => item.tag === "BazaarWhatsAppAI");
  const value = await providerJson(
    existing ? `${path}/${encodeURIComponent(String(existing.id))}` : path,
    appToken,
    {
      method: existing ? "PUT" : "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        modes: "ALL,SENT,DELIVERED,READ,FAILED,BILLING,ACCOUNT,COEXISTENCE,DELETED",
        tag: "BazaarWhatsAppAI",
        version: "3",
        showOnUI: "false",
        url: `${config.origin}/api/integrations/whatsapp/${encodeURIComponent(connectionId)}`,
        active: "true",
        meta: JSON.stringify({ "X-Gupshup-Webhook-Secret": secret }),
      }),
    },
  );
  return z
    .object({
      status: z.literal("success"),
      subscription: z.object({ id: z.union([z.string(), z.number()]), active: z.literal(true) }),
    })
    .parse(value).subscription;
}
export async function gupshupWallet(appId: string, token: string) {
  const value = await providerJson(`/app/${appIdSchema.parse(appId)}/wallet/balance`, token);
  return z
    .object({
      walletResponse: z.object({
        currency: z.literal("USD"),
        currentBalance: z.number().finite(),
        overDraftLimit: z.number().finite().optional(),
      }),
    })
    .parse(value).walletResponse;
}

export async function sendGupshupText(input: {
  appId: string;
  token: string;
  phone: string | null;
  bsuid: string | null;
  body: string;
  messageId: string;
}) {
  if (!input.body.trim() || input.body.length > 4096 || (!input.phone && !input.bsuid))
    throw new AppError("whatsappInvalidMessage", "BAD_REQUEST", 400);
  try {
    const value = await providerJson(
      `/app/${appIdSchema.parse(input.appId)}/v3/message`,
      input.token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          ...(input.phone ? { to: input.phone.replace(/^\+/, "") } : { recipient: input.bsuid }),
          type: "text",
          text: { body: input.body, preview_url: false },
          biz_opaque_callback_data: `bazaar-wa:${input.messageId}`,
        }),
      },
    );
    return z
      .object({ messages: z.array(z.object({ id: z.string().min(1).max(256) })).length(1) })
      .parse(value).messages[0].id;
  } catch (error) {
    if (
      error instanceof AppError &&
      ["whatsappReconnectRequired", "whatsappProviderBusy"].includes(error.message)
    )
      throw error;
    // The request may already have reached Meta. Never automatically send it again.
    throw new WhatsAppUnknownSend();
  }
}
