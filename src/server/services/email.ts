import { getLogger } from "@/server/logging";
import { isProductionRuntime } from "@/server/config/runtime";

type EmailPayload = {
  to: string;
  subject: string;
  text: string;
  html: string;
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

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`emailProviderError:${response.status}:${body}`);
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
}) => {
  await sendEmail({
    to: input.email,
    subject: "Email verification",
    text: `Open this link to verify your account: ${input.verifyLink}`,
    html: `<p>Open this link to verify your account:</p><p><a href="${input.verifyLink}">${input.verifyLink}</a></p>`,
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
