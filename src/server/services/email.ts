import { getLogger } from "@/server/logging";
import { isProductionRuntime } from "@/server/config/runtime";
import { defaultLocale, normalizeLocale, type Locale } from "@/lib/locales";

export type EmailTag = {
  name: string;
  value: string;
};

export type EmailPayload = {
  to: string;
  subject: string;
  text: string;
  html: string;
  from?: string;
  replyTo?: string | null;
  tags?: EmailTag[];
  idempotencyKey?: string;
};

export type EmailSendResult = {
  provider: "resend" | "log";
  id: string | null;
};

export type ResendDnsRecord = {
  record?: string | null;
  name?: string | null;
  type?: string | null;
  ttl?: string | number | null;
  status?: string | null;
  value?: string | null;
  priority?: number | null;
};

export type ResendDomainResponse = {
  id: string;
  name: string;
  status: string;
  records?: ResendDnsRecord[];
  created_at?: string;
};

type EmailLocale = Locale;

export class EmailProviderError extends Error {
  public readonly provider: "resend";
  public readonly status: number;
  public readonly responseText: string;
  public readonly providerMessage: string | null;

  constructor(input: {
    provider: "resend";
    status: number;
    responseText: string;
    providerMessage?: string | null;
  }) {
    super(input.providerMessage ?? `emailProviderError:${input.status}`);
    this.name = "EmailProviderError";
    this.provider = input.provider;
    this.status = input.status;
    this.responseText = input.responseText;
    this.providerMessage = input.providerMessage ?? null;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export const MARKETING_EMAIL_FROM = "no-reply@bazaar.kg";

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

const getEmailLogoUrl = () => {
  const explicit = (process.env.EMAIL_LOGO_URL ?? "").trim();
  if (explicit) {
    return explicit;
  }
  const baseUrl = trimTrailingSlash((process.env.NEXTAUTH_URL ?? "").trim());
  if (!baseUrl) {
    return null;
  }
  return `${baseUrl}/brand/logo.png`;
};

const getEmailProvider = () => {
  const configured = (process.env.EMAIL_PROVIDER ?? "").trim().toLowerCase();
  if (configured) {
    return configured;
  }
  if (process.env.RESEND_API_KEY) {
    return "resend";
  }
  return "log";
};

const allowLogEmailInProduction = () => {
  const value = process.env.ALLOW_LOG_EMAIL_IN_PRODUCTION ?? "";
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

export const assertEmailConfigured = () => {
  if (!isProductionRuntime()) {
    return;
  }
  const provider = getEmailProvider();
  if (provider === "log" && !allowLogEmailInProduction()) {
    throw new Error("emailProviderRequiredInProduction");
  }
  if (provider === "resend" && (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM)) {
    throw new Error("emailProviderNotConfigured");
  }
};

const resendFetch = async <T>(path: string, init: RequestInit): Promise<T> => {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("emailProviderNotConfigured");
  }
  const response = await fetch(`https://api.resend.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body: unknown = {};
  if (text) {
    try {
      body = JSON.parse(text) as T;
    } catch {
      body = {};
    }
  }
  if (!response.ok) {
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const nestedError =
      record.error && typeof record.error === "object"
        ? (record.error as Record<string, unknown>)
        : null;
    const providerMessage =
      typeof record.message === "string"
        ? record.message
        : typeof nestedError?.message === "string"
          ? nestedError.message
          : null;
    throw new EmailProviderError({
      provider: "resend",
      status: response.status,
      responseText: text,
      providerMessage,
    });
  }
  return body as T;
};

export const createResendDomain = async (domain: string) =>
  resendFetch<ResendDomainResponse>("/domains", {
    method: "POST",
    body: JSON.stringify({ name: domain }),
  });

export const retrieveResendDomain = async (domainId: string) =>
  resendFetch<ResendDomainResponse>(`/domains/${encodeURIComponent(domainId)}`, {
    method: "GET",
  });

export const verifyResendDomain = async (domainId: string) =>
  resendFetch<{ object?: string; id: string }>(
    `/domains/${encodeURIComponent(domainId)}/verify`,
    {
      method: "POST",
    },
  );

export const listResendDomains = async () =>
  resendFetch<{ data?: ResendDomainResponse[] } | ResendDomainResponse[]>("/domains", {
    method: "GET",
  });

const sendWithResend = async (payload: EmailPayload): Promise<EmailSendResult> => {
  const from = payload.from ?? process.env.EMAIL_FROM;
  if (!process.env.RESEND_API_KEY || !from) {
    throw new Error("emailProviderNotConfigured");
  }
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        ...(payload.idempotencyKey ? { "Idempotency-Key": payload.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from,
        to: [payload.to],
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        ...(payload.replyTo ? { reply_to: payload.replyTo } : {}),
        ...(payload.tags?.length ? { tags: payload.tags } : {}),
      }),
    });

    if (response.ok) {
      const body = (await response.json().catch(() => ({}))) as { id?: string };
      return { provider: "resend", id: body.id ?? null };
    }

    const body = await response.text();
    const canRetry = response.status === 429 && attempt < maxAttempts;
    if (!canRetry) {
      throw new Error(`emailProviderError:${response.status}:${body}`);
    }

    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterSeconds = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : Number.NaN;
    const retryDelayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : 1000 * attempt;
    await sleep(retryDelayMs);
  }
  throw new Error("emailProviderError");
};

const sendWithResendBatch = async (
  payloads: EmailPayload[],
  idempotencyKey?: string,
): Promise<EmailSendResult[]> => {
  if (!payloads.length) {
    return [];
  }
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("emailProviderNotConfigured");
  }
  const response = await fetch("https://api.resend.com/emails/batch", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify(
      payloads.map((payload) => {
        const from = payload.from ?? process.env.EMAIL_FROM;
        if (!from) {
          throw new Error("emailProviderNotConfigured");
        }
        return {
          from,
          to: [payload.to],
          subject: payload.subject,
          html: payload.html,
          text: payload.text,
          ...(payload.replyTo ? { reply_to: payload.replyTo } : {}),
          ...(payload.tags?.length ? { tags: payload.tags } : {}),
        };
      }),
    ),
  });

  if (response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      data?: Array<{ id?: string }>;
    };
    return payloads.map((_payload, index) => ({
      provider: "resend" as const,
      id: body.data?.[index]?.id ?? null,
    }));
  }

  const body = await response.text();
  throw new Error(`emailProviderError:${response.status}:${body}`);
};

const sendEmail = async (payload: EmailPayload): Promise<EmailSendResult> => {
  const logger = getLogger();
  const provider = getEmailProvider();

  if (provider === "resend") {
    return sendWithResend(payload);
  }

  if (isProductionRuntime() && !allowLogEmailInProduction()) {
    throw new Error("emailProviderRequiredInProduction");
  }

  logger.info(
    {
      email: payload.to,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
      from: payload.from ?? process.env.EMAIL_FROM ?? null,
      replyTo: payload.replyTo ?? null,
      provider: "log",
    },
    "email delivery fallback"
  );
  return { provider: "log", id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 10)}` };
};

export const sendTransactionalEmail = sendEmail;

export const sendEmailBatch = async (
  payloads: EmailPayload[],
  options?: { idempotencyKey?: string },
): Promise<EmailSendResult[]> => {
  const logger = getLogger();
  const provider = getEmailProvider();
  if (!payloads.length) {
    return [];
  }
  if (provider === "resend") {
    return sendWithResendBatch(payloads, options?.idempotencyKey);
  }
  if (isProductionRuntime() && !allowLogEmailInProduction()) {
    throw new Error("emailProviderRequiredInProduction");
  }
  logger.info(
    {
      count: payloads.length,
      recipients: payloads.map((payload) => payload.to),
      subjects: Array.from(new Set(payloads.map((payload) => payload.subject))),
      provider: "log",
    },
    "email batch delivery fallback",
  );
  return payloads.map((_payload, index) => ({
    provider: "log",
    id: `log_batch_${Date.now()}_${index}`,
  }));
};

export const getMarketingEmailConfiguration = () => {
  const provider = getEmailProvider();
  const from = (process.env.EMAIL_FROM ?? "").trim();
  const hasRequiredFrom = from === MARKETING_EMAIL_FROM;
  const hasProvider =
    provider === "log"
      ? !isProductionRuntime() || allowLogEmailInProduction()
      : provider === "resend"
        ? Boolean(process.env.RESEND_API_KEY)
        : false;
  return {
    provider,
    from,
    requiredFrom: MARKETING_EMAIL_FROM,
    hasRequiredFrom,
    hasProvider,
    ready: hasProvider,
  };
};

export const sendMarketingEmail = async (
  payload: Omit<EmailPayload, "from"> & { from?: string },
) => {
  const config = getMarketingEmailConfiguration();
  const from = payload.from ?? MARKETING_EMAIL_FROM;
  if (from === MARKETING_EMAIL_FROM && !config.ready) {
    throw new Error("emailMarketingNotConfigured");
  }
  return sendEmail({
    ...payload,
    from,
  });
};

export const sendVerificationEmail = async (input: {
  email: string;
  verifyLink: string;
  locale?: EmailLocale | null;
  expiresInMinutes?: number;
}) => {
  const logoUrl = getEmailLogoUrl();
  const locale: EmailLocale = normalizeLocale(input.locale) ?? defaultLocale;
  const expiresInHours = Math.max(1, Math.round((input.expiresInMinutes ?? 60) / 60));
  const copies: Record<
    EmailLocale,
    {
      subject: string;
      greeting: string;
      intro: string;
      cta: string;
      expires: string;
      fallback: string;
      ignore: string;
    }
  > = {
    ru: {
      subject: "Подтвердите email для аккаунта BAZAAR",
      greeting: "Здравствуйте!",
      intro: "Спасибо за регистрацию в системе BAZAAR.",
      cta: "Подтвердить email",
      expires: `Ссылка действительна примерно ${expiresInHours} ч.`,
      fallback: "Если кнопка не работает, скопируйте ссылку в браузер:",
      ignore: "Если вы не запрашивали регистрацию, просто проигнорируйте это письмо.",
    },
    kg: {
      subject: "BAZAAR аккаунтуңуздун email дарегин ырастаңыз",
      greeting: "Саламатсызбы!",
      intro: "BAZAAR системасына катталганыңыз үчүн рахмат.",
      cta: "Email дарегин ырастоо",
      expires: `Шилтеме болжол менен ${expiresInHours} саатка жарактуу.`,
      fallback: "Эгер баскыч иштебесе, төмөнкү шилтемени браузерге көчүрүңүз:",
      ignore: "Эгер бул аракетти сиз жасабасаңыз, бул катты жөн гана четке кагыңыз.",
    },
    en: {
      subject: "Confirm your email for BAZAAR",
      greeting: "Hello!",
      intro: "Thanks for registering for BAZAAR.",
      cta: "Confirm email",
      expires: `This link is valid for about ${expiresInHours} hour(s).`,
      fallback: "If the button does not work, copy this link into your browser:",
      ignore: "If you did not request this registration, you can ignore this email.",
    },
  };
  const copy = copies[locale];

  await sendEmail({
    to: input.email,
    subject: copy.subject,
    text: `${copy.greeting}\n\n${copy.intro}\n${copy.expires}\n\n${copy.cta}: ${input.verifyLink}\n\n${copy.ignore}`,
    html: `
      <div style="font-family:Inter,Segoe UI,Roboto,Arial,sans-serif;background:#f5f7fb;padding:24px;">
        <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;">
          ${
            logoUrl
              ? `<img src="${logoUrl}" alt="BAZAAR" width="180" height="48" style="display:block;height:auto;width:180px;max-width:100%;margin:0 0 12px;" />`
              : '<h1 style="margin:0 0 8px;font-size:20px;line-height:1.3;color:#111827;">BAZAAR</h1>'
          }
          <p style="margin:0 0 8px;color:#111827;">${copy.greeting}</p>
          <p style="margin:0 0 16px;color:#374151;">${copy.intro}</p>
          <p style="margin:0 0 16px;color:#374151;">${copy.expires}</p>
          <a href="${input.verifyLink}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600;">
            ${copy.cta}
          </a>
          <p style="margin:16px 0 6px;color:#6b7280;font-size:13px;">${copy.fallback}</p>
          <p style="margin:0 0 16px;color:#6b7280;font-size:13px;word-break:break-all;">${input.verifyLink}</p>
          <p style="margin:0;color:#6b7280;font-size:13px;">${copy.ignore}</p>
        </div>
      </div>
    `,
  });
};

export const sendResetEmail = async (input: {
  email: string;
  resetLink: string;
}) => {
  await sendEmail({
    to: input.email,
    subject: "Password reset",
    text: `Open this link to reset your password: ${input.resetLink}`,
    html: `<p>Open this link to reset your password:</p><p><a href="${input.resetLink}">${input.resetLink}</a></p>`,
  });
};

export const sendInviteEmail = async (input: {
  email: string;
  inviteLink: string;
}) => {
  await sendEmail({
    to: input.email,
    subject: "Organization invite",
    text: `Open this link to accept your invite: ${input.inviteLink}`,
    html: `<p>Open this link to accept your invite:</p><p><a href="${input.inviteLink}">${input.inviteLink}</a></p>`,
  });
};
