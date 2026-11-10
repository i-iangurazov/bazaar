import { createHash } from "node:crypto";
import { z } from "zod";

const record = z.record(z.string(), z.unknown());
const str = (value: unknown, max = 256) => (typeof value === "string" ? value.slice(0, max) : "");
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const list = (value: unknown) => (Array.isArray(value) ? value : []);
export type WhatsAppNormalizedEvent = {
  key: string;
  kind: "MESSAGE" | "STATUS" | "ECHO" | "ACCOUNT";
  id: string;
  at: Date;
  identity?: string;
  phone?: string;
  bsuid?: string;
  country?: string;
  name?: string;
  messageKind?: string;
  body?: string;
  status?: string;
  media?: { id: string; mime: string; url?: string };
  opaqueMessageId?: string;
};

function eventTime(value: unknown, receivedAt: Date) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return receivedAt;
  const date = new Date(raw < 1e12 ? raw * 1000 : raw);
  if (!Number.isFinite(date.getTime()) || date.getTime() > receivedAt.getTime() + 300000)
    throw new Error("Invalid webhook timestamp");
  return date;
}
export function allowedWhatsAppMediaUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      ["filemanager.gupshup.io", "media.gupshup.io"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

/** V3 passthrough only; the configured app must match before any tenant data is written. */
export function normalizeWhatsAppEvents(
  body: unknown,
  appId: string,
  receivedAt = new Date(),
): WhatsAppNormalizedEvent[] {
  const root = record.parse(body);
  if (root.gs_app_id !== appId || root.object !== "whatsapp_business_account")
    throw new Error("Webhook app mismatch");
  const result: WhatsAppNormalizedEvent[] = [];
  for (const rawEntry of list(root.entry)) {
    const entry = object(rawEntry);
    for (const rawChange of list(entry.changes)) {
      const change = object(rawChange),
        value = object(change.value),
        field = str(change.field);
      if (["history", "smb_app_state_sync", "contacts", "history_sync"].includes(field)) continue;
      if (field === "account-event" || field === "account_update") {
        const status = str(object(value.payload).status || value.event || value.status, 80);
        if (status)
          result.push({
            key: hash([appId, "account", status, entry.time]),
            kind: "ACCOUNT",
            id: status,
            at: eventTime(entry.time, receivedAt),
            status,
          });
      }
      for (const rawStatus of list(value.statuses)) {
        const status = object(rawStatus),
          id = str(status.gs_id || status.id),
          state = str(status.status).toUpperCase();
        if (id && ["SENT", "DELIVERED", "READ", "FAILED", "ENQUEUED"].includes(state))
          result.push({
            key: hash([appId, "status", id, state]),
            kind: "STATUS",
            id,
            status: state,
            at: eventTime(status.timestamp, receivedAt),
            opaqueMessageId: str(status.biz_opaque_callback_data).startsWith("bazaar-wa:")
              ? str(status.biz_opaque_callback_data).slice(10)
              : undefined,
          });
      }
      const echo = ["smb_message_echoes", "message_echoes"].includes(field);
      const messages = echo
        ? list(value.message_echoes ?? value.messages)
        : field === "messages"
          ? list(value.messages)
          : [];
      for (const rawMessage of messages) {
        const m = object(rawMessage),
          id = str(m.id);
        if (!id) continue;
        if (!Number.isFinite(Number(m.timestamp)) || Number(m.timestamp) <= 0)
          throw new Error("Missing message timestamp");
        const contacts = list(value.contacts).map(object);
        const from = str(echo ? m.to : m.from);
        const contact = contacts.find((c) => [c.wa_id, c.user_id].includes(from)) ?? {};
        const profile = object(contact.profile);
        const bsuid =
          str(contact.user_id || (echo ? m.to_user_id : m.from_user_id || m.user_id)) ||
          (!/^\+?\d{6,16}$/.test(from) ? from : "");
        const phone =
          str(contact.wa_id) || (/^\+?\d{6,16}$/.test(from) ? from.replace(/^\+/, "") : "");
        const identity = bsuid || phone;
        if (!identity || identity.length > 256) continue;
        const type = str(m.type, 30).toUpperCase(),
          media = object(m[type.toLowerCase()]);
        const url = str(media.url, 4096);
        const mediaId = str(media.id);
        result.push({
          key: hash([appId, echo ? "echo" : "inbound", id]),
          kind: echo ? "ECHO" : "MESSAGE",
          id,
          at: eventTime(m.timestamp, receivedAt),
          identity,
          phone: phone || undefined,
          bsuid: bsuid || undefined,
          country:
            str(profile.country_code || m.country_code || contact.country_code, 8) || undefined,
          name: str(profile.name, 120) || undefined,
          messageKind: ["TEXT", "IMAGE", "AUDIO", "DOCUMENT", "VIDEO", "STICKER"].includes(type)
            ? type
            : "OTHER",
          body: str(
            object(m.text).body ||
              media.caption ||
              object(m.button).text ||
              object(object(m.interactive).button_reply).title,
            8000,
          ),
          ...(mediaId
            ? {
                media: {
                  id: mediaId,
                  mime: str(media.mime_type, 100),
                  ...(allowedWhatsAppMediaUrl(url) ? { url } : {}),
                },
              }
            : {}),
        });
      }
      if (result.length > 100) throw new Error("Too many webhook events");
    }
  }
  return result;
}
function hash(parts: unknown[]) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}
