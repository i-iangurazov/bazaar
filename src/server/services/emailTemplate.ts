import { defaultLocale, normalizeLocale } from "@/lib/locales";

export type EmailTheme = {
  backgroundColor?: string;
  contentBackgroundColor?: string;
  textColor?: string;
  mutedTextColor?: string;
  borderColor?: string;
  brandColor?: string;
  fontFamily?: string;
};

export type BrandedEmailOptions = {
  locale?: string | null;
  title?: string;
  preheader?: string;
  contentHtml: string;
  footerHtml?: string;
  brandName?: string;
  logoUrl?: string | null;
  theme?: EmailTheme;
  contentPadding?: boolean;
};

export const escapeEmailHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );

export const getEmailLogoUrl = () => {
  const explicit = (process.env.EMAIL_LOGO_URL ?? "").trim();
  if (explicit) return explicit;
  const baseUrl = (process.env.NEXTAUTH_URL ?? "").trim().replace(/\/+$/, "");
  return baseUrl ? `${baseUrl}/brand/logo.png` : null;
};

/** Callers supply application-generated URLs; both the attribute and label are escaped. */
export const renderEmailButton = ({ href, label }: { href: string; label: string }) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="max-width:100%;border-collapse:separate;margin:0;"><tr><td bgcolor="#1d4ed8" style="background-color:#1d4ed8;border-radius:8px;text-align:center;overflow-wrap:anywhere;word-wrap:break-word;"><a href="${escapeEmailHtml(href)}" style="display:inline-block;box-sizing:border-box;max-width:100%;border:1px solid #1d4ed8;border-radius:8px;padding:10px 16px;font-family:Inter,'Segoe UI',Roboto,Arial,sans-serif;font-size:14px;font-weight:600;line-height:22px;color:#ffffff;text-decoration:none;overflow-wrap:anywhere;word-wrap:break-word;">${escapeEmailHtml(label)}</a></td></tr></table>`;

const emailColor = (value: string | undefined, fallback: string) =>
  value && /^(?:#[a-f\d]{3,8}|[a-z]+|(?:rgb|hsl)a?\([\d.,% /-]+\))$/i.test(value)
    ? value
    : fallback;

/**
 * Shared generation-time frame. contentHtml/footerHtml are trusted, prepared HTML.
 * Never apply this to a persisted outbox body again when sending or retrying it.
 * Empty brandName with logoUrl:null suppresses the header for a merchant-owned header.
 */
export function renderBrandedEmail(input: BrandedEmailOptions): string {
  const locale = normalizeLocale(input.locale) ?? defaultLocale;
  const language = locale === "kg" ? "ky" : locale;
  const theme = input.theme ?? {};
  const background = emailColor(theme.backgroundColor, "#f5f7fb");
  const contentBackground = emailColor(theme.contentBackgroundColor, "#ffffff");
  const text = emailColor(theme.textColor, "#111827");
  const muted = emailColor(theme.mutedTextColor, "#6b7280");
  const border = emailColor(theme.borderColor, "#e5e7eb");
  const brand = emailColor(theme.brandColor, "#1d4ed8");
  const font =
    theme.fontFamily && /^[\w\s,'".-]+$/.test(theme.fontFamily)
      ? theme.fontFamily
      : "Inter,'Segoe UI',Roboto,Arial,sans-serif";
  const fontStyle = escapeEmailHtml(font);
  const brandName = input.brandName ?? "BAZAAR";
  const logoUrl = input.logoUrl === undefined ? getEmailLogoUrl() : input.logoUrl;
  const hasHeader = Boolean(logoUrl || brandName || input.title);
  const header = hasHeader
    ? `<tr><td style="padding:24px 24px 16px;font-family:${fontStyle};color:${text};overflow-wrap:anywhere;word-wrap:break-word;">${
        logoUrl
          ? `<img src="${escapeEmailHtml(logoUrl)}" alt="${escapeEmailHtml(brandName)}" width="180" height="48" border="0" style="display:block;width:180px;max-width:100%;height:auto;margin:0;border:0;" />`
          : brandName
            ? `<p style="margin:0;font-size:20px;font-weight:700;line-height:26px;color:${brand};">${escapeEmailHtml(brandName)}</p>`
            : ""
      }${input.title ? `<h1 style="margin:${logoUrl || brandName ? "16px" : "0"} 0 0;font-size:20px;font-weight:600;line-height:28px;color:${text};">${escapeEmailHtml(input.title)}</h1>` : ""}</td></tr>`
    : "";
  const padding = input.contentPadding === false ? "0" : hasHeader ? "0 24px 24px" : "24px";

  return `<!DOCTYPE html>
<html lang="${language}">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${escapeEmailHtml(input.title ?? brandName)}</title></head>
<body style="margin:0;padding:0;width:100%;background-color:${background};font-family:${fontStyle};font-size:14px;line-height:22px;color:${text};overflow-wrap:anywhere;word-wrap:break-word;">
${input.preheader ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeEmailHtml(input.preheader)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${background}" data-bazaar-email-template="v1" style="width:100%;border-collapse:collapse;background-color:${background};"><tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${contentBackground}" style="width:100%;max-width:560px;margin:0 auto;table-layout:fixed;border:1px solid ${border};border-radius:12px;border-collapse:separate;border-spacing:0;background-color:${contentBackground};">
${header}
<tr><td style="padding:${padding};font-family:${fontStyle};font-size:14px;line-height:22px;color:${text};overflow-wrap:anywhere;word-wrap:break-word;">${input.contentHtml}</td></tr>
${input.footerHtml ? `<tr><td style="padding:16px 24px 24px;border-top:1px solid ${border};font-family:${fontStyle};font-size:13px;line-height:20px;color:${muted};overflow-wrap:anywhere;word-wrap:break-word;">${input.footerHtml}</td></tr>` : ""}
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body></html>`;
}
