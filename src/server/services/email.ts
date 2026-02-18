import { getLogger } from "@/server/logging";
import { isProductionRuntime } from "@/server/config/runtime";

type EmailPayload = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

type EmailLocale = "ru" | "kg";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

const sendWithResend = async (payload: EmailPayload) => {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    throw new Error("emailProviderNotConfigured");
  }
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [payload.to],
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
      }),
    });

    if (response.ok) {
      return;
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
};

const sendEmail = async (payload: EmailPayload) => {
  const logger = getLogger();
  const provider = getEmailProvider();

  if (provider === "resend") {
    await sendWithResend(payload);
    return;
  }

  if (isProductionRuntime() && !allowLogEmailInProduction()) {
    throw new Error("emailProviderRequiredInProduction");
  }

  logger.info(
    { email: payload.to, subject: payload.subject, text: payload.text, html: payload.html, provider: "log" },
    "email delivery fallback"
  );
};

export const sendVerificationEmail = async (input: {
  email: string;
  verifyLink: string;
  locale?: EmailLocale | null;
  expiresInMinutes?: number;
}) => {
  const logoUrl = getEmailLogoUrl();
  const locale: EmailLocale = input.locale === "kg" ? "kg" : "ru";
  const expiresInHours = Math.max(1, Math.round((input.expiresInMinutes ?? 60) / 60));
  const copy =
    locale === "kg"
      ? {
          subject: "BAZAAR аккаунтуңуздун email дарегин ырастаңыз",
          greeting: "Саламатсызбы!",
          intro: "BAZAAR системасына катталганыңыз үчүн рахмат.",
          cta: "Email дарегин ырастоо",
          expires: `Шилтеме болжол менен ${expiresInHours} саатка жарактуу.`,
          fallback: "Эгер баскыч иштебесе, төмөнкү шилтемени браузерге көчүрүңүз:",
          ignore: "Эгер бул аракетти сиз жасабасаңыз, бул катты жөн гана четке кагыңыз.",
        }
      : {
          subject: "Подтвердите email для аккаунта BAZAAR",
          greeting: "Здравствуйте!",
          intro: "Спасибо за регистрацию в системе BAZAAR.",
          cta: "Подтвердить email",
          expires: `Ссылка действительна примерно ${expiresInHours} ч.`,
          fallback: "Если кнопка не работает, скопируйте ссылку в браузер:",
          ignore: "Если вы не запрашивали регистрацию, просто проигнорируйте это письмо.",
        };

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
          <a href="${input.verifyLink}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600;">
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
