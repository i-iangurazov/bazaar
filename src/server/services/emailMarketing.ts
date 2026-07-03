import { createHmac, timingSafeEqual } from "node:crypto";

import {
  BazaarCatalogFontFamily,
  BazaarCatalogStatus,
  EmailCampaignFontFamily,
  EmailCampaignRecipientStatus,
  EmailCampaignStatus,
  EmailCampaignTemplate,
  EmailCampaignType,
  EmailSenderDomainStatus,
  EmailSenderIdentityStatus,
  EmailAutomationDeliveryStatus,
  EmailAutomationStatus,
  EmailAutomationTrigger,
} from "@prisma/client";
import type { CustomerOrderStatus, CustomerSource, Prisma } from "@prisma/client";

import { formatKgsMoney } from "@/lib/currencyDisplay";
import { prisma } from "@/server/db/prisma";
import {
  createResendDomain,
  EmailProviderError,
  getMarketingEmailConfiguration,
  listResendDomains,
  MARKETING_EMAIL_FROM,
  retrieveResendDomain,
  sendEmailBatch,
  sendMarketingEmail,
  verifyResendDomain,
  type EmailTag,
  type ResendDnsRecord,
} from "@/server/services/email";
import { AppError } from "@/server/services/errors";
import { toJson } from "@/server/services/json";
import { writeAuditLog } from "@/server/services/audit";
import {
  assertUserCanAccessStore,
  listAccessibleStores,
  resolveDefaultStoreId,
  type StoreAccessUser,
} from "@/server/services/storeAccess";

export type EmailCampaignAudienceInput = {
  mode?: "manual" | "segment";
  customerIds?: string[];
  segment?: "all" | "new" | "source" | "withPurchases" | "withoutPurchases";
  source?: CustomerSource | "ALL" | null;
  recentDays?: number | null;
};

type EmailBlockAlignment = "left" | "center" | "right";

export type EmailCampaignBlock =
  | {
      id: string;
      type: "header";
      showStoreName?: boolean;
      showLogo?: boolean;
      storeName?: string | null;
      heading?: string | null;
      alignment?: EmailBlockAlignment;
    }
  | {
      id: string;
      type: "hero";
      imageUrl?: string | null;
      heading?: string | null;
      subtitle?: string | null;
      buttonText?: string | null;
      buttonUrl?: string | null;
      alignment?: EmailBlockAlignment;
    }
  | {
      id: string;
      type: "text";
      heading?: string | null;
      body?: string | null;
      alignment?: EmailBlockAlignment;
    }
  | {
      id: string;
      type: "button";
      text?: string | null;
      url?: string | null;
      alignment?: EmailBlockAlignment;
    }
  | {
      id: string;
      type: "products";
      productIds?: string[];
      showImage?: boolean;
      showPrice?: boolean;
      showDescription?: boolean;
      showButton?: boolean;
      buttonText?: string | null;
      buttonUrl?: string | null;
      layout?: "one" | "two";
      alignment?: EmailBlockAlignment;
    }
	  | {
	      id: string;
	      type: "orderSummary";
	      title?: string | null;
	      summaryText?: string | null;
	      itemsLabel?: string | null;
	      totalLabel?: string | null;
	      emptyOrderText?: string | null;
	      quantitySeparator?: string | null;
	      sampleItemName?: string | null;
	      showSummary?: boolean;
	      showItems?: boolean;
	      showTotals?: boolean;
	      alignment?: EmailBlockAlignment;
	    }
  | {
      id: string;
      type: "promo";
      title?: string | null;
      discountCode?: string | null;
      description?: string | null;
      expiryText?: string | null;
      buttonText?: string | null;
      buttonUrl?: string | null;
      alignment?: EmailBlockAlignment;
    }
  | {
      id: string;
      type: "divider";
    }
  | {
      id: string;
      type: "footer";
      storeName?: string | null;
      phone?: string | null;
      address?: string | null;
      text?: string | null;
      unsubscribeText?: string | null;
      showUnsubscribe?: boolean;
      alignment?: EmailBlockAlignment;
    };

type EmailCampaignComposerInput = {
  id?: string | null;
  storeId: string;
  name?: string | null;
  campaignType?: EmailCampaignType;
  senderIdentityId?: string | null;
  audience?: EmailCampaignAudienceInput | null;
  source?: CustomerSource | "ALL" | null;
  template?: EmailCampaignTemplate;
  templateKey?: string | null;
  subject: string;
  preheader?: string | null;
  senderDisplayName?: string | null;
  replyToEmail?: string | null;
  brandColor?: string | null;
  buttonColor?: string | null;
  buttonTextColor?: string | null;
  backgroundColor?: string | null;
  contentBackgroundColor?: string | null;
  textColor?: string | null;
  mutedTextColor?: string | null;
  borderColor?: string | null;
  fontFamily?: EmailCampaignFontFamily;
  logoStoreId?: string | null;
  blocks?: EmailCampaignBlock[] | null;
  heading?: string | null;
  body?: string | null;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  footerText?: string | null;
  bannerImageUrl?: string | null;
};

type NormalizedEmailCampaign = {
  id: string | null;
  storeId: string;
  name: string;
  campaignType: EmailCampaignType;
  senderIdentityId: string | null;
  audience: Required<Pick<EmailCampaignAudienceInput, "mode">> & EmailCampaignAudienceInput;
  template: EmailCampaignTemplate;
  templateKey: string;
  subject: string;
  preheader: string | null;
  senderDisplayName: string | null;
  replyToEmail: string | null;
  brandColor: string;
  buttonColor: string;
  buttonTextColor: string;
  backgroundColor: string;
  contentBackgroundColor: string;
  textColor: string;
  mutedTextColor: string;
  borderColor: string;
  fontFamily: EmailCampaignFontFamily;
  logoStoreId: string | null;
  bannerImageUrl?: string | null;
  blocks: EmailCampaignBlock[];
  legacyBody: string;
};

type EmailMarketingStore = {
  id: string;
  name: string;
  legalName: string | null;
  address: string | null;
  phone: string | null;
  currencyCode: string;
  currencyRateKgsPerUnit: Prisma.Decimal | number | string;
  enableSku: boolean;
  enableBarcode: boolean;
  bazaarCatalog: {
    accentColor: string | null;
    status: BazaarCatalogStatus;
    publicUrlPath: string;
  } | null;
};

type EmailMarketingProduct = {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  priceKgs: number | null;
  priceText: string | null;
  currencyCode: string;
  publicUrl: string | null;
};

type EmailRenderOrder = {
  number: string;
  status: string;
  previousStatus?: string | null;
  totalText: string;
  lines: Array<{
    name: string;
    qty: number;
    totalText: string;
  }>;
};

type EmailCampaignWarning = {
  code: string;
  message: string;
  blockId?: string;
};

type RecipientRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  source: CustomerSource;
  createdAt: Date;
  orderCount: number;
  emailMarketingUnsubscribedAt: Date | null;
};

type AudienceSummary = {
  totalSelected: number;
  validRecipients: number;
  excludedNoEmail: number;
  excludedUnsubscribed: number;
  duplicatesRemoved: number;
};

const defaultBrandColor = "#1d4ed8";
const defaultButtonColor = "#1d4ed8";
const defaultButtonTextColor = "#ffffff";
const defaultEmailBackgroundColor = "#f3f4f6";
const defaultEmailContentBackgroundColor = "#ffffff";
const defaultEmailTextColor = "#111827";
const defaultEmailMutedTextColor = "#4b5563";
const defaultEmailBorderColor = "#e5e7eb";
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const maxCampaignRecipients = 5_000;
const emailContentVersion = 1;
const publicSenderDomains = new Set([
  "gmail.com",
  "googlemail.com",
  "mail.ru",
  "yandex.ru",
  "ya.ru",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "icloud.ru",
  "yahoo.com",
  "bk.ru",
  "inbox.ru",
  "list.ru",
  "proton.me",
  "protonmail.com",
]);

const trimOptional = (value?: string | null) => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

const normalizeColor = (value: string | null | undefined, fallback: string) => {
  const normalized = trimOptional(value);
  return normalized && /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized : fallback;
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

const normalizeRecipientEmail = (email?: string | null) => email?.trim().toLowerCase() ?? "";

const isValidEmail = (email?: string | null) => emailPattern.test(normalizeRecipientEmail(email));

const normalizeDomain = (domain?: string | null) =>
  domain
    ?.trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    ?.replace(/\.$/, "") ?? "";

const emailDomain = (email?: string | null) => {
  const normalized = normalizeRecipientEmail(email);
  const [, domain] = normalized.split("@");
  return normalizeDomain(domain);
};

export const validateEmailSenderAddress = (fromEmailInput: string) => {
  const fromEmail = normalizeRecipientEmail(fromEmailInput);
  if (!isValidEmail(fromEmail)) {
    throw new AppError("emailSenderFromInvalid", "BAD_REQUEST", 400);
  }
  const domain = normalizeDomain(emailDomain(fromEmail));
  if (!domain || !domain.includes(".") || domain.includes("@")) {
    throw new AppError("emailSenderDomainInvalid", "BAD_REQUEST", 400);
  }
  if (publicSenderDomains.has(domain)) {
    throw new AppError("emailSenderPublicDomain", "BAD_REQUEST", 400);
  }
  return { fromEmail, domain };
};

const formatEmailAddress = (input: { name?: string | null; email: string }) => {
  const email = normalizeRecipientEmail(input.email);
  const name = trimOptional(input.name);
  if (!name) {
    return email;
  }
  const safeName = name.replace(/[<>"\r\n]/g, "").trim();
  return safeName ? `${safeName} <${email}>` : email;
};

const resendStatusToDomainStatus = (status?: string | null): EmailSenderDomainStatus => {
  const normalized = status?.trim().toLowerCase();
  if (normalized === "verified") {
    return EmailSenderDomainStatus.VERIFIED;
  }
  if (normalized === "failed" || normalized === "temporary_failure") {
    return EmailSenderDomainStatus.FAILED;
  }
  return EmailSenderDomainStatus.PENDING;
};

const localEmailAssetHostnames = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

const isLocalImageStorageSelected = () =>
  (process.env.IMAGE_STORAGE_PROVIDER?.trim().toLowerCase() || "local") !== "r2";

const hasR2PublicBaseConfigured = () => Boolean(process.env.R2_PUBLIC_BASE_URL?.trim());

const nonPublicEmailImageErrorCode = () =>
  isLocalImageStorageSelected() && hasR2PublicBaseConfigured()
    ? "emailCampaignImageStorageLocal"
    : "emailCampaignImagePublicUrlRequired";

const nonPublicEmailImageWarningMessage = () =>
  isLocalImageStorageSelected() && hasR2PublicBaseConfigured()
    ? "R2_PUBLIC_BASE_URL задан, но IMAGE_STORAGE_PROVIDER сейчас local. Новые изображения сохраняются локально и превращаются в localhost URL. Поставьте IMAGE_STORAGE_PROVIDER=r2, перезапустите сервер и заново загрузите изображения."
    : "Некоторые изображения письма ведут на localhost. Они видны в админке, но не откроются в почтовом ящике. Укажите публичный NEXTAUTH_URL/NEXT_PUBLIC_APP_URL или R2_PUBLIC_BASE_URL.";

const getPublicAppBaseUrl = () => {
  const candidates = [
    process.env.NEXTAUTH_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.APP_URL,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
  ];
  for (const candidate of candidates) {
    const normalized = candidate?.trim();
    if (!normalized) {
      continue;
    }
    try {
      const parsed = new URL(normalized);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return trimTrailingSlash(parsed.toString());
      }
    } catch {
      // Ignore invalid app URL configuration.
    }
  }
  return null;
};

export const getEmailMarketingPublicAppBaseUrl = getPublicAppBaseUrl;

export const requireEmailMarketingPublicAppBaseUrl = () => {
  const baseUrl = getPublicAppBaseUrl();
  if (!baseUrl) {
    throw new AppError("emailMarketingPublicUrlRequired", "BAD_REQUEST", 400);
  }
  return baseUrl;
};

export const resolveEmailMarketingAssetUrl = (value?: string | null) => {
  const normalized = trimOptional(value);
  if (!normalized || /^data:image\//i.test(normalized)) {
    return null;
  }
  try {
    const parsed = new URL(normalized);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    if (!normalized.startsWith("/")) {
      return null;
    }
    const baseUrl = getPublicAppBaseUrl();
    return baseUrl ? new URL(normalized, baseUrl).toString() : null;
  }
};

export const isPublicEmailMarketingAssetUrl = (value?: string | null) => {
  const normalized = trimOptional(value);
  if (!normalized) {
    return false;
  }
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    return !localEmailAssetHostnames.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
};

const resolveEmailLinkUrl = (value?: string | null, baseUrl?: string | null) => {
  const normalized = trimOptional(value);
  if (!normalized) {
    return null;
  }
  try {
    const parsed = new URL(normalized);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    if (baseUrl && normalized.startsWith("/")) {
      return new URL(normalized, baseUrl).toString();
    }
    return null;
  }
};

const cssFontFamily = (fontFamily: EmailCampaignFontFamily) => {
  if (fontFamily === EmailCampaignFontFamily.NOTO_SANS) {
    return "Noto Sans, Inter, Segoe UI, Arial, sans-serif";
  }
  if (fontFamily === EmailCampaignFontFamily.JOST) {
    return "Jost, Inter, Segoe UI, Arial, sans-serif";
  }
  if (fontFamily === EmailCampaignFontFamily.ROBOTO) {
    return "Roboto, Arial, Helvetica, sans-serif";
  }
  if (fontFamily === EmailCampaignFontFamily.OPEN_SANS) {
    return "Open Sans, Arial, Helvetica, sans-serif";
  }
  if (fontFamily === EmailCampaignFontFamily.MONTSERRAT) {
    return "Montserrat, Arial, Helvetica, sans-serif";
  }
  if (fontFamily === EmailCampaignFontFamily.LATO) {
    return "Lato, Arial, Helvetica, sans-serif";
  }
  if (fontFamily === EmailCampaignFontFamily.PT_SANS) {
    return "PT Sans, Arial, Helvetica, sans-serif";
  }
  if (fontFamily === EmailCampaignFontFamily.SOURCE_SANS_3) {
    return "Source Sans 3, Arial, Helvetica, sans-serif";
  }
  if (fontFamily === EmailCampaignFontFamily.MANROPE) {
    return "Manrope, Arial, Helvetica, sans-serif";
  }
  if (fontFamily === EmailCampaignFontFamily.SYSTEM) {
    return "-apple-system, BlinkMacSystemFont, Segoe UI, Arial, sans-serif";
  }
  return "Inter, Segoe UI, Arial, sans-serif";
};

const emailFontFromCatalogFont = (fontFamily?: BazaarCatalogFontFamily | null) => {
  switch (fontFamily) {
    case BazaarCatalogFontFamily.NotoSans:
      return EmailCampaignFontFamily.NOTO_SANS;
    case BazaarCatalogFontFamily.Inter:
      return EmailCampaignFontFamily.INTER;
    case BazaarCatalogFontFamily.System:
      return EmailCampaignFontFamily.SYSTEM;
    case BazaarCatalogFontFamily.Roboto:
      return EmailCampaignFontFamily.ROBOTO;
    case BazaarCatalogFontFamily.OpenSans:
      return EmailCampaignFontFamily.OPEN_SANS;
    case BazaarCatalogFontFamily.Montserrat:
      return EmailCampaignFontFamily.MONTSERRAT;
    case BazaarCatalogFontFamily.Lato:
      return EmailCampaignFontFamily.LATO;
    case BazaarCatalogFontFamily.PTSans:
      return EmailCampaignFontFamily.PT_SANS;
    case BazaarCatalogFontFamily.SourceSans3:
      return EmailCampaignFontFamily.SOURCE_SANS_3;
    case BazaarCatalogFontFamily.Manrope:
      return EmailCampaignFontFamily.MANROPE;
    default:
      return EmailCampaignFontFamily.INTER;
  }
};

const normalizeBlockId = (block: EmailCampaignBlock, index: number) => ({
  ...block,
  id: trimOptional(block.id) ?? `block-${index + 1}`,
});

const legacyBlocksFromInput = (input: EmailCampaignComposerInput): EmailCampaignBlock[] => {
  const blocks: EmailCampaignBlock[] = [];
  const heading = trimOptional(input.heading);
  const body = trimOptional(input.body);
  const bannerImageUrl = trimOptional(input.bannerImageUrl);
  if (bannerImageUrl || heading) {
    blocks.push({
      id: "legacy-hero",
      type: "hero",
      imageUrl: bannerImageUrl,
      heading,
      subtitle: null,
      buttonText: trimOptional(input.ctaLabel),
      buttonUrl: trimOptional(input.ctaUrl),
    });
  }
  if (body) {
    blocks.push({ id: "legacy-text", type: "text", heading: null, body });
  }
  if (trimOptional(input.ctaLabel) && trimOptional(input.ctaUrl) && !heading) {
    blocks.push({
      id: "legacy-button",
      type: "button",
      text: trimOptional(input.ctaLabel),
      url: trimOptional(input.ctaUrl),
    });
  }
  blocks.push({
    id: "legacy-footer",
    type: "footer",
    text: trimOptional(input.footerText),
    showUnsubscribe: true,
  });
  return blocks;
};

const blockHasMeaningfulContent = (block: EmailCampaignBlock) => {
  switch (block.type) {
    case "header":
      return Boolean(block.showStoreName ?? true) || Boolean(trimOptional(block.storeName) || trimOptional(block.heading));
    case "hero":
      return Boolean(
        trimOptional(block.imageUrl) ||
        trimOptional(block.heading) ||
        trimOptional(block.subtitle) ||
        trimOptional(block.buttonText),
      );
    case "text":
      return Boolean(trimOptional(block.heading) || trimOptional(block.body));
    case "button":
      return Boolean(trimOptional(block.text) && trimOptional(block.url));
    case "products":
      return Boolean(block.productIds?.length);
    case "orderSummary":
      return true;
    case "promo":
      return Boolean(
        trimOptional(block.title) ||
        trimOptional(block.discountCode) ||
        trimOptional(block.description),
      );
    case "divider":
      return true;
    case "footer":
      return Boolean(
        trimOptional(block.text) ||
        trimOptional(block.storeName) ||
        trimOptional(block.phone) ||
        trimOptional(block.address) ||
        (block.showUnsubscribe ?? true),
      );
    default:
      return false;
  }
};

const bodyTextFromBlocks = (blocks: EmailCampaignBlock[]) =>
  blocks
    .flatMap((block) => {
      switch (block.type) {
        case "header":
          return [block.storeName, block.heading];
        case "hero":
          return [block.heading, block.subtitle, block.buttonText];
        case "text":
          return [block.heading, block.body];
        case "button":
          return [block.text, block.url];
	        case "products":
	          return [`Products: ${(block.productIds ?? []).join(", ")}`];
	        case "orderSummary":
	          return [
	            block.title ?? "Order summary",
	            block.summaryText,
	            block.itemsLabel,
	            block.totalLabel,
	            block.emptyOrderText,
	          ];
        case "promo":
          return [block.title, block.discountCode, block.description, block.expiryText];
        case "footer":
          return [block.text, block.unsubscribeText, block.storeName, block.phone, block.address];
        default:
          return [];
      }
    })
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join("\n\n");

const normalizeAudience = (
  input: EmailCampaignComposerInput,
): NormalizedEmailCampaign["audience"] => {
  const source = input.audience?.source ?? input.source ?? "ALL";
  const mode = input.audience?.mode ?? (input.audience?.customerIds?.length ? "manual" : "segment");
  return {
    mode,
    customerIds: Array.from(new Set(input.audience?.customerIds ?? [])).slice(
      0,
      maxCampaignRecipients,
    ),
    segment: input.audience?.segment ?? "all",
    source,
    recentDays: Math.min(365, Math.max(1, Math.trunc(input.audience?.recentDays ?? 30))),
  };
};

const normalizeCampaignInput = (
  input: EmailCampaignComposerInput,
  options?: { requireSubject?: boolean; requireContent?: boolean },
): NormalizedEmailCampaign => {
  const subject = input.subject.trim();
  if ((options?.requireSubject ?? true) && !subject) {
    throw new AppError("emailCampaignSubjectRequired", "BAD_REQUEST", 400);
  }
  const blocks = (input.blocks?.length ? input.blocks : legacyBlocksFromInput(input))
    .map(normalizeBlockId)
    .filter(blockHasMeaningfulContent)
    .slice(0, 30);
  if ((options?.requireContent ?? true) && !blocks.some(blockHasMeaningfulContent)) {
    throw new AppError("emailCampaignBodyRequired", "BAD_REQUEST", 400);
  }

  const replyToEmail = trimOptional(input.replyToEmail);
  if (replyToEmail && !isValidEmail(replyToEmail)) {
    throw new AppError("emailCampaignReplyToInvalid", "BAD_REQUEST", 400);
  }

  const campaignName =
    trimOptional(input.name) ??
    subject ??
    `Кампания ${new Intl.DateTimeFormat("ru-KG").format(new Date())}`;

  return {
    id: trimOptional(input.id),
    storeId: input.storeId,
    name: campaignName.slice(0, 180),
    campaignType: input.campaignType ?? EmailCampaignType.MARKETING,
    senderIdentityId: trimOptional(input.senderIdentityId),
    audience: normalizeAudience(input),
    template: input.template ?? EmailCampaignTemplate.CUSTOM,
    templateKey: (trimOptional(input.templateKey) ?? "blank").slice(0, 80),
    subject,
    preheader: trimOptional(input.preheader),
    senderDisplayName: trimOptional(input.senderDisplayName),
    replyToEmail,
    brandColor: normalizeColor(input.brandColor, defaultBrandColor),
    buttonColor: normalizeColor(input.buttonColor, defaultButtonColor),
    buttonTextColor: normalizeColor(input.buttonTextColor, defaultButtonTextColor),
    backgroundColor: normalizeColor(input.backgroundColor, defaultEmailBackgroundColor),
    contentBackgroundColor: normalizeColor(
      input.contentBackgroundColor,
      defaultEmailContentBackgroundColor,
    ),
    textColor: normalizeColor(input.textColor, defaultEmailTextColor),
    mutedTextColor: normalizeColor(input.mutedTextColor, defaultEmailMutedTextColor),
    borderColor: normalizeColor(input.borderColor, defaultEmailBorderColor),
    fontFamily: input.fontFamily ?? EmailCampaignFontFamily.INTER,
    logoStoreId: trimOptional(input.logoStoreId),
    bannerImageUrl: trimOptional(input.bannerImageUrl),
    blocks,
    legacyBody: bodyTextFromBlocks(blocks) || trimOptional(input.body) || "Кампания",
  };
};

const parseCampaignBlocks = (value: Prisma.JsonValue | null, fallback: EmailCampaignBlock[]) => {
  if (!Array.isArray(value)) {
    return fallback;
  }
  return value
    .filter((item) => Boolean(item) && typeof item === "object")
    .map((item, index) => normalizeBlockId(item as EmailCampaignBlock, index))
    .filter(blockHasMeaningfulContent);
};

const parseCampaignAudience = (
  value: Prisma.JsonValue | null,
  fallback: EmailCampaignAudienceInput = { mode: "segment", segment: "all" },
): EmailCampaignAudienceInput => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }
  const record = value as Record<string, unknown>;
  const mode = record.mode === "manual" || record.mode === "segment" ? record.mode : fallback.mode;
  const segment =
    record.segment === "all" ||
    record.segment === "new" ||
    record.segment === "source" ||
    record.segment === "withPurchases" ||
    record.segment === "withoutPurchases"
      ? record.segment
      : fallback.segment;
  return {
    mode,
    segment,
    customerIds: Array.isArray(record.customerIds)
      ? record.customerIds.filter((id): id is string => typeof id === "string")
      : fallback.customerIds,
    source: typeof record.source === "string" ? (record.source as CustomerSource | "ALL") : fallback.source,
    recentDays:
      typeof record.recentDays === "number" && Number.isFinite(record.recentDays)
        ? record.recentDays
        : fallback.recentDays,
  };
};

const getEmailUnsubscribeSecret = () => {
  const secret = [
    process.env.EMAIL_UNSUBSCRIBE_SECRET,
    process.env.NEXTAUTH_SECRET,
    process.env.JOBS_SECRET,
  ]
    .map((value) => value?.trim())
    .find(Boolean);
  if (!secret && process.env.NODE_ENV !== "test") {
    throw new AppError("emailMarketingUnsubscribeSecretMissing", "BAD_REQUEST", 400);
  }
  return secret || "test-email-unsubscribe-secret";
};

export const createEmailUnsubscribeToken = (input: { customerId: string; email: string }) =>
  createHmac("sha256", getEmailUnsubscribeSecret())
    .update(`${input.customerId}:${normalizeRecipientEmail(input.email)}`)
    .digest("base64url");

const isValidEmailUnsubscribeToken = (input: {
  customerId: string;
  email: string;
  token: string;
}) => {
  const expected = createEmailUnsubscribeToken(input);
  const provided = input.token.trim();
  if (!provided) {
    return false;
  }
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  );
};

export const buildEmailUnsubscribeUrl = (input: {
  baseUrl: string;
  customerId: string;
  email: string;
}) => {
  const url = new URL("/api/email-marketing/unsubscribe", input.baseUrl);
  url.searchParams.set("customerId", input.customerId);
  url.searchParams.set("email", normalizeRecipientEmail(input.email));
  url.searchParams.set(
    "token",
    createEmailUnsubscribeToken({ customerId: input.customerId, email: input.email }),
  );
  return url.toString();
};

export const unsubscribeCustomerFromEmailMarketing = async (input: {
  customerId: string;
  email: string;
  token: string;
}) => {
  if (!isValidEmailUnsubscribeToken(input)) {
    throw new AppError("apiUnauthorized", "UNAUTHORIZED", 401);
  }
  const email = normalizeRecipientEmail(input.email);
  const customer = await prisma.customer.findUnique({
    where: { id: input.customerId },
    select: {
      id: true,
      email: true,
      emailMarketingUnsubscribedAt: true,
    },
  });
  if (!customer || normalizeRecipientEmail(customer.email) !== email) {
    throw new AppError("customerNotFound", "NOT_FOUND", 404);
  }
  if (customer.emailMarketingUnsubscribedAt) {
    return { status: "already_unsubscribed" as const, email };
  }
  await prisma.customer.update({
    where: { id: customer.id },
    data: { emailMarketingUnsubscribedAt: new Date() },
  });
  return { status: "unsubscribed" as const, email };
};

const getStoreBrand = async (input: { organizationId: string; storeId: string }) => {
  const store = await prisma.store.findFirst({
    where: { id: input.storeId, organizationId: input.organizationId },
    select: {
      id: true,
      name: true,
      legalName: true,
      address: true,
      phone: true,
      currencyCode: true,
      currencyRateKgsPerUnit: true,
      enableSku: true,
      enableBarcode: true,
      bazaarCatalog: {
        select: {
          accentColor: true,
          status: true,
          publicUrlPath: true,
        },
      },
    },
  });
  if (!store) {
    throw new AppError("storeNotFound", "NOT_FOUND", 404);
  }
  return {
    store,
    storeName: store.legalName?.trim() || store.name,
    brandColor: store.bazaarCatalog?.accentColor ?? defaultBrandColor,
  };
};

export const listEmailMarketingLogoGallery = async (input: { user: StoreAccessUser }) => {
  const accessibleStores = await listAccessibleStores(prisma, input.user);
  const storeIds = accessibleStores.map((store) => store.id);
  if (!storeIds.length) {
    return [];
  }
  const stores = await prisma.store.findMany({
    where: {
      organizationId: input.user.organizationId,
      id: { in: storeIds },
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      legalName: true,
      phone: true,
      address: true,
      bazaarCatalog: {
        select: {
          accentColor: true,
          fontFamily: true,
          logoImage: { select: { url: true } },
        },
      },
    },
  });

  const logos = await prisma.emailMarketingLogo.findMany({
    where: {
      organizationId: input.user.organizationId,
      storeId: { in: storeIds },
    },
    select: {
      storeId: true,
      imageId: true,
      updatedAt: true,
      image: { select: { url: true } },
    },
  });
  const logosByStoreId = new Map(logos.map((logo) => [logo.storeId, logo]));

  return stores.map((store) => {
    const logo = logosByStoreId.get(store.id);
    return {
      storeId: store.id,
      storeName: store.name,
      legalName: store.legalName,
      phone: store.phone,
      address: store.address,
      brandColor: store.bazaarCatalog?.accentColor ?? defaultBrandColor,
      fontFamily: emailFontFromCatalogFont(store.bazaarCatalog?.fontFamily),
      imageId: logo?.imageId ?? null,
      logoUrl:
        resolveEmailMarketingAssetUrl(logo?.image.url) ??
        resolveEmailMarketingAssetUrl(store.bazaarCatalog?.logoImage?.url) ??
        null,
      updatedAt: logo?.updatedAt ?? null,
    };
  });
};

export const upsertEmailMarketingStoreLogo = async (input: {
  user: StoreAccessUser;
  actorId: string;
  requestId: string;
  storeId: string;
  imageUrl: string;
}) => {
  await assertUserCanAccessStore(prisma, input.user, input.storeId);
  const url = input.imageUrl.trim();
  if (!url) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }

  return prisma.$transaction(async (tx) => {
    const image = await tx.bazaarCatalogImage.create({
      data: {
        organizationId: input.user.organizationId,
        url,
      },
      select: {
        id: true,
        url: true,
      },
    });
    const logo = await tx.emailMarketingLogo.upsert({
      where: { storeId: input.storeId },
      create: {
        organizationId: input.user.organizationId,
        storeId: input.storeId,
        imageId: image.id,
        updatedById: input.actorId,
      },
      update: {
        imageId: image.id,
        updatedById: input.actorId,
      },
      select: {
        storeId: true,
        imageId: true,
        updatedAt: true,
        store: { select: { name: true } },
        image: { select: { url: true } },
      },
    });

    await writeAuditLog(tx, {
      organizationId: input.user.organizationId,
      actorId: input.actorId,
      action: "EMAIL_MARKETING_LOGO_UPSERT",
      entity: "EmailMarketingLogo",
      entityId: logo.storeId,
      before: null,
      after: toJson({
        storeId: input.storeId,
        imageId: image.id,
      }),
      requestId: input.requestId,
    });

    return {
      storeId: logo.storeId,
      storeName: logo.store.name,
      imageId: logo.imageId,
      logoUrl: resolveEmailMarketingAssetUrl(logo.image.url),
      updatedAt: logo.updatedAt,
    };
  });
};

const resolveCampaignLogo = async (input: {
  user: StoreAccessUser;
  campaignStoreId: string;
  logoStoreId?: string | null;
}) => {
  const logoStoreId = input.logoStoreId ?? input.campaignStoreId;
  await assertUserCanAccessStore(prisma, input.user, logoStoreId);
  const logo = await prisma.emailMarketingLogo.findFirst({
    where: {
      organizationId: input.user.organizationId,
      storeId: logoStoreId,
    },
    select: {
      imageId: true,
      image: { select: { url: true } },
    },
  });
  const fallbackStore = logo
    ? null
    : await prisma.store.findFirst({
        where: {
          id: logoStoreId,
          organizationId: input.user.organizationId,
        },
        select: {
          bazaarCatalog: {
            select: {
              logoImage: { select: { id: true, url: true } },
            },
          },
        },
      });
  const fallbackLogo = fallbackStore?.bazaarCatalog?.logoImage ?? null;
  const logoSourceUrl = logo?.image.url ?? fallbackLogo?.url ?? null;

  return {
    logoImageId: logo?.imageId ?? fallbackLogo?.id ?? null,
    logoSourceUrl,
    logoUrl: resolveEmailMarketingAssetUrl(logoSourceUrl) ?? null,
  };
};

const buildAudienceWhere = (
  organizationId: string,
  storeId: string,
  audience: NormalizedEmailCampaign["audience"],
): Prisma.CustomerWhereInput => {
  const source = audience.source && audience.source !== "ALL" ? audience.source : null;
  const recentDays = Math.min(365, Math.max(1, Math.trunc(audience.recentDays ?? 30)));
  const recentDate = new Date(Date.now() - recentDays * 24 * 60 * 60 * 1000);
  const base: Prisma.CustomerWhereInput = {
    organizationId,
    storeId,
    deletedAt: null,
    ...(source ? { source } : {}),
  };

  if (audience.mode === "manual") {
    return {
      ...base,
      id: { in: audience.customerIds?.length ? audience.customerIds : ["__empty_audience__"] },
    };
  }

  if (audience.segment === "new") {
    return { ...base, createdAt: { gte: recentDate } };
  }
  if (audience.segment === "withPurchases") {
    return { ...base, orderCount: { gt: 0 } };
  }
  if (audience.segment === "withoutPurchases") {
    return { ...base, orderCount: 0 };
  }
  return base;
};

const summarizeAudience = (customers: RecipientRow[]) => {
  const seenEmails = new Set<string>();
  const recipients: RecipientRow[] = [];
  const summary: AudienceSummary = {
    totalSelected: customers.length,
    validRecipients: 0,
    excludedNoEmail: 0,
    excludedUnsubscribed: 0,
    duplicatesRemoved: 0,
  };

  for (const customer of customers) {
    const email = normalizeRecipientEmail(customer.email);
    if (!email || !emailPattern.test(email)) {
      summary.excludedNoEmail += 1;
      continue;
    }
    if (customer.emailMarketingUnsubscribedAt) {
      summary.excludedUnsubscribed += 1;
      continue;
    }
    if (seenEmails.has(email)) {
      summary.duplicatesRemoved += 1;
      continue;
    }
    seenEmails.add(email);
    recipients.push(customer);
  }

  summary.validRecipients = recipients.length;
  return { recipients, summary };
};

const resolveCampaignRecipients = async (input: {
  user: StoreAccessUser;
  campaign: NormalizedEmailCampaign;
}) => {
  await assertUserCanAccessStore(prisma, input.user, input.campaign.storeId);
  const where = buildAudienceWhere(
    input.user.organizationId,
    input.campaign.storeId,
    input.campaign.audience,
  );
  const customers = await prisma.customer.findMany({
    where,
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      source: true,
      createdAt: true,
      orderCount: true,
      emailMarketingUnsubscribedAt: true,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: maxCampaignRecipients,
  });
  return summarizeAudience(customers);
};

export const getEmailMarketingAudiencePreview = async (input: {
  user: StoreAccessUser;
  storeId: string;
  audience?: EmailCampaignAudienceInput | null;
  source?: CustomerSource | "ALL" | null;
}) => {
  const campaign = normalizeCampaignInput(
    {
      storeId: input.storeId,
      subject: "",
      audience: input.audience ?? { mode: "segment", segment: "all", source: input.source },
      blocks: [{ id: "preview", type: "text", body: "preview" }],
    },
    { requireSubject: false, requireContent: false },
  );
  const { summary } = await resolveCampaignRecipients({ user: input.user, campaign });
  return summary;
};

export const getEmailMarketingOverview = async (input: {
  user: StoreAccessUser;
  storeId?: string | null;
  source?: CustomerSource | "ALL" | null;
}) => {
  const storeId = await resolveDefaultStoreId(prisma, input.user, input.storeId);
  const config = getMarketingEmailConfiguration();
  if (!storeId) {
    return {
      storeId: null,
      store: null,
      reachableCustomers: 0,
      audienceSummary: {
        totalSelected: 0,
        validRecipients: 0,
        excludedNoEmail: 0,
        excludedUnsubscribed: 0,
        duplicatesRemoved: 0,
      },
      sources: [],
      quickSegments: [],
      status: "NOT_CONFIGURED" as const,
      config,
    };
  }
  await assertUserCanAccessStore(prisma, input.user, storeId);
  const brand = await getStoreBrand({ organizationId: input.user.organizationId, storeId });
  const [sourceRows, audienceSummary] = await Promise.all([
    prisma.customer.groupBy({
      by: ["source"],
      where: {
        organizationId: input.user.organizationId,
        storeId,
        deletedAt: null,
      },
      _count: { _all: true },
    }),
    getEmailMarketingAudiencePreview({
      user: input.user,
      storeId,
      audience: { mode: "segment", segment: "all", source: input.source ?? "ALL" },
    }),
  ]);
  const status = config.ready ? "READY" : "NOT_CONFIGURED";
  return {
    storeId,
    store: {
      id: brand.store.id,
      name: brand.store.name,
      legalName: brand.store.legalName,
      address: brand.store.address,
      phone: brand.store.phone,
      currencyCode: brand.store.currencyCode,
      currencyRateKgsPerUnit: Number(brand.store.currencyRateKgsPerUnit),
	      enableSku: brand.store.enableSku,
	      enableBarcode: brand.store.enableBarcode,
	      brandColor: brand.brandColor,
	      catalogUrlPath:
        brand.store.bazaarCatalog?.status === BazaarCatalogStatus.PUBLISHED
          ? brand.store.bazaarCatalog.publicUrlPath
          : null,
    },
    reachableCustomers: audienceSummary.validRecipients,
    audienceSummary,
    sources: sourceRows.map((row) => ({ source: row.source, count: row._count._all })),
    quickSegments: ["all", "new", "source", "withPurchases", "withoutPurchases"] as const,
    status,
    config,
  };
};

export const listEmailSenderSetup = async (input: {
  user: StoreAccessUser;
  storeId: string;
}) => {
  await assertUserCanAccessStore(prisma, input.user, input.storeId);
  const [domains, senders] = await Promise.all([
    prisma.emailSenderDomain.findMany({
      where: {
        organizationId: input.user.organizationId,
        storeId: input.storeId,
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    }),
    prisma.emailSenderIdentity.findMany({
      where: {
        organizationId: input.user.organizationId,
        storeId: input.storeId,
        archivedAt: null,
      },
      include: { domain: true },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    }),
  ]);
  const config = getMarketingEmailConfiguration();
  return {
    domains,
    senders,
    defaultSender: {
      id: "__default__",
      displayName: "Bazaar",
      fromEmail: MARKETING_EMAIL_FROM,
      replyToEmail: null,
      status: config.ready ? "VERIFIED" : "NOT_CONFIGURED",
      demoOnly: false,
      provider: config.provider,
    },
  };
};

const ensureSenderDomainInput = (domain: string) => {
  const normalized = normalizeDomain(domain);
  if (!normalized || !normalized.includes(".") || normalized.includes("@")) {
    throw new AppError("emailSenderDomainInvalid", "BAD_REQUEST", 400);
  }
  if (publicSenderDomains.has(normalized)) {
    throw new AppError("emailSenderPublicDomain", "BAD_REQUEST", 400);
  }
  return normalized;
};

const normalizeResendRecords = (records?: ResendDnsRecord[] | null) =>
  (records ?? []).map((record) => ({
    record: record.record ?? null,
    name: record.name ?? null,
    type: record.type ?? null,
    ttl: record.ttl ?? null,
    status: record.status ?? null,
    value: record.value ?? null,
    priority: record.priority ?? null,
  }));

const isProviderNotConfiguredError = (error: unknown) =>
  error instanceof Error && error.message === "emailProviderNotConfigured";

const isResendDomainAlreadyExistsError = (error: unknown) => {
  if (!(error instanceof EmailProviderError)) {
    return false;
  }
  const text = `${error.providerMessage ?? ""} ${error.responseText}`.toLowerCase();
  return (
    error.status === 409 ||
    text.includes("already") ||
    text.includes("exist") ||
    text.includes("registered")
  );
};

const isResendRestrictedApiKeyError = (error: EmailProviderError) => {
  const text = `${error.providerMessage ?? ""} ${error.responseText}`.toLowerCase();
  return text.includes("restricted_api_key") || text.includes("restricted to only send emails");
};

export const mapEmailSenderProviderError = (error: unknown): AppError => {
  if (error instanceof AppError) {
    return error;
  }
  if (isProviderNotConfiguredError(error)) {
    return new AppError("emailSenderProviderNotConfigured", "BAD_REQUEST", 400);
  }
  if (error instanceof EmailProviderError) {
    if (isResendRestrictedApiKeyError(error)) {
      return new AppError("emailSenderProviderRestrictedKey", "BAD_REQUEST", 400);
    }
    if (error.status === 401 || error.status === 403) {
      return new AppError("emailSenderProviderAuthFailed", "BAD_REQUEST", 400);
    }
    if (error.status === 429) {
      return new AppError("emailSenderProviderRateLimited", "TOO_MANY_REQUESTS", 429);
    }
    if (isResendDomainAlreadyExistsError(error)) {
      return new AppError("emailSenderDomainAlreadyExists", "CONFLICT", 409);
    }
    return new AppError("emailSenderProviderRejected", "BAD_REQUEST", 400);
  }
  if (error instanceof Error && error.message.startsWith("emailProviderError")) {
    return new AppError("emailSenderProviderRejected", "BAD_REQUEST", 400);
  }
  return new AppError("emailSenderProviderRejected", "BAD_REQUEST", 400);
};

const findExistingResendDomainByName = async (domainName: string) => {
  const response = await listResendDomains();
  const domains = Array.isArray(response) ? response : response.data ?? [];
  const match = domains.find((domain) => normalizeDomain(domain.name) === domainName) ?? null;
  return match ? retrieveResendDomain(match.id) : null;
};

export const createEmailSenderIdentity = async (input: {
  user: StoreAccessUser;
  actorId: string;
  requestId: string;
  storeId: string;
  displayName: string;
  fromEmail: string;
  replyToEmail?: string | null;
}) => {
  await assertUserCanAccessStore(prisma, input.user, input.storeId);
  const { fromEmail, domain: domainName } = validateEmailSenderAddress(input.fromEmail);
  const replyToEmail = trimOptional(input.replyToEmail);
  if (replyToEmail && !isValidEmail(replyToEmail)) {
    throw new AppError("emailCampaignReplyToInvalid", "BAD_REQUEST", 400);
  }
  ensureSenderDomainInput(domainName);
  const displayName = trimOptional(input.displayName) ?? domainName;

  let remoteDomain: Awaited<ReturnType<typeof createResendDomain>> | null = null;
  const existingDomain = await prisma.emailSenderDomain.findUnique({
    where: {
      organizationId_storeId_domain: {
        organizationId: input.user.organizationId,
        storeId: input.storeId,
        domain: domainName,
      },
    },
  });
  if (!existingDomain?.resendDomainId) {
    try {
      remoteDomain = await createResendDomain(domainName);
    } catch (error) {
      if (!isResendDomainAlreadyExistsError(error)) {
        throw mapEmailSenderProviderError(error);
      }
      try {
        remoteDomain = await findExistingResendDomainByName(domainName);
      } catch (listError) {
        throw mapEmailSenderProviderError(listError);
      }
      if (!remoteDomain) {
        throw mapEmailSenderProviderError(error);
      }
    }
  }

  const domain = await prisma.emailSenderDomain.upsert({
    where: {
      organizationId_storeId_domain: {
        organizationId: input.user.organizationId,
        storeId: input.storeId,
        domain: domainName,
      },
    },
    create: {
      organizationId: input.user.organizationId,
      storeId: input.storeId,
      domain: domainName,
      resendDomainId: remoteDomain?.id ?? null,
      resendStatus: remoteDomain?.status ?? null,
      recordsJson: normalizeResendRecords(remoteDomain?.records) as unknown as Prisma.InputJsonValue,
      status: resendStatusToDomainStatus(remoteDomain?.status),
      verifiedAt:
        resendStatusToDomainStatus(remoteDomain?.status) === EmailSenderDomainStatus.VERIFIED
          ? new Date()
          : null,
      lastCheckedAt: remoteDomain ? new Date() : null,
    },
    update: {
      resendDomainId: existingDomain?.resendDomainId ?? remoteDomain?.id ?? undefined,
      resendStatus: remoteDomain?.status ?? existingDomain?.resendStatus ?? undefined,
      recordsJson: remoteDomain?.records
        ? (normalizeResendRecords(remoteDomain.records) as unknown as Prisma.InputJsonValue)
        : undefined,
      status: remoteDomain ? resendStatusToDomainStatus(remoteDomain.status) : undefined,
      lastCheckedAt: remoteDomain ? new Date() : undefined,
    },
  });

  const sender = await prisma.emailSenderIdentity.upsert({
    where: { storeId_fromEmail: { storeId: input.storeId, fromEmail } },
    create: {
      organizationId: input.user.organizationId,
      storeId: input.storeId,
      domainId: domain.id,
      displayName,
      fromEmail,
      replyToEmail,
      status:
        domain.status === EmailSenderDomainStatus.VERIFIED
          ? EmailSenderIdentityStatus.VERIFIED
          : EmailSenderIdentityStatus.PENDING,
    },
    update: {
      domainId: domain.id,
      displayName,
      replyToEmail,
      archivedAt: null,
      status:
        domain.status === EmailSenderDomainStatus.VERIFIED
          ? EmailSenderIdentityStatus.VERIFIED
          : EmailSenderIdentityStatus.PENDING,
    },
    include: { domain: true },
  });

  await writeAuditLog(prisma, {
    organizationId: input.user.organizationId,
    actorId: input.actorId,
    action: "EMAIL_SENDER_UPSERT",
    entity: "EmailSenderIdentity",
    entityId: sender.id,
    before: null,
    after: toJson({ storeId: input.storeId, fromEmail, domain: domainName }),
    requestId: input.requestId,
  });

  return sender;
};

export const checkEmailSenderDomain = async (input: {
  user: StoreAccessUser;
  actorId: string;
  requestId: string;
  domainId: string;
  triggerVerification?: boolean;
}) => {
  const domain = await prisma.emailSenderDomain.findFirst({
    where: {
      id: input.domainId,
      organizationId: input.user.organizationId,
    },
  });
  if (!domain) {
    throw new AppError("emailSenderDomainNotFound", "NOT_FOUND", 404);
  }
  await assertUserCanAccessStore(prisma, input.user, domain.storeId);
  if (!domain.resendDomainId) {
    throw new AppError("emailSenderDomainNotConfigured", "BAD_REQUEST", 400);
  }
  if (input.triggerVerification) {
    await verifyResendDomain(domain.resendDomainId);
  }
  const remote = await retrieveResendDomain(domain.resendDomainId);
  const status = resendStatusToDomainStatus(remote.status);
  const updated = await prisma.emailSenderDomain.update({
    where: { id: domain.id },
    data: {
      status,
      resendStatus: remote.status,
      recordsJson: normalizeResendRecords(remote.records) as unknown as Prisma.InputJsonValue,
      lastCheckedAt: new Date(),
      verifiedAt: status === EmailSenderDomainStatus.VERIFIED ? new Date() : domain.verifiedAt,
      errorMessage: status === EmailSenderDomainStatus.FAILED ? "emailSenderDomainFailed" : null,
      senders: {
        updateMany: {
          where: { archivedAt: null },
          data: {
            status:
              status === EmailSenderDomainStatus.VERIFIED
                ? EmailSenderIdentityStatus.VERIFIED
                : status === EmailSenderDomainStatus.FAILED
                  ? EmailSenderIdentityStatus.FAILED
                  : EmailSenderIdentityStatus.PENDING,
          },
        },
      },
    },
  });
  await writeAuditLog(prisma, {
    organizationId: input.user.organizationId,
    actorId: input.actorId,
    action: input.triggerVerification ? "EMAIL_DOMAIN_VERIFY" : "EMAIL_DOMAIN_CHECK",
    entity: "EmailSenderDomain",
    entityId: updated.id,
    before: toJson({ status: domain.status }),
    after: toJson({ status: updated.status, resendStatus: updated.resendStatus }),
    requestId: input.requestId,
  });
  return updated;
};

export const archiveEmailSenderIdentity = async (input: {
  user: StoreAccessUser;
  actorId: string;
  requestId: string;
  senderId: string;
}) => {
  const sender = await prisma.emailSenderIdentity.findFirst({
    where: { id: input.senderId, organizationId: input.user.organizationId },
  });
  if (!sender) {
    throw new AppError("emailSenderNotFound", "NOT_FOUND", 404);
  }
  await assertUserCanAccessStore(prisma, input.user, sender.storeId);
  const updated = await prisma.emailSenderIdentity.update({
    where: { id: sender.id },
    data: { archivedAt: new Date() },
  });
  await writeAuditLog(prisma, {
    organizationId: input.user.organizationId,
    actorId: input.actorId,
    action: "EMAIL_SENDER_ARCHIVE",
    entity: "EmailSenderIdentity",
    entityId: sender.id,
    before: toJson({ archivedAt: sender.archivedAt }),
    after: toJson({ archivedAt: updated.archivedAt }),
    requestId: input.requestId,
  });
  return updated;
};

const resolveCampaignSender = async (input: {
  user?: StoreAccessUser | null;
  organizationId: string;
  storeId: string;
  senderIdentityId?: string | null;
  senderDisplayName?: string | null;
  replyToEmail?: string | null;
  requireVerified: boolean;
}) => {
  if (input.senderIdentityId) {
    const sender = await prisma.emailSenderIdentity.findFirst({
      where: {
        id: input.senderIdentityId,
        organizationId: input.organizationId,
        storeId: input.storeId,
        archivedAt: null,
      },
      include: { domain: true },
    });
    if (!sender) {
      throw new AppError("emailSenderNotFound", "NOT_FOUND", 404);
    }
    if (
      sender.status !== EmailSenderIdentityStatus.VERIFIED ||
      sender.domain?.status !== EmailSenderDomainStatus.VERIFIED ||
      emailDomain(sender.fromEmail) !== sender.domain.domain
    ) {
      throw new AppError("emailSenderNotVerified", "BAD_REQUEST", 400);
    }
    return {
      id: sender.id,
      fromEmail: sender.fromEmail,
      from: formatEmailAddress({ name: sender.displayName, email: sender.fromEmail }),
      replyTo: sender.replyToEmail,
      displayName: sender.displayName,
      demoOnly: false,
    };
  }

  const config = getMarketingEmailConfiguration();
  if (config.ready) {
    return {
      id: null,
      fromEmail: MARKETING_EMAIL_FROM,
      from: formatEmailAddress({
        name: trimOptional(input.senderDisplayName) ?? "Bazaar",
        email: MARKETING_EMAIL_FROM,
      }),
      replyTo: trimOptional(input.replyToEmail),
      displayName: trimOptional(input.senderDisplayName) ?? "Bazaar",
      demoOnly: false,
    };
  }

  throw new AppError("emailSenderRequired", "BAD_REQUEST", 400);
};


export const listEmailMarketingCustomers = async (input: {
  user: StoreAccessUser;
  storeId: string;
  search?: string | null;
  source?: CustomerSource | "ALL" | null;
  page?: number;
  pageSize?: number;
  includeSelectableIds?: boolean;
}) => {
  await assertUserCanAccessStore(prisma, input.user, input.storeId);
  const search = trimOptional(input.search);
  const source = input.source && input.source !== "ALL" ? input.source : null;
  const page = Math.max(1, Math.trunc(input.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(input.pageSize ?? 25)));
  const where: Prisma.CustomerWhereInput = {
    organizationId: input.user.organizationId,
    storeId: input.storeId,
    deletedAt: null,
    ...(source ? { source } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
            { phone: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const selectableWhere: Prisma.CustomerWhereInput = {
    ...where,
    emailMarketingUnsubscribedAt: null,
    email: { not: null },
  };
  const [total, customers, selectableCandidates] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        source: true,
        createdAt: true,
        orderCount: true,
        emailMarketingUnsubscribedAt: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    input.includeSelectableIds
      ? prisma.customer.findMany({
          where: selectableWhere,
          select: {
            id: true,
            email: true,
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 5_500,
        })
      : Promise.resolve([]),
  ]);
  const selectableIds = input.includeSelectableIds
    ? selectableCandidates
        .filter((customer) => isValidEmail(customer.email))
        .slice(0, 5_000)
        .map((customer) => customer.id)
    : [];

  return {
    items: customers.map((customer) => ({
      ...customer,
      hasValidEmail: isValidEmail(customer.email),
      isUnsubscribed: Boolean(customer.emailMarketingUnsubscribedAt),
    })),
    total,
    page,
    pageSize,
    selectableIds,
    selectableCount: selectableIds.length,
    selectableLimitReached: input.includeSelectableIds
      ? selectableCandidates.length >= 5_500 || selectableIds.length >= 5_000
      : false,
  };
};

const selectedProductIdsFromBlocks = (blocks: EmailCampaignBlock[]) =>
  Array.from(
    new Set(
      blocks.flatMap((block) =>
        block.type === "products" ? (block.productIds ?? []).filter(Boolean) : [],
      ),
    ),
  );

const formatProductPrice = (priceKgs: number | null, store: EmailMarketingStore) =>
  priceKgs === null
    ? null
    : formatKgsMoney(priceKgs, "ru", {
        currencyCode: store.currencyCode,
        currencyRateKgsPerUnit: store.currencyRateKgsPerUnit,
      });

const productImageUrl = (product: { photoUrl: string | null; images: Array<{ url: string }> }) =>
  resolveEmailMarketingAssetUrl(product.images[0]?.url) ??
  resolveEmailMarketingAssetUrl(product.photoUrl);

const loadEmailMarketingProductsByIds = async (input: {
  organizationId: string;
  store: EmailMarketingStore;
  productIds: string[];
  requireAll?: boolean;
}) => {
  if (!input.productIds.length) {
    return new Map<string, EmailMarketingProduct>();
  }
  const products = await prisma.product.findMany({
    where: {
      organizationId: input.organizationId,
      id: { in: input.productIds },
      isDeleted: false,
      storeProducts: {
        some: {
          organizationId: input.organizationId,
          storeId: input.store.id,
          isActive: true,
        },
      },
    },
    select: {
      id: true,
      name: true,
      description: true,
      photoUrl: true,
      basePriceKgs: true,
      images: {
        where: { url: { not: { startsWith: "data:image/" } } },
        select: { url: true },
        orderBy: { position: "asc" },
        take: 1,
      },
      storePrices: {
        where: {
          organizationId: input.organizationId,
          storeId: input.store.id,
          variantKey: "BASE",
        },
        select: { priceKgs: true },
        take: 1,
      },
    },
  });
  if (input.requireAll && products.length !== input.productIds.length) {
    throw new AppError("emailCampaignProductInvalid", "BAD_REQUEST", 400);
  }

  return new Map(
    products.map((product) => {
      const priceKgs =
        product.storePrices[0]?.priceKgs !== undefined && product.storePrices[0]?.priceKgs !== null
          ? Number(product.storePrices[0].priceKgs)
          : product.basePriceKgs !== null
            ? Number(product.basePriceKgs)
            : null;
      const catalogUrl =
        input.store.bazaarCatalog?.status === BazaarCatalogStatus.PUBLISHED
          ? resolveEmailLinkUrl(input.store.bazaarCatalog.publicUrlPath, getPublicAppBaseUrl())
          : null;
      return [
        product.id,
        {
          id: product.id,
          name: product.name,
          description: product.description,
          imageUrl: productImageUrl(product),
          priceKgs,
          priceText: formatProductPrice(priceKgs, input.store),
          currencyCode: input.store.currencyCode,
          publicUrl: null,
          catalogUrl,
        },
      ] as const;
    }),
  );
};

export const searchEmailMarketingProducts = async (input: {
  user: StoreAccessUser;
  storeId: string;
  search?: string | null;
  category?: string | null;
  limit?: number;
  includeIds?: string[];
}) => {
  await assertUserCanAccessStore(prisma, input.user, input.storeId);
  const brand = await getStoreBrand({
    organizationId: input.user.organizationId,
    storeId: input.storeId,
  });
  const search = trimOptional(input.search);
  const category = trimOptional(input.category);
  const includeIds = Array.from(new Set((input.includeIds ?? []).filter(Boolean)));
  const productScopeWhere: Prisma.ProductWhereInput = {
    organizationId: input.user.organizationId,
    isDeleted: false,
    storeProducts: {
      some: {
        organizationId: input.user.organizationId,
        storeId: input.storeId,
        isActive: true,
      },
    },
  };
  const categoryFilter: Prisma.ProductWhereInput | null = category
    ? { OR: [{ category }, { categories: { has: category } }] }
    : null;
  const searchFilter: Prisma.ProductWhereInput | null = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          ...(brand.store.enableSku
            ? [{ sku: { contains: search, mode: "insensitive" as const } }]
            : []),
          ...(brand.store.enableBarcode
            ? [
                {
                  barcodes: {
                    some: { value: { contains: search, mode: "insensitive" as const } },
                  },
                },
              ]
            : []),
        ],
      }
    : null;
  const buildWhere = (filters: Prisma.ProductWhereInput[]): Prisma.ProductWhereInput => ({
    ...productScopeWhere,
    ...(filters.length ? { AND: filters } : {}),
  });
  const baseFilters = categoryFilter ? [categoryFilter] : [];
  const baseWhere = buildWhere(baseFilters);
  const productSelect = {
    id: true,
    name: true,
    sku: true,
    category: true,
    categories: true,
    description: true,
    photoUrl: true,
    basePriceKgs: true,
    barcodes: { select: { value: true }, take: 1 },
    images: {
      where: { url: { not: { startsWith: "data:image/" } } },
      select: { url: true },
      orderBy: { position: "asc" as const },
      take: 1,
    },
    storePrices: {
      where: {
        organizationId: input.user.organizationId,
        storeId: input.storeId,
        variantKey: "BASE",
      },
      select: { priceKgs: true },
      take: 1,
    },
  } satisfies Prisma.ProductSelect;
  const searchWhere = buildWhere(searchFilter ? [...baseFilters, searchFilter] : baseFilters);

  const [searchProducts, includedProducts] = await Promise.all([
    prisma.product.findMany({
      where: searchWhere,
      select: productSelect,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: Math.min(50, Math.max(1, input.limit ?? 20)),
    }),
    includeIds.length
      ? prisma.product.findMany({
          where: {
            ...baseWhere,
            id: { in: includeIds },
          },
          select: productSelect,
          orderBy: [{ name: "asc" }, { id: "asc" }],
        })
      : Promise.resolve([]),
  ]);
  const productById = new Map(searchProducts.map((product) => [product.id, product]));
  for (const product of includedProducts) {
    productById.set(product.id, product);
  }
  const products = Array.from(productById.values());

  return {
    store: {
      currencyCode: brand.store.currencyCode,
      currencyRateKgsPerUnit: Number(brand.store.currencyRateKgsPerUnit),
      enableSku: brand.store.enableSku,
      enableBarcode: brand.store.enableBarcode,
    },
    categories: Array.from(
      new Set(
        products
          .flatMap((product) =>
            product.categories?.length ? product.categories : [product.category],
          )
          .filter(Boolean),
      ),
    ),
    items: products.map((product) => {
      const priceKgs =
        product.storePrices[0]?.priceKgs !== undefined && product.storePrices[0]?.priceKgs !== null
          ? Number(product.storePrices[0].priceKgs)
          : product.basePriceKgs !== null
            ? Number(product.basePriceKgs)
            : null;
      return {
        id: product.id,
        name: product.name,
        sku: brand.store.enableSku ? product.sku : null,
        barcode: brand.store.enableBarcode ? (product.barcodes[0]?.value ?? null) : null,
        category: product.categories[0] ?? product.category ?? null,
        description: product.description,
        imageUrl: productImageUrl(product),
        priceKgs,
        priceText: formatProductPrice(priceKgs, brand.store),
        currencyCode: brand.store.currencyCode,
        hasImage: Boolean(productImageUrl(product)),
        hasPrice: priceKgs !== null,
      };
    }),
  };
};

const collectEmailImageUrls = (input: {
  campaign: NormalizedEmailCampaign;
  productsById: Map<string, EmailMarketingProduct>;
  logoUrl?: string | null;
}) => {
  const urls: string[] = [];
  if (input.logoUrl) {
    urls.push(input.logoUrl);
  }
  for (const block of input.campaign.blocks) {
    if (block.type === "hero") {
      const imageUrl = resolveEmailMarketingAssetUrl(block.imageUrl);
      if (imageUrl) {
        urls.push(imageUrl);
      }
    }
    if (block.type === "products" && (block.showImage ?? true)) {
      for (const productId of block.productIds ?? []) {
        const imageUrl = input.productsById.get(productId)?.imageUrl;
        if (imageUrl) {
          urls.push(imageUrl);
        }
      }
    }
  }
  return Array.from(new Set(urls));
};

export const collectNonPublicEmailImageUrls = (input: {
  campaign: NormalizedEmailCampaign;
  productsById?: Map<string, EmailMarketingProduct>;
  logoUrl?: string | null;
}) =>
  collectEmailImageUrls({
    campaign: input.campaign,
    productsById: input.productsById ?? new Map<string, EmailMarketingProduct>(),
    logoUrl: input.logoUrl,
  }).filter((url) => !isPublicEmailMarketingAssetUrl(url));

const assertEmailImagesPublic = (input: {
  campaign: NormalizedEmailCampaign;
  productsById: Map<string, EmailMarketingProduct>;
  logoUrl?: string | null;
}) => {
  const nonPublicImageUrls = collectNonPublicEmailImageUrls(input);
  if (nonPublicImageUrls.length) {
    throw new AppError(nonPublicEmailImageErrorCode(), "BAD_REQUEST", 400);
  }
};

const collectWarnings = (input: {
  campaign: NormalizedEmailCampaign;
  store: EmailMarketingStore;
  productsById: Map<string, EmailMarketingProduct>;
  logoSourceUrl?: string | null;
  logoUrl?: string | null;
  baseUrl?: string | null;
}) => {
  const warnings: EmailCampaignWarning[] = [];
  if (!input.campaign.subject.trim()) {
    warnings.push({ code: "subjectMissing", message: "Не указана тема письма." });
  }
  if (!input.campaign.blocks.some(blockHasMeaningfulContent)) {
    warnings.push({
      code: "contentMissing",
      message: "Добавьте хотя бы один содержательный блок.",
    });
  }
  for (const block of input.campaign.blocks) {
    if (block.type === "hero") {
      if (!trimOptional(block.imageUrl)) {
        warnings.push({
          code: "heroImageMissing",
          message: "В баннере не указано изображение.",
          blockId: block.id,
        });
      } else if (!resolveEmailMarketingAssetUrl(block.imageUrl)) {
        warnings.push({
          code: "heroImageInvalid",
          message: "Изображение баннера должно быть доступно по абсолютному URL.",
          blockId: block.id,
        });
      }
      if (trimOptional(block.buttonText) && !resolveEmailLinkUrl(block.buttonUrl, input.baseUrl)) {
        warnings.push({
          code: "heroButtonUrlMissing",
          message: "У кнопки баннера нет корректной ссылки.",
          blockId: block.id,
        });
      }
    }
    if (block.type === "button" && !resolveEmailLinkUrl(block.url, input.baseUrl)) {
      warnings.push({
        code: "buttonUrlMissing",
        message: "У CTA-кнопки нет корректной ссылки.",
        blockId: block.id,
      });
    }
    if (block.type === "products") {
      const ids = block.productIds ?? [];
      if (!ids.length) {
        warnings.push({
          code: "productsMissing",
          message: "В блоке товаров не выбраны товары.",
          blockId: block.id,
        });
      }
      for (const id of ids) {
        const product = input.productsById.get(id);
        if (!product) {
          warnings.push({
            code: "productUnavailable",
            message: "Один из товаров недоступен для выбранного магазина.",
            blockId: block.id,
          });
          continue;
        }
        if (!product.imageUrl) {
          warnings.push({
            code: "productImageMissing",
            message: `У товара "${product.name}" нет изображения.`,
            blockId: block.id,
          });
        }
        if (product.priceKgs === null) {
          warnings.push({
            code: "productPriceMissing",
            message: `У товара "${product.name}" нет цены.`,
            blockId: block.id,
          });
        }
        const hasButtonUrl =
          resolveEmailLinkUrl(block.buttonUrl, input.baseUrl) ||
          product.publicUrl ||
          (input.store.bazaarCatalog?.status === BazaarCatalogStatus.PUBLISHED
            ? resolveEmailLinkUrl(input.store.bazaarCatalog.publicUrlPath, input.baseUrl)
            : null);
        if ((block.showButton ?? true) && !hasButtonUrl) {
          warnings.push({
            code: "productLinkMissing",
            message: `Для товара "${product.name}" нет публичной ссылки. Укажите ссылку блока или отключите кнопку.`,
            blockId: block.id,
          });
        }
      }
    }
    if (
      block.type === "promo" &&
      trimOptional(block.buttonText) &&
      !resolveEmailLinkUrl(block.buttonUrl, input.baseUrl)
    ) {
      warnings.push({
        code: "promoButtonUrlMissing",
        message: "У промо-кнопки нет корректной ссылки.",
        blockId: block.id,
      });
    }
  }
  if (input.logoSourceUrl && !input.logoUrl) {
    warnings.push({
      code: "logoImageInvalid",
      message:
        "Логотип выбран, но его URL нельзя использовать в email. Проверьте публичный URL приложения.",
    });
  }
  if (
    collectNonPublicEmailImageUrls({
      campaign: input.campaign,
      productsById: input.productsById,
      logoUrl: input.logoUrl,
    }).length
  ) {
    warnings.push({
      code: "emailImagesNotPublic",
      message: nonPublicEmailImageWarningMessage(),
    });
  }
  return warnings;
};

const buildValidationChecklist = (input: {
  campaign: NormalizedEmailCampaign;
  senderOk: boolean;
  audienceSummary: AudienceSummary;
  warnings: EmailCampaignWarning[];
}) => {
  const warningCodes = new Set(input.warnings.map((warning) => warning.code));
  return [
    {
      key: "sender",
      label: "Отправитель подтвержден",
      ok: input.senderOk,
      critical: true,
    },
    {
      key: "subject",
      label: "Тема письма указана",
      ok: Boolean(input.campaign.subject.trim()),
      critical: true,
    },
    {
      key: "audience",
      label: "Есть получатели",
      ok:
        input.campaign.campaignType !== EmailCampaignType.MARKETING ||
        input.audienceSummary.validRecipients > 0,
      critical: input.campaign.campaignType === EmailCampaignType.MARKETING,
    },
    {
      key: "content",
      label: "Письмо содержит контент",
      ok: input.campaign.blocks.some(blockHasMeaningfulContent),
      critical: true,
    },
    {
      key: "products",
      label: "Товарные блоки корректны",
      ok: !warningCodes.has("productsMissing") && !warningCodes.has("productUnavailable"),
      critical: true,
    },
    {
      key: "links",
      label: "Основные ссылки заполнены",
      ok:
        !warningCodes.has("buttonUrlMissing") &&
        !warningCodes.has("heroButtonUrlMissing") &&
        !warningCodes.has("promoButtonUrlMissing") &&
        !warningCodes.has("productLinkMissing"),
      critical: false,
    },
  ];
};

const renderVariables = (
  value: string | null | undefined,
  input: {
    customerName?: string | null;
    store: EmailMarketingStore;
    currentDate: Date;
    discountCode?: string | null;
    unsubscribeUrl?: string | null;
    order?: EmailRenderOrder | null;
  },
) => {
  const text = value ?? "";
  const variables: Record<string, string> = {
    customerName: input.customerName?.trim() || "клиент",
    storeName: input.store.legalName?.trim() || input.store.name,
    storePhone: input.store.phone?.trim() || "",
    storeAddress: input.store.address?.trim() || "",
    currentDate: new Intl.DateTimeFormat("ru-KG").format(input.currentDate),
    discountCode: input.discountCode?.trim() || "",
    unsubscribeLink: input.unsubscribeUrl ?? "",
	    orderNumber: input.order?.number ?? "",
	    orderStatus: input.order?.status ?? "",
	    orderPreviousStatus: input.order?.previousStatus ?? "",
	    orderOldStatus: input.order?.previousStatus ?? "",
	    orderTotal: input.order?.totalText ?? "",
	  };
  return text.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (_match, key: string) => variables[key] ?? "");
};

const textToHtml = (value: string) =>
  escapeHtml(value)
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/\n/g, "<br />"))
    .join("<br /><br />");

const renderButton = (input: { href: string; text: string; color: string; textColor: string }) =>
  `<a href="${escapeHtml(input.href)}" style="display:inline-block;background:${input.color};color:${input.textColor};text-decoration:none;padding:12px 18px;border-radius:6px;font-weight:700;">${escapeHtml(input.text)}</a>`;

const normalizeBlockAlignment = (alignment?: string | null): EmailBlockAlignment =>
  alignment === "center" || alignment === "right" ? alignment : "left";

const imageMarginForAlignment = (alignment: EmailBlockAlignment, bottomMargin = 8) => {
  if (alignment === "center") {
    return `0 auto ${bottomMargin}px`;
  }
  if (alignment === "right") {
    return `0 0 ${bottomMargin}px auto`;
  }
  return `0 0 ${bottomMargin}px`;
};

export const renderEmailCampaign = (input: {
  campaign: NormalizedEmailCampaign;
  store: EmailMarketingStore;
  productsById?: Map<string, EmailMarketingProduct>;
  logoUrl?: string | null;
  unsubscribeUrl?: string | null;
  recipient?: { name?: string | null; email?: string | null } | null;
  order?: EmailRenderOrder | null;
  baseUrl?: string | null;
}) => {
  const productsById = input.productsById ?? new Map<string, EmailMarketingProduct>();
  const storeName = input.store.legalName?.trim() || input.store.name;
  const fontFamily = cssFontFamily(input.campaign.fontFamily);
  const {
    backgroundColor,
    contentBackgroundColor,
    textColor,
    mutedTextColor,
    borderColor,
    brandColor,
    buttonColor,
    buttonTextColor,
  } = input.campaign;
  const currentDate = new Date();
  const discountCode =
    input.campaign.blocks.find(
      (block) => block.type === "promo" && trimOptional(block.discountCode),
    )?.type === "promo"
      ? trimOptional(
          (
            input.campaign.blocks.find(
              (block) => block.type === "promo" && trimOptional(block.discountCode),
            ) as Extract<EmailCampaignBlock, { type: "promo" }> | undefined
          )?.discountCode,
        )
      : null;
  const variableContext = {
    customerName: input.recipient?.name,
    store: input.store,
    currentDate,
    discountCode,
    unsubscribeUrl: input.unsubscribeUrl,
    order: input.order ?? null,
  };
  const preheader = input.campaign.preheader
    ? escapeHtml(renderVariables(input.campaign.preheader, variableContext))
    : "";
  const htmlParts: string[] = [];
  const textParts: string[] = [];

  for (const block of input.campaign.blocks) {
    if (block.type === "header") {
      const alignment = normalizeBlockAlignment(block.alignment);
      const heading = trimOptional(renderVariables(block.heading, variableContext));
      const headerStoreName =
        trimOptional(renderVariables(block.storeName, variableContext)) ?? storeName;
      const showLogo = block.showLogo ?? true;
      const showStoreName = block.showStoreName ?? true;
      htmlParts.push(`
        <div style="padding:22px 24px;border-bottom:1px solid ${borderColor};text-align:${alignment};">
          ${
            showLogo && input.logoUrl
              ? `<img src="${escapeHtml(input.logoUrl)}" alt="${escapeHtml(headerStoreName)}" width="140" style="display:block;width:140px;max-width:100%;max-height:120px;height:auto;object-fit:contain;margin:${imageMarginForAlignment(alignment)};" />`
              : ""
          }
          ${showStoreName ? `<div style="font-size:18px;font-weight:800;color:${brandColor};">${escapeHtml(headerStoreName)}</div>` : ""}
          ${heading ? `<div style="margin-top:8px;color:${mutedTextColor};font-size:14px;line-height:1.5;">${escapeHtml(heading)}</div>` : ""}
        </div>
      `);
      textParts.push([showStoreName ? headerStoreName : null, heading].filter(Boolean).join("\n"));
    }

    if (block.type === "hero") {
      const alignment = normalizeBlockAlignment(block.alignment);
      const imageUrl = resolveEmailMarketingAssetUrl(block.imageUrl);
      const heading = trimOptional(renderVariables(block.heading, variableContext));
      const subtitle = trimOptional(renderVariables(block.subtitle, variableContext));
      const buttonText = trimOptional(renderVariables(block.buttonText, variableContext));
      const buttonUrl = resolveEmailLinkUrl(block.buttonUrl, input.baseUrl);
      htmlParts.push(`
        <div style="padding:24px;text-align:${alignment};">
          ${
            imageUrl
              ? `<img src="${escapeHtml(imageUrl)}" alt="" style="display:block;width:100%;height:auto;max-height:300px;object-fit:cover;margin:0 0 20px;" />`
              : ""
          }
          ${heading ? `<h1 style="margin:0 0 10px;color:${brandColor};font-size:26px;line-height:1.2;">${escapeHtml(heading)}</h1>` : ""}
          ${subtitle ? `<p style="margin:0 0 18px;color:${textColor};font-size:15px;line-height:1.65;">${textToHtml(subtitle)}</p>` : ""}
          ${buttonText && buttonUrl ? `<p style="margin:20px 0 0;">${renderButton({ href: buttonUrl, text: buttonText, color: buttonColor, textColor: buttonTextColor })}</p>` : ""}
        </div>
      `);
      textParts.push(
        [heading, subtitle, buttonText && buttonUrl ? `${buttonText}: ${buttonUrl}` : null]
          .filter(Boolean)
          .join("\n\n"),
      );
    }

    if (block.type === "text") {
      const alignment = normalizeBlockAlignment(block.alignment);
      const heading = trimOptional(renderVariables(block.heading, variableContext));
      const body = trimOptional(renderVariables(block.body, variableContext));
      htmlParts.push(`
        <div style="padding:8px 24px 22px;text-align:${alignment};">
          ${heading ? `<h2 style="margin:0 0 10px;color:${textColor};font-size:20px;line-height:1.3;">${escapeHtml(heading)}</h2>` : ""}
          ${body ? `<div style="color:${mutedTextColor};font-size:15px;line-height:1.65;">${textToHtml(body)}</div>` : ""}
        </div>
      `);
      textParts.push([heading, body].filter(Boolean).join("\n\n"));
    }

    if (block.type === "button") {
      const alignment = normalizeBlockAlignment(block.alignment);
      const text = trimOptional(renderVariables(block.text, variableContext));
      const href = resolveEmailLinkUrl(block.url, input.baseUrl);
      if (text && href) {
        htmlParts.push(`
          <div style="padding:8px 24px 24px;text-align:${alignment};">
            ${renderButton({ href, text, color: buttonColor, textColor: buttonTextColor })}
          </div>
        `);
        textParts.push(`${text}: ${href}`);
      }
    }

    if (block.type === "products") {
      const alignment = normalizeBlockAlignment(block.alignment);
      const ids = block.productIds ?? [];
      const selectedProducts = ids.flatMap((id) => {
        const product = productsById.get(id);
        return product ? [product] : [];
      });
      const showImage = block.showImage ?? true;
      const showPrice = block.showPrice ?? true;
      const showDescription = block.showDescription ?? true;
      const showButton = block.showButton ?? true;
      const buttonText =
        trimOptional(renderVariables(block.buttonText, variableContext)) ?? "Подробнее";
      const blockUrl = resolveEmailLinkUrl(block.buttonUrl, input.baseUrl);
      const catalogUrl =
        input.store.bazaarCatalog?.status === BazaarCatalogStatus.PUBLISHED
          ? resolveEmailLinkUrl(input.store.bazaarCatalog.publicUrlPath, input.baseUrl)
          : null;
      const layout = block.layout === "one" ? "one" : "two";
      const cells = selectedProducts.map((product) => {
        const href = blockUrl ?? product.publicUrl ?? catalogUrl;
        return `
          <td style="width:${layout === "two" ? "50%" : "100%"};padding:8px;vertical-align:top;">
            <div style="border:1px solid ${borderColor};padding:14px;background:${contentBackgroundColor};text-align:${alignment};">
              ${
                showImage && product.imageUrl
                  ? `<img src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.name)}" style="display:block;width:100%;height:auto;margin:0 0 12px;" />`
                  : showImage
                    ? `<div style="background:${backgroundColor};color:${mutedTextColor};font-size:13px;line-height:1.4;padding:28px 12px;text-align:center;margin:0 0 12px;">Фото товара</div>`
                    : ""
              }
              <h3 style="margin:0 0 8px;color:${textColor};font-size:16px;line-height:1.35;">${escapeHtml(product.name)}</h3>
              ${
                showDescription && product.description
                  ? `<p style="margin:0 0 10px;color:${mutedTextColor};font-size:13px;line-height:1.45;">${escapeHtml(product.description.slice(0, 140))}</p>`
                  : ""
              }
              ${
                showPrice && product.priceText
                  ? `<p style="margin:0 0 12px;color:${textColor};font-size:15px;font-weight:800;">${escapeHtml(product.priceText)}</p>`
                  : ""
              }
              ${showButton && href ? renderButton({ href, text: buttonText, color: buttonColor, textColor: buttonTextColor }) : ""}
            </div>
          </td>
        `;
      });
      const rows: string[] = [];
      for (let index = 0; index < cells.length; index += layout === "two" ? 2 : 1) {
        rows.push(`<tr>${cells.slice(index, index + (layout === "two" ? 2 : 1)).join("")}</tr>`);
      }
      if (rows.length) {
        htmlParts.push(`
          <div style="padding:8px 16px 24px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
              ${rows.join("")}
            </table>
          </div>
        `);
        textParts.push(
          selectedProducts
            .map((product) =>
              [
                product.name,
                showDescription ? product.description : null,
                showPrice ? product.priceText : null,
              ]
                .filter(Boolean)
                .join(" - "),
            )
            .join("\n"),
        );
      }
    }

	    if (block.type === "orderSummary") {
	      const alignment = normalizeBlockAlignment(block.alignment);
	      const title =
	        trimOptional(renderVariables(block.title, variableContext)) ?? "Сводка заказа";
	      const summaryText = trimOptional(
	        renderVariables(block.summaryText ?? "Заказ {{orderNumber}} · {{orderStatus}}", variableContext),
	      );
	      const itemsLabel = trimOptional(renderVariables(block.itemsLabel ?? "Товары", variableContext));
	      const totalLabel =
	        trimOptional(renderVariables(block.totalLabel ?? "Итого", variableContext)) ?? "Итого";
	      const emptyOrderText =
	        trimOptional(
	          renderVariables(
	            block.emptyOrderText ?? "Данные заказа появятся при отправке автоматизации.",
	            variableContext,
	          ),
	        ) ?? "";
	      const quantitySeparator =
	        trimOptional(renderVariables(block.quantitySeparator ?? "×", variableContext)) ?? "×";
	      const showItems = block.showItems ?? true;
	      const showTotals = block.showTotals ?? true;
	      const showSummary = block.showSummary ?? true;
	      const order = input.order;
	      const itemRows =
	        order && showItems
	          ? order.lines
	              .map(
	                (line) => `
	                  <tr>
	                    <td style="padding:8px 0;border-bottom:1px solid ${borderColor};color:${textColor};font-size:14px;">${escapeHtml(line.name)} ${escapeHtml(quantitySeparator)} ${line.qty}</td>
	                    <td style="padding:8px 0;border-bottom:1px solid ${borderColor};color:${textColor};font-size:14px;text-align:right;">${escapeHtml(line.totalText)}</td>
	                  </tr>
	                `,
              )
              .join("")
          : "";
      htmlParts.push(`
        <div style="padding:8px 24px 24px;">
	          <div style="border:1px solid ${borderColor};padding:16px;background:${contentBackgroundColor};text-align:${alignment};">
	            <h2 style="margin:0 0 12px;color:${textColor};font-size:20px;line-height:1.3;text-align:${alignment};">${escapeHtml(title)}</h2>
	            ${
	              showSummary && summaryText
	                ? `<p style="margin:0 0 12px;color:${mutedTextColor};font-size:14px;line-height:1.5;text-align:${alignment};">${escapeHtml(summaryText)}</p>`
	                : !order && emptyOrderText
	                  ? `<p style="margin:0 0 12px;color:${mutedTextColor};font-size:14px;line-height:1.5;text-align:${alignment};">${escapeHtml(emptyOrderText)}</p>`
	                  : ""
	            }
	            ${
	              itemRows
	                ? `${itemsLabel ? `<div style="margin:0 0 6px;color:${mutedTextColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;">${escapeHtml(itemsLabel)}</div>` : ""}<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">${itemRows}</table>`
	                : ""
	            }
	            ${
	              order && showTotals
	                ? `<p style="margin:14px 0 0;color:${textColor};font-size:16px;font-weight:800;text-align:${alignment};">${escapeHtml(totalLabel)}: ${escapeHtml(order.totalText)}</p>`
	                : ""
	            }
	          </div>
        </div>
      `);
	      textParts.push(
	        order
	          ? [
	              title,
	              showSummary ? summaryText : null,
	              itemsLabel,
	              ...order.lines.map((line) => `${line.name} ${quantitySeparator} ${line.qty}: ${line.totalText}`),
	              showTotals ? `${totalLabel}: ${order.totalText}` : null,
	            ]
	              .filter(Boolean)
	              .join("\n")
	          : [
	              title,
	              emptyOrderText,
	            ].join("\n")
	      );
	    }

    if (block.type === "promo") {
      const alignment = normalizeBlockAlignment(block.alignment);
      const title = trimOptional(renderVariables(block.title, variableContext));
      const code = trimOptional(renderVariables(block.discountCode, variableContext));
      const description = trimOptional(renderVariables(block.description, variableContext));
      const expiryText = trimOptional(renderVariables(block.expiryText, variableContext));
      const buttonText = trimOptional(renderVariables(block.buttonText, variableContext));
      const buttonUrl = resolveEmailLinkUrl(block.buttonUrl, input.baseUrl);
      htmlParts.push(`
        <div style="padding:8px 24px 24px;">
          <div style="border:1px solid ${brandColor};background:${backgroundColor};padding:18px;text-align:${alignment};">
            ${title ? `<h2 style="margin:0 0 8px;color:${textColor};font-size:22px;line-height:1.25;">${escapeHtml(title)}</h2>` : ""}
            ${code ? `<div style="display:inline-block;border:1px dashed ${brandColor};background:${contentBackgroundColor};color:${textColor};padding:8px 12px;margin:4px 0 10px;font-size:18px;font-weight:800;letter-spacing:1px;">${escapeHtml(code)}</div>` : ""}
            ${description ? `<p style="margin:0 0 8px;color:${mutedTextColor};font-size:15px;line-height:1.6;">${textToHtml(description)}</p>` : ""}
            ${expiryText ? `<p style="margin:0 0 12px;color:${mutedTextColor};font-size:13px;line-height:1.5;">${escapeHtml(expiryText)}</p>` : ""}
            ${buttonText && buttonUrl ? renderButton({ href: buttonUrl, text: buttonText, color: buttonColor, textColor: buttonTextColor }) : ""}
          </div>
        </div>
      `);
      textParts.push(
        [title, code ? `Промокод: ${code}` : null, description, expiryText]
          .filter(Boolean)
          .join("\n\n"),
      );
    }

    if (block.type === "divider") {
      htmlParts.push(
        `<div style="padding:8px 24px 24px;"><div style="border-top:1px solid ${borderColor};height:1px;line-height:1px;">&nbsp;</div></div>`,
      );
    }

    if (block.type === "footer") {
      const alignment = normalizeBlockAlignment(block.alignment);
      const customStoreName = trimOptional(renderVariables(block.storeName, variableContext));
      const phone =
        trimOptional(renderVariables(block.phone, variableContext)) ?? input.store.phone;
      const address =
        trimOptional(renderVariables(block.address, variableContext)) ?? input.store.address;
      const text =
        trimOptional(renderVariables(block.text, variableContext)) ??
        "Вы получили это письмо, потому что ваш email есть в базе клиентов магазина.";
      const showUnsubscribe = block.showUnsubscribe ?? true;
      const unsubscribeText =
        trimOptional(renderVariables(block.unsubscribeText, variableContext)) ??
        (input.unsubscribeUrl ? "Отписаться от рассылки" : "Для отписки свяжитесь с магазином.");
      const unsubscribeHtml =
        showUnsubscribe && input.unsubscribeUrl
          ? `<a href="${escapeHtml(input.unsubscribeUrl)}" style="color:${brandColor};text-decoration:underline;">${escapeHtml(unsubscribeText)}</a>`
          : showUnsubscribe
            ? escapeHtml(unsubscribeText)
            : "";
      htmlParts.push(`
        <div style="padding:18px 24px;border-top:1px solid ${borderColor};color:${mutedTextColor};font-size:12px;line-height:1.55;text-align:${alignment};">
          <p style="margin:0 0 8px;">${escapeHtml(text)}</p>
          <p style="margin:0;">${escapeHtml(customStoreName ?? storeName)}${phone ? ` · ${escapeHtml(phone)}` : ""}${address ? ` · ${escapeHtml(address)}` : ""}</p>
          ${unsubscribeHtml ? `<p style="margin:8px 0 0;">${unsubscribeHtml}</p>` : ""}
        </div>
      `);
      textParts.push(
        [
          text,
          customStoreName ?? storeName,
          phone,
          address,
          showUnsubscribe && input.unsubscribeUrl
            ? `${unsubscribeText}: ${input.unsubscribeUrl}`
            : showUnsubscribe
              ? unsubscribeText
              : null,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }
  }

  const html = `
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
    <div style="background:${backgroundColor};padding:24px;font-family:${fontFamily};">
      <div style="max-width:640px;margin:0 auto;background:${contentBackgroundColor};border:1px solid ${borderColor};">
        ${htmlParts.join("")}
      </div>
    </div>
  `;

  return { html, text: textParts.filter(Boolean).join("\n\n") };
};

const prepareCampaignRenderData = async (input: {
  user: StoreAccessUser;
  campaign: NormalizedEmailCampaign;
  requireProducts?: boolean;
}) => {
  const brand = await getStoreBrand({
    organizationId: input.user.organizationId,
    storeId: input.campaign.storeId,
  });
  const logo = await resolveCampaignLogo({
    user: input.user,
    campaignStoreId: input.campaign.storeId,
    logoStoreId: input.campaign.logoStoreId,
  });
  const productsById = await loadEmailMarketingProductsByIds({
    organizationId: input.user.organizationId,
    store: brand.store,
    productIds: selectedProductIdsFromBlocks(input.campaign.blocks),
    requireAll: input.requireProducts,
  });
  return { brand, logo, productsById };
};

export const previewEmailCampaign = async (input: {
  user: StoreAccessUser;
  campaign: EmailCampaignComposerInput;
}) => {
  await assertUserCanAccessStore(prisma, input.user, input.campaign.storeId);
  const campaign = normalizeCampaignInput(input.campaign, {
    requireSubject: false,
    requireContent: false,
  });
  const { brand, logo, productsById } = await prepareCampaignRenderData({
    user: input.user,
    campaign,
  });
  const audience = await resolveCampaignRecipients({ user: input.user, campaign });
  const baseUrl = getPublicAppBaseUrl();
  const sender = await resolveCampaignSender({
    user: input.user,
    organizationId: input.user.organizationId,
    storeId: campaign.storeId,
    senderIdentityId: campaign.senderIdentityId,
    senderDisplayName: campaign.senderDisplayName,
    replyToEmail: campaign.replyToEmail,
    requireVerified: false,
  }).catch(() => null);
  const warnings = collectWarnings({
    campaign,
    store: brand.store,
    productsById,
    logoSourceUrl: logo.logoSourceUrl,
    logoUrl: logo.logoUrl,
    baseUrl,
  });
	  const rendered = renderEmailCampaign({
	    campaign: {
	      ...campaign,
	      brandColor: normalizeColor(campaign.brandColor, brand.brandColor),
	    },
	    store: brand.store,
	    logoUrl: logo.logoUrl,
	    productsById,
	    recipient: audience.recipients[0] ?? { name: "клиент" },
	    order:
	      campaign.campaignType === EmailCampaignType.TRANSACTIONAL
	        ? sampleOrderForPreview(brand.store, campaign)
	        : null,
	    baseUrl,
	  });
  return {
    reachableCustomers: audience.summary.validRecipients,
    audienceSummary: audience.summary,
    from: sender?.fromEmail ?? MARKETING_EMAIL_FROM,
    sender,
    rendered,
    warnings,
    validationChecklist: buildValidationChecklist({
      campaign,
      senderOk: Boolean(sender && (!sender.demoOnly || getMarketingEmailConfiguration().ready)),
      audienceSummary: audience.summary,
      warnings,
    }),
    products: Array.from(productsById.values()),
  };
};

export const sendTestEmailCampaign = async (input: {
  user: StoreAccessUser;
  actorId: string;
  requestId: string;
  campaign: EmailCampaignComposerInput;
  to: string;
  sampleCustomerId?: string | null;
}) => {
  await assertUserCanAccessStore(prisma, input.user, input.campaign.storeId);
  const testEmail = normalizeRecipientEmail(input.to);
  if (!emailPattern.test(testEmail)) {
    throw new AppError("emailCampaignTestRecipientInvalid", "BAD_REQUEST", 400);
  }
  const baseUrl = requireEmailMarketingPublicAppBaseUrl();
  getEmailUnsubscribeSecret();

  const campaign = normalizeCampaignInput(input.campaign, {
    requireSubject: true,
    requireContent: true,
  });
  const { brand, logo, productsById } = await prepareCampaignRenderData({
    user: input.user,
    campaign,
    requireProducts: true,
  });
  const sender = await resolveCampaignSender({
    user: input.user,
    organizationId: input.user.organizationId,
    storeId: campaign.storeId,
    senderIdentityId: campaign.senderIdentityId,
    senderDisplayName: campaign.senderDisplayName,
    replyToEmail: campaign.replyToEmail,
    requireVerified: true,
  });
  assertEmailImagesPublic({ campaign, productsById, logoUrl: logo.logoUrl });
  let sampleCustomer: { name: string | null; email: string | null } | null = null;
  if (input.sampleCustomerId) {
    sampleCustomer = await prisma.customer.findFirst({
      where: {
        id: input.sampleCustomerId,
        organizationId: input.user.organizationId,
        storeId: campaign.storeId,
        deletedAt: null,
      },
      select: { name: true, email: true },
    });
  }
  const rendered = renderEmailCampaign({
    campaign: {
      ...campaign,
      brandColor: normalizeColor(campaign.brandColor, brand.brandColor),
    },
    store: brand.store,
    logoUrl: logo.logoUrl,
    productsById,
    recipient: sampleCustomer ?? { name: "клиент", email: testEmail },
    baseUrl,
  });
  await sendMarketingEmail({
    to: testEmail,
    subject: campaign.subject,
    html: rendered.html,
    text: rendered.text,
    from: sender.from,
    replyTo: sender.replyTo ?? campaign.replyToEmail,
    tags: [
      { name: "category", value: "email_marketing_test" },
      { name: "store_id", value: campaign.storeId.slice(0, 64) },
    ],
  });
  await writeAuditLog(prisma, {
    organizationId: input.user.organizationId,
    actorId: input.actorId,
    action: "EMAIL_CAMPAIGN_TEST_SEND",
    entity: "EmailCampaign",
    entityId: campaign.storeId,
    before: null,
    after: toJson({ storeId: campaign.storeId, subject: campaign.subject, to: testEmail }),
    requestId: input.requestId,
  });
  return { ok: true as const, to: testEmail };
};

export const saveEmailCampaignDraft = async (input: {
  user: StoreAccessUser;
  actorId: string;
  requestId: string;
  campaign: EmailCampaignComposerInput;
}) => {
  await assertUserCanAccessStore(prisma, input.user, input.campaign.storeId);
  const campaignInput = normalizeCampaignInput(input.campaign, {
    requireSubject: false,
    requireContent: false,
  });
  const logo = await resolveCampaignLogo({
    user: input.user,
    campaignStoreId: campaignInput.storeId,
    logoStoreId: campaignInput.logoStoreId,
  });
  const audience = await resolveCampaignRecipients({ user: input.user, campaign: campaignInput });
  if (campaignInput.senderIdentityId) {
    await resolveCampaignSender({
      user: input.user,
      organizationId: input.user.organizationId,
      storeId: campaignInput.storeId,
      senderIdentityId: campaignInput.senderIdentityId,
      senderDisplayName: campaignInput.senderDisplayName,
      replyToEmail: campaignInput.replyToEmail,
      requireVerified: false,
    });
  }
  const data = {
    organizationId: input.user.organizationId,
    storeId: campaignInput.storeId,
    createdById: input.actorId,
    status: EmailCampaignStatus.DRAFT,
    contentVersion: emailContentVersion,
    campaignType: campaignInput.campaignType,
    senderIdentityId: campaignInput.senderIdentityId,
    template: campaignInput.template,
    templateKey: campaignInput.templateKey,
    name: campaignInput.name,
    subject: campaignInput.subject || campaignInput.name,
    preheader: campaignInput.preheader,
    body: campaignInput.legacyBody,
    blocksJson: campaignInput.blocks as unknown as Prisma.InputJsonValue,
    audienceJson: campaignInput.audience as unknown as Prisma.InputJsonValue,
    audienceSummaryJson: audience.summary as unknown as Prisma.InputJsonValue,
    senderDisplayName: campaignInput.senderDisplayName,
    replyToEmail: campaignInput.replyToEmail,
    brandColor: campaignInput.brandColor,
    buttonColor: campaignInput.buttonColor,
    buttonTextColor: campaignInput.buttonTextColor,
    backgroundColor: campaignInput.backgroundColor,
    contentBackgroundColor: campaignInput.contentBackgroundColor,
    textColor: campaignInput.textColor,
    mutedTextColor: campaignInput.mutedTextColor,
    borderColor: campaignInput.borderColor,
    fontFamily: campaignInput.fontFamily,
    bannerImageUrl: campaignInput.bannerImageUrl,
    logoImageId: logo.logoImageId,
    recipientCount: audience.summary.validRecipients,
  };
  const created = campaignInput.id
    ? await prisma.emailCampaign.update({
        where: {
          id: campaignInput.id,
          organizationId: input.user.organizationId,
          storeId: campaignInput.storeId,
          status: EmailCampaignStatus.DRAFT,
        },
        data,
      })
    : await prisma.emailCampaign.create({ data });
  await writeAuditLog(prisma, {
    organizationId: input.user.organizationId,
    actorId: input.actorId,
    action: "EMAIL_CAMPAIGN_DRAFT_SAVE",
    entity: "EmailCampaign",
    entityId: created.id,
    before: null,
    after: toJson({ storeId: campaignInput.storeId, name: campaignInput.name }),
    requestId: input.requestId,
  });
  return created;
};

export const sendEmailCampaignToAudience = async (input: {
  user: StoreAccessUser;
  actorId: string;
  requestId: string;
  campaign: EmailCampaignComposerInput;
}) => {
  await assertUserCanAccessStore(prisma, input.user, input.campaign.storeId);
  requireEmailMarketingPublicAppBaseUrl();
  getEmailUnsubscribeSecret();

  const campaignInput = normalizeCampaignInput(input.campaign, {
    requireSubject: true,
    requireContent: true,
  });
  const sender = await resolveCampaignSender({
    user: input.user,
    organizationId: input.user.organizationId,
    storeId: campaignInput.storeId,
    senderIdentityId: campaignInput.senderIdentityId,
    senderDisplayName: campaignInput.senderDisplayName,
    replyToEmail: campaignInput.replyToEmail,
    requireVerified: true,
  });
  const { logo, productsById } = await prepareCampaignRenderData({
    user: input.user,
    campaign: campaignInput,
    requireProducts: true,
  });
  assertEmailImagesPublic({ campaign: campaignInput, productsById, logoUrl: logo.logoUrl });
  const { recipients, summary } = await resolveCampaignRecipients({
    user: input.user,
    campaign: campaignInput,
  });
  if (!recipients.length) {
    throw new AppError("emailCampaignAudienceEmpty", "BAD_REQUEST", 400);
  }

  const campaign = await prisma.$transaction(async (tx) => {
    const created = await tx.emailCampaign.create({
      data: {
        organizationId: input.user.organizationId,
        storeId: campaignInput.storeId,
        createdById: input.actorId,
        status: EmailCampaignStatus.SENDING,
        contentVersion: emailContentVersion,
        campaignType: campaignInput.campaignType,
        senderIdentityId: campaignInput.senderIdentityId,
        template: campaignInput.template,
        templateKey: campaignInput.templateKey,
        name: campaignInput.name,
        subject: campaignInput.subject,
        preheader: campaignInput.preheader,
        body: campaignInput.legacyBody,
        blocksJson: campaignInput.blocks as unknown as Prisma.InputJsonValue,
        audienceJson: campaignInput.audience as unknown as Prisma.InputJsonValue,
        audienceSummaryJson: summary as unknown as Prisma.InputJsonValue,
        senderDisplayName: campaignInput.senderDisplayName,
        replyToEmail: campaignInput.replyToEmail,
        brandColor: campaignInput.brandColor,
        buttonColor: campaignInput.buttonColor,
        buttonTextColor: campaignInput.buttonTextColor,
        backgroundColor: campaignInput.backgroundColor,
        contentBackgroundColor: campaignInput.contentBackgroundColor,
        textColor: campaignInput.textColor,
        mutedTextColor: campaignInput.mutedTextColor,
        borderColor: campaignInput.borderColor,
        fontFamily: campaignInput.fontFamily,
        logoImageId: logo.logoImageId,
        recipientCount: recipients.length,
        recipients: {
          create: recipients.map((customer) => ({
            organizationId: input.user.organizationId,
            customerId: customer.id,
            email: normalizeRecipientEmail(customer.email),
          })),
        },
      },
      include: {
        recipients: {
          select: { id: true, email: true, status: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    await writeAuditLog(tx, {
      organizationId: input.user.organizationId,
      actorId: input.actorId,
      action: "EMAIL_CAMPAIGN_QUEUE",
      entity: "EmailCampaign",
      entityId: created.id,
      before: null,
      after: toJson({
        storeId: campaignInput.storeId,
        subject: campaignInput.subject,
        recipientCount: recipients.length,
        audienceSummary: summary,
        senderIdentityId: sender.id,
      }),
      requestId: input.requestId,
    });
    return created;
  });

  return {
    campaign,
    sent: 0,
    failed: 0,
    recipientCount: recipients.length,
    audienceSummary: summary,
    queued: true,
    from: sender.fromEmail,
  };
};

export const sendSavedEmailCampaignToAudience = async (input: {
  user: StoreAccessUser;
  actorId: string;
  requestId: string;
  campaignId: string;
}) => {
  const existing = await prisma.emailCampaign.findFirst({
    where: {
      id: input.campaignId,
      organizationId: input.user.organizationId,
      archivedAt: null,
    },
  });
  if (!existing) {
    throw new AppError("emailCampaignNotFound", "NOT_FOUND", 404);
  }
  await assertUserCanAccessStore(prisma, input.user, existing.storeId);

  const campaignInput = normalizeCampaignInput({
    id: existing.id,
    storeId: existing.storeId,
    name: existing.name,
    campaignType: existing.campaignType,
    senderIdentityId: existing.senderIdentityId,
    template: existing.template,
    templateKey: existing.templateKey,
    subject: existing.subject,
    preheader: existing.preheader,
    body: existing.body,
    blocks: parseCampaignBlocks(existing.blocksJson, [
      { id: "fallback-text", type: "text", body: existing.body },
      { id: "fallback-footer", type: "footer", showUnsubscribe: true },
    ]),
    senderDisplayName: existing.senderDisplayName,
    replyToEmail: existing.replyToEmail,
    brandColor: existing.brandColor,
    buttonColor: existing.buttonColor,
    buttonTextColor: existing.buttonTextColor,
    backgroundColor: existing.backgroundColor,
    contentBackgroundColor: existing.contentBackgroundColor,
    textColor: existing.textColor,
    mutedTextColor: existing.mutedTextColor,
    borderColor: existing.borderColor,
    fontFamily: existing.fontFamily,
    audience: parseCampaignAudience(existing.audienceJson),
  });
  const sender = await resolveCampaignSender({
    user: input.user,
    organizationId: input.user.organizationId,
    storeId: campaignInput.storeId,
    senderIdentityId: campaignInput.senderIdentityId,
    senderDisplayName: campaignInput.senderDisplayName,
    replyToEmail: campaignInput.replyToEmail,
    requireVerified: true,
  });
  const { logo, productsById } = await prepareCampaignRenderData({
    user: input.user,
    campaign: campaignInput,
    requireProducts: true,
  });
  assertEmailImagesPublic({ campaign: campaignInput, productsById, logoUrl: logo.logoUrl });

  const { recipients, summary } = await resolveCampaignRecipients({
    user: input.user,
    campaign: campaignInput,
  });
  if (!recipients.length) {
    throw new AppError("emailCampaignAudienceEmpty", "BAD_REQUEST", 400);
  }

  const queued = await prisma.$transaction(async (tx) => {
    const locked = await tx.emailCampaign.updateMany({
      where: {
        id: existing.id,
        organizationId: input.user.organizationId,
        storeId: existing.storeId,
        status: EmailCampaignStatus.DRAFT,
        archivedAt: null,
      },
      data: {
        status: EmailCampaignStatus.SENDING,
        recipientCount: recipients.length,
        audienceSummaryJson: summary as unknown as Prisma.InputJsonValue,
        errorMessage: null,
      },
    });
    if (locked.count !== 1) {
      throw new AppError("emailCampaignAlreadyQueued", "CONFLICT", 409);
    }
    await tx.emailCampaignRecipient.deleteMany({ where: { campaignId: existing.id } });
    await tx.emailCampaignRecipient.createMany({
      data: recipients.map((customer) => ({
        organizationId: input.user.organizationId,
        campaignId: existing.id,
        customerId: customer.id,
        email: normalizeRecipientEmail(customer.email),
      })),
    });
    await writeAuditLog(tx, {
      organizationId: input.user.organizationId,
      actorId: input.actorId,
      action: "EMAIL_CAMPAIGN_QUEUE",
      entity: "EmailCampaign",
      entityId: existing.id,
      before: toJson({ status: existing.status }),
      after: toJson({
        storeId: campaignInput.storeId,
        subject: campaignInput.subject,
        recipientCount: recipients.length,
        senderIdentityId: sender.id,
      }),
      requestId: input.requestId,
    });
    return tx.emailCampaign.findUniqueOrThrow({
      where: { id: existing.id },
      include: {
        recipients: {
          select: { id: true, email: true, status: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });
  });

  return {
    campaign: queued,
    sent: 0,
    failed: 0,
    recipientCount: recipients.length,
    audienceSummary: summary,
    queued: true,
    from: sender.fromEmail,
  };
};

type DeliverEmailCampaignResult = {
  campaignId: string;
  sent: number;
  failed: number;
  skipped: number;
  recipientCount: number;
};

const campaignRecordToInput = (campaign: {
  id?: string | null;
  storeId: string;
  campaignType?: EmailCampaignType;
  senderIdentityId?: string | null;
  template: EmailCampaignTemplate;
  templateKey: string;
  name: string;
  subject: string;
  preheader: string | null;
  body: string;
  blocksJson: Prisma.JsonValue | null;
  audienceJson?: Prisma.JsonValue | null;
  senderDisplayName: string | null;
  replyToEmail: string | null;
  brandColor: string | null;
  buttonColor: string | null;
  buttonTextColor: string | null;
  backgroundColor: string | null;
  contentBackgroundColor: string | null;
  textColor: string | null;
  mutedTextColor: string | null;
  borderColor: string | null;
  fontFamily: EmailCampaignFontFamily;
  store: { bazaarCatalog: { accentColor: string | null } | null };
}) =>
  normalizeCampaignInput({
    id: campaign.id,
    storeId: campaign.storeId,
    name: campaign.name,
    campaignType: campaign.campaignType ?? EmailCampaignType.MARKETING,
    senderIdentityId: campaign.senderIdentityId,
    audience: parseCampaignAudience(campaign.audienceJson ?? null),
    template: campaign.template,
    templateKey: campaign.templateKey,
    subject: campaign.subject,
    preheader: campaign.preheader,
    body: campaign.body,
    blocks: parseCampaignBlocks(campaign.blocksJson, [
      { id: "fallback-text", type: "text", body: campaign.body },
      { id: "fallback-footer", type: "footer", showUnsubscribe: true },
    ]),
    senderDisplayName: campaign.senderDisplayName,
    replyToEmail: campaign.replyToEmail,
    brandColor:
      campaign.brandColor ?? campaign.store.bazaarCatalog?.accentColor ?? defaultBrandColor,
    buttonColor: campaign.buttonColor ?? defaultButtonColor,
    buttonTextColor: campaign.buttonTextColor ?? defaultButtonTextColor,
    backgroundColor: campaign.backgroundColor ?? defaultEmailBackgroundColor,
    contentBackgroundColor: campaign.contentBackgroundColor ?? defaultEmailContentBackgroundColor,
    textColor: campaign.textColor ?? defaultEmailTextColor,
    mutedTextColor: campaign.mutedTextColor ?? defaultEmailMutedTextColor,
    borderColor: campaign.borderColor ?? defaultEmailBorderColor,
    fontFamily: campaign.fontFamily,
    logoStoreId: null,
  });

export const deliverEmailCampaign = async (input: {
  organizationId: string;
  campaignId: string;
}): Promise<DeliverEmailCampaignResult> => {
  const campaign = await prisma.emailCampaign.findFirst({
    where: {
      id: input.campaignId,
      organizationId: input.organizationId,
      status: EmailCampaignStatus.SENDING,
    },
    include: {
      store: {
        select: {
          id: true,
          name: true,
          legalName: true,
          address: true,
          phone: true,
          currencyCode: true,
          currencyRateKgsPerUnit: true,
          enableSku: true,
          enableBarcode: true,
          bazaarCatalog: {
            select: {
              accentColor: true,
              status: true,
              publicUrlPath: true,
            },
          },
        },
      },
      logoImage: { select: { url: true } },
      recipients: {
        where: { status: EmailCampaignRecipientStatus.PENDING },
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              email: true,
              storeId: true,
              deletedAt: true,
              emailMarketingUnsubscribedAt: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!campaign) {
    return {
      campaignId: input.campaignId,
      sent: 0,
      failed: 0,
      skipped: 0,
      recipientCount: 0,
    };
  }

  let baseUrl: string;
  try {
    baseUrl = requireEmailMarketingPublicAppBaseUrl();
    getEmailUnsubscribeSecret();
  } catch (error) {
    const message = error instanceof Error ? error.message : "emailCampaignConfigurationFailed";
    await prisma.emailCampaign.update({
      where: { id: campaign.id },
      data: {
        status: EmailCampaignStatus.FAILED,
        errorMessage: message,
        failedCount: campaign.recipients.length,
      },
    });
    await prisma.emailCampaignRecipient.updateMany({
      where: { campaignId: campaign.id, status: EmailCampaignRecipientStatus.PENDING },
      data: {
        status: EmailCampaignRecipientStatus.FAILED,
        errorMessage: message,
      },
    });
    return {
      campaignId: campaign.id,
      sent: 0,
      failed: campaign.recipients.length,
      skipped: 0,
      recipientCount: campaign.recipientCount,
    };
  }

  const campaignInput = campaignRecordToInput(campaign);
  const sender = await resolveCampaignSender({
    organizationId: campaign.organizationId,
    storeId: campaign.storeId,
    senderIdentityId: campaign.senderIdentityId,
    senderDisplayName: campaign.senderDisplayName,
    replyToEmail: campaign.replyToEmail,
    requireVerified: true,
  }).catch(async (error) => {
    const message = error instanceof Error ? error.message : "emailSenderRequired";
    await prisma.emailCampaign.update({
      where: { id: campaign.id },
      data: {
        status: EmailCampaignStatus.FAILED,
        errorMessage: message,
        failedCount: campaign.recipients.length,
      },
    });
    await prisma.emailCampaignRecipient.updateMany({
      where: { campaignId: campaign.id, status: EmailCampaignRecipientStatus.PENDING },
      data: { status: EmailCampaignRecipientStatus.FAILED, errorMessage: message },
    });
    return null;
  });
  if (!sender) {
    return {
      campaignId: campaign.id,
      sent: 0,
      failed: campaign.recipients.length,
      skipped: 0,
      recipientCount: campaign.recipientCount,
    };
  }
  const logoUrl = resolveEmailMarketingAssetUrl(campaign.logoImage?.url) ?? null;
  const productsById = await loadEmailMarketingProductsByIds({
    organizationId: campaign.organizationId,
    store: campaign.store,
    productIds: selectedProductIdsFromBlocks(campaignInput.blocks),
    requireAll: true,
  }).catch(async (error) => {
    const message = error instanceof Error ? error.message : "emailCampaignProductInvalid";
    await prisma.emailCampaign.update({
      where: { id: campaign.id },
      data: {
        status: EmailCampaignStatus.FAILED,
        errorMessage: message,
        failedCount: campaign.recipients.length,
      },
    });
    await prisma.emailCampaignRecipient.updateMany({
      where: { campaignId: campaign.id, status: EmailCampaignRecipientStatus.PENDING },
      data: { status: EmailCampaignRecipientStatus.FAILED, errorMessage: message },
    });
    return null;
  });
  if (!productsById) {
    return {
      campaignId: campaign.id,
      sent: 0,
      failed: campaign.recipients.length,
      skipped: 0,
      recipientCount: campaign.recipientCount,
    };
  }
  try {
    assertEmailImagesPublic({ campaign: campaignInput, productsById, logoUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "emailCampaignImagePublicUrlRequired";
    await prisma.emailCampaign.update({
      where: { id: campaign.id },
      data: {
        status: EmailCampaignStatus.FAILED,
        errorMessage: message,
        failedCount: campaign.recipients.length,
      },
    });
    await prisma.emailCampaignRecipient.updateMany({
      where: { campaignId: campaign.id, status: EmailCampaignRecipientStatus.PENDING },
      data: { status: EmailCampaignRecipientStatus.FAILED, errorMessage: message },
    });
    return {
      campaignId: campaign.id,
      sent: 0,
      failed: campaign.recipients.length,
      skipped: 0,
      recipientCount: campaign.recipientCount,
    };
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let batch: Array<{
    recipientId: string;
    payload: {
      to: string;
      subject: string;
      html: string;
      text: string;
      from: string;
      replyTo?: string | null;
      tags?: EmailTag[];
    };
  }> = [];

  const flushBatch = async () => {
    if (!batch.length) {
      return;
    }
    const currentBatch = batch;
    batch = [];
    try {
      const results = await sendEmailBatch(
        currentBatch.map((item) => item.payload),
        {
          idempotencyKey: `campaign-${campaign.id}-${currentBatch[0]?.recipientId}`,
        },
      );
      await Promise.all(
        currentBatch.map((item, index) =>
          prisma.emailCampaignRecipient.update({
            where: { id: item.recipientId },
            data: {
              status: EmailCampaignRecipientStatus.SENT,
              providerMessageId: results[index]?.id ?? null,
              sentAt: new Date(),
            },
          }),
        ),
      );
      sent += currentBatch.length;
    } catch (error) {
      const message = error instanceof Error ? error.message : "emailSendFailed";
      await Promise.all(
        currentBatch.map((item) =>
          prisma.emailCampaignRecipient.update({
            where: { id: item.recipientId },
            data: {
              status: EmailCampaignRecipientStatus.FAILED,
              errorMessage: message,
            },
          }),
        ),
      );
      failed += currentBatch.length;
    }
  };

  for (const recipient of campaign.recipients) {
    const recipientEmail = normalizeRecipientEmail(recipient.email);
    const customerEmail = normalizeRecipientEmail(recipient.customer.email);
    if (
      !emailPattern.test(recipientEmail) ||
      recipient.customer.storeId !== campaign.storeId ||
      recipient.customer.deletedAt ||
      recipient.customer.emailMarketingUnsubscribedAt ||
      customerEmail !== recipientEmail
    ) {
      skipped += 1;
      await prisma.emailCampaignRecipient.update({
        where: { id: recipient.id },
        data: {
          status: EmailCampaignRecipientStatus.SKIPPED,
          errorMessage: recipient.customer.emailMarketingUnsubscribedAt
            ? "emailCampaignRecipientUnsubscribed"
            : "emailCampaignRecipientUnavailable",
        },
      });
      continue;
    }

    const unsubscribeUrl = buildEmailUnsubscribeUrl({
      baseUrl,
      customerId: recipient.customerId,
      email: recipient.email,
    });
    const rendered = renderEmailCampaign({
      campaign: campaignInput,
      store: campaign.store,
      logoUrl,
      productsById,
      unsubscribeUrl,
      recipient: recipient.customer,
      baseUrl,
    });

    batch.push({
      recipientId: recipient.id,
      payload: {
        to: recipient.email,
        subject: campaign.subject,
        html: rendered.html,
        text: rendered.text,
        from: sender.from,
        replyTo: sender.replyTo ?? campaign.replyToEmail,
        tags: [
          { name: "category", value: "email_marketing" },
          { name: "campaign_id", value: campaign.id.slice(0, 64) },
          { name: "store_id", value: campaign.storeId.slice(0, 64) },
        ],
      },
    });
    if (batch.length >= 100) {
      await flushBatch();
    }
  }
  await flushBatch();

  const statusCounts = await prisma.emailCampaignRecipient.groupBy({
    by: ["status"],
    where: { campaignId: campaign.id },
    _count: { _all: true },
  });
  const countByStatus = new Map(statusCounts.map((row) => [row.status, row._count._all]));
  const totalSent = countByStatus.get(EmailCampaignRecipientStatus.SENT) ?? 0;
  const totalFailed = countByStatus.get(EmailCampaignRecipientStatus.FAILED) ?? 0;
  const totalSkipped = countByStatus.get(EmailCampaignRecipientStatus.SKIPPED) ?? 0;
  const totalPending = countByStatus.get(EmailCampaignRecipientStatus.PENDING) ?? 0;
  const failedOrSkipped = totalFailed + totalSkipped + totalPending;
  const finalStatus =
    failedOrSkipped === 0
      ? EmailCampaignStatus.SENT
      : totalSent > 0
        ? EmailCampaignStatus.PARTIAL
        : EmailCampaignStatus.FAILED;

  const updated = await prisma.emailCampaign.update({
    where: { id: campaign.id },
    data: {
      status: finalStatus,
      sentCount: totalSent,
      failedCount: failedOrSkipped,
      sentAt: totalSent > 0 ? new Date() : null,
      errorMessage:
        finalStatus === EmailCampaignStatus.SENT ? null : "emailCampaignPartialOrFullFailure",
    },
  });
  if (sender.id && totalSent > 0) {
    await prisma.emailSenderIdentity.update({
      where: { id: sender.id },
      data: { lastUsedAt: new Date() },
    });
  }

  return {
    campaignId: updated.id,
    sent,
    failed,
    skipped,
    recipientCount: updated.recipientCount,
  };
};

export const deliverPendingEmailCampaigns = async () => {
  const results: DeliverEmailCampaignResult[] = [];
  for (let index = 0; index < 50; index += 1) {
    const next = await prisma.emailCampaign.findFirst({
      where: { status: EmailCampaignStatus.SENDING },
      select: { id: true, organizationId: true },
      orderBy: { createdAt: "asc" },
    });
    if (!next) {
      break;
    }
    results.push(
      await deliverEmailCampaign({
        organizationId: next.organizationId,
        campaignId: next.id,
      }),
    );
  }
  return {
    processed: results.length,
    sent: results.reduce((total, result) => total + result.sent, 0),
    failed: results.reduce((total, result) => total + result.failed, 0),
    skipped: results.reduce((total, result) => total + result.skipped, 0),
    campaigns: results.map((result) => result.campaignId),
  };
};

export const listEmailCampaigns = async (input: {
  user: StoreAccessUser;
  storeId: string;
  limit?: number;
}) => {
  await assertUserCanAccessStore(prisma, input.user, input.storeId);
  return prisma.emailCampaign.findMany({
    where: {
      organizationId: input.user.organizationId,
      storeId: input.storeId,
      archivedAt: null,
    },
    include: {
      createdBy: { select: { name: true, email: true } },
      senderIdentity: { select: { id: true, displayName: true, fromEmail: true, status: true } },
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(50, Math.max(1, input.limit ?? 20)),
  });
};

export const duplicateEmailCampaign = async (input: {
  user: StoreAccessUser;
  actorId: string;
  requestId: string;
  campaignId: string;
}) => {
  const campaign = await prisma.emailCampaign.findFirst({
    where: {
      id: input.campaignId,
      organizationId: input.user.organizationId,
      archivedAt: null,
    },
  });
  if (!campaign) {
    throw new AppError("emailCampaignNotFound", "NOT_FOUND", 404);
  }
  await assertUserCanAccessStore(prisma, input.user, campaign.storeId);
  const created = await prisma.emailCampaign.create({
    data: {
      organizationId: campaign.organizationId,
      storeId: campaign.storeId,
      createdById: input.actorId,
      contentVersion: campaign.contentVersion,
      campaignType: campaign.campaignType,
      senderIdentityId: campaign.senderIdentityId,
      duplicatedFromId: campaign.id,
      status: EmailCampaignStatus.DRAFT,
      template: campaign.template,
      templateKey: campaign.templateKey,
      name: `${campaign.name} копия`.slice(0, 180),
      subject: campaign.subject,
      preheader: campaign.preheader,
      heading: campaign.heading,
      body: campaign.body,
      blocksJson: campaign.blocksJson as Prisma.InputJsonValue,
      audienceJson: campaign.audienceJson as Prisma.InputJsonValue,
      audienceSummaryJson: campaign.audienceSummaryJson as Prisma.InputJsonValue,
      ctaLabel: campaign.ctaLabel,
      ctaUrl: campaign.ctaUrl,
      footerText: campaign.footerText,
      senderDisplayName: campaign.senderDisplayName,
      replyToEmail: campaign.replyToEmail,
      brandColor: campaign.brandColor,
      buttonColor: campaign.buttonColor,
      buttonTextColor: campaign.buttonTextColor,
      backgroundColor: campaign.backgroundColor,
      contentBackgroundColor: campaign.contentBackgroundColor,
      textColor: campaign.textColor,
      mutedTextColor: campaign.mutedTextColor,
      borderColor: campaign.borderColor,
      fontFamily: campaign.fontFamily,
      bannerImageUrl: campaign.bannerImageUrl,
      logoImageId: campaign.logoImageId,
      recipientCount: campaign.recipientCount,
    },
  });
  await writeAuditLog(prisma, {
    organizationId: input.user.organizationId,
    actorId: input.actorId,
    action: "EMAIL_CAMPAIGN_DUPLICATE",
    entity: "EmailCampaign",
    entityId: created.id,
    before: null,
    after: toJson({ fromCampaignId: campaign.id }),
    requestId: input.requestId,
  });
  return created;
};

export const archiveEmailCampaign = async (input: {
  user: StoreAccessUser;
  actorId: string;
  requestId: string;
  campaignId: string;
}) => {
  const campaign = await prisma.emailCampaign.findFirst({
    where: {
      id: input.campaignId,
      organizationId: input.user.organizationId,
    },
  });
  if (!campaign) {
    throw new AppError("emailCampaignNotFound", "NOT_FOUND", 404);
  }
  await assertUserCanAccessStore(prisma, input.user, campaign.storeId);
  const updated = await prisma.emailCampaign.update({
    where: { id: campaign.id },
    data: { archivedAt: new Date() },
  });
  await writeAuditLog(prisma, {
    organizationId: input.user.organizationId,
    actorId: input.actorId,
    action: "EMAIL_CAMPAIGN_ARCHIVE",
    entity: "EmailCampaign",
    entityId: campaign.id,
    before: toJson({ archivedAt: campaign.archivedAt }),
    after: toJson({ archivedAt: updated.archivedAt }),
    requestId: input.requestId,
  });
  return updated;
};

export const deleteEmailCampaignDraft = async (input: {
  user: StoreAccessUser;
  campaignId: string;
}) => {
  const campaign = await prisma.emailCampaign.findFirst({
    where: {
      id: input.campaignId,
      organizationId: input.user.organizationId,
      status: EmailCampaignStatus.DRAFT,
    },
  });
  if (!campaign) {
    throw new AppError("emailCampaignNotFound", "NOT_FOUND", 404);
  }
  await assertUserCanAccessStore(prisma, input.user, campaign.storeId);
  await prisma.emailCampaign.delete({ where: { id: campaign.id } });
  return { ok: true as const };
};

export const getEmailCampaignDetail = async (input: {
  user: StoreAccessUser;
  campaignId: string;
}) => {
  const campaign = await prisma.emailCampaign.findFirst({
    where: {
      id: input.campaignId,
      organizationId: input.user.organizationId,
    },
    include: {
      store: {
        select: {
          id: true,
          name: true,
          legalName: true,
          address: true,
          phone: true,
          currencyCode: true,
          currencyRateKgsPerUnit: true,
          enableSku: true,
          enableBarcode: true,
          bazaarCatalog: {
            select: {
              accentColor: true,
              status: true,
              publicUrlPath: true,
            },
          },
        },
      },
      logoImage: { select: { url: true } },
      createdBy: { select: { name: true, email: true } },
      senderIdentity: { select: { id: true, displayName: true, fromEmail: true, status: true } },
      recipients: {
        select: {
          id: true,
          email: true,
          status: true,
          errorMessage: true,
          sentAt: true,
          customer: { select: { id: true, name: true } },
        },
        orderBy: [{ status: "asc" }, { createdAt: "asc" }],
        take: 200,
      },
    },
  });
  if (!campaign) {
    throw new AppError("emailCampaignNotFound", "NOT_FOUND", 404);
  }
  await assertUserCanAccessStore(prisma, input.user, campaign.storeId);
  const campaignInput = campaignRecordToInput(campaign);
  const productsById = await loadEmailMarketingProductsByIds({
    organizationId: campaign.organizationId,
    store: campaign.store,
    productIds: selectedProductIdsFromBlocks(campaignInput.blocks),
  });
  const rendered = renderEmailCampaign({
    campaign: campaignInput,
    store: campaign.store,
    logoUrl: resolveEmailMarketingAssetUrl(campaign.logoImage?.url),
    productsById,
    recipient: { name: "клиент" },
    baseUrl: getPublicAppBaseUrl(),
  });
  return { campaign, rendered };
};

const defaultAutomationBlocks = (
  trigger: EmailAutomationTrigger,
  storeName?: string | null,
): EmailCampaignBlock[] => [
  {
    id: "automation-header",
    type: "header",
    showLogo: true,
    showStoreName: true,
    storeName: storeName ?? null,
    heading:
      trigger === EmailAutomationTrigger.ORDER_CREATED
        ? "Спасибо за заказ, {{customerName}}"
        : "Статус заказа изменился",
  },
  {
    id: "automation-text",
    type: "text",
    heading:
      trigger === EmailAutomationTrigger.ORDER_CREATED
        ? `Заказ {{orderNumber}} принят${storeName ? ` · ${storeName}` : ""}`
        : "Заказ {{orderNumber}} теперь: {{orderStatus}}",
    body:
      trigger === EmailAutomationTrigger.ORDER_CREATED
        ? "Мы получили ваш заказ и скоро начнем обработку."
        : "Ниже краткая информация по вашему заказу.",
  },
	  {
	    id: "automation-order-summary",
	    type: "orderSummary",
	    title: "Состав заказа",
	    summaryText:
	      trigger === EmailAutomationTrigger.ORDER_STATUS_CHANGED
	        ? "Заказ {{orderNumber}} · было: {{orderPreviousStatus}} · сейчас: {{orderStatus}}"
	        : "Заказ {{orderNumber}} · {{orderStatus}}",
	    itemsLabel: "Товары",
	    totalLabel: "Итого",
	    emptyOrderText: "Данные заказа появятся при отправке автоматизации.",
	    quantitySeparator: "×",
	    sampleItemName: "Товар",
	    showSummary: true,
	    showItems: true,
	    showTotals: true,
	  },
  {
    id: "automation-footer",
    type: "footer",
    text: "Это сервисное письмо по вашему заказу.",
    showUnsubscribe: false,
  },
];

const automationDefaults = (trigger: EmailAutomationTrigger, storeName?: string | null) => ({
  name:
    trigger === EmailAutomationTrigger.ORDER_CREATED
      ? "Заказ создан"
      : "Статус заказа изменен",
  subject:
    trigger === EmailAutomationTrigger.ORDER_CREATED
      ? "Ваш заказ {{orderNumber}} принят"
      : "Статус заказа {{orderNumber}}: {{orderStatus}}",
  preheader:
    trigger === EmailAutomationTrigger.ORDER_CREATED
      ? "Информация о заказе"
      : "Обновление по заказу",
  blocks: defaultAutomationBlocks(trigger, storeName),
});

const ensureDefaultAutomations = async (input: {
  organizationId: string;
  storeId: string;
  storeName?: string | null;
}) => {
  for (const trigger of [
    EmailAutomationTrigger.ORDER_CREATED,
    EmailAutomationTrigger.ORDER_STATUS_CHANGED,
  ]) {
    const defaults = automationDefaults(trigger, input.storeName);
    await prisma.emailAutomation.upsert({
      where: { storeId_trigger: { storeId: input.storeId, trigger } },
      create: {
        organizationId: input.organizationId,
        storeId: input.storeId,
        trigger,
        status: EmailAutomationStatus.PAUSED,
        name: defaults.name,
        subject: defaults.subject,
        preheader: defaults.preheader,
        contentVersion: emailContentVersion,
        blocksJson: defaults.blocks as unknown as Prisma.InputJsonValue,
      },
      update: {},
    });
  }
};

export const listEmailAutomations = async (input: {
  user: StoreAccessUser;
  storeId: string;
}) => {
  await assertUserCanAccessStore(prisma, input.user, input.storeId);
  const store = await prisma.store.findFirst({
    where: { id: input.storeId, organizationId: input.user.organizationId },
    select: { name: true },
  });
  await ensureDefaultAutomations({
    organizationId: input.user.organizationId,
    storeId: input.storeId,
    storeName: store?.name,
  });
  return prisma.emailAutomation.findMany({
    where: {
      organizationId: input.user.organizationId,
      storeId: input.storeId,
    },
    include: {
      senderIdentity: { select: { id: true, displayName: true, fromEmail: true, status: true } },
    },
    orderBy: { trigger: "asc" },
  });
};

export const updateEmailAutomation = async (input: {
  user: StoreAccessUser;
  actorId: string;
  requestId: string;
  automationId: string;
	  status?: EmailAutomationStatus;
	  senderIdentityId?: string | null;
	  subject?: string | null;
	  preheader?: string | null;
	  brandColor?: string | null;
	  buttonColor?: string | null;
	  buttonTextColor?: string | null;
	  backgroundColor?: string | null;
	  contentBackgroundColor?: string | null;
	  textColor?: string | null;
	  mutedTextColor?: string | null;
	  borderColor?: string | null;
	  fontFamily?: EmailCampaignFontFamily;
	  logoStoreId?: string | null;
	  blocks?: EmailCampaignBlock[] | null;
	}) => {
  const automation = await prisma.emailAutomation.findFirst({
    where: { id: input.automationId, organizationId: input.user.organizationId },
  });
  if (!automation) {
    throw new AppError("emailAutomationNotFound", "NOT_FOUND", 404);
  }
  await assertUserCanAccessStore(prisma, input.user, automation.storeId);
  if (input.senderIdentityId) {
    await resolveCampaignSender({
      user: input.user,
      organizationId: input.user.organizationId,
      storeId: automation.storeId,
      senderIdentityId: input.senderIdentityId,
      requireVerified: true,
    });
  }
  const blocks =
    input.blocks?.map(normalizeBlockId).filter(blockHasMeaningfulContent).slice(0, 30) ??
    undefined;
	  const updated = await prisma.emailAutomation.update({
	    where: { id: automation.id },
	    data: {
	      status: input.status,
	      senderIdentity:
	        input.senderIdentityId === undefined
	          ? undefined
	          : input.senderIdentityId
	            ? { connect: { id: input.senderIdentityId } }
	            : { disconnect: true },
	      subject: trimOptional(input.subject) ?? undefined,
	      preheader: input.preheader === undefined ? undefined : trimOptional(input.preheader),
	      brandColor:
	        input.brandColor === undefined
	          ? undefined
	          : normalizeColor(input.brandColor, defaultBrandColor),
	      buttonColor:
	        input.buttonColor === undefined
	          ? undefined
	          : normalizeColor(input.buttonColor, defaultButtonColor),
	      buttonTextColor:
	        input.buttonTextColor === undefined
	          ? undefined
	          : normalizeColor(input.buttonTextColor, defaultButtonTextColor),
	      backgroundColor:
	        input.backgroundColor === undefined
	          ? undefined
	          : normalizeColor(input.backgroundColor, defaultEmailBackgroundColor),
	      contentBackgroundColor:
	        input.contentBackgroundColor === undefined
	          ? undefined
	          : normalizeColor(input.contentBackgroundColor, defaultEmailContentBackgroundColor),
	      textColor:
	        input.textColor === undefined
	          ? undefined
	          : normalizeColor(input.textColor, defaultEmailTextColor),
	      mutedTextColor:
	        input.mutedTextColor === undefined
	          ? undefined
	          : normalizeColor(input.mutedTextColor, defaultEmailMutedTextColor),
	      borderColor:
	        input.borderColor === undefined
	          ? undefined
	          : normalizeColor(input.borderColor, defaultEmailBorderColor),
	      fontFamily: input.fontFamily,
	      logoStoreId: input.logoStoreId === undefined ? undefined : trimOptional(input.logoStoreId),
	      blocksJson: blocks ? (blocks as unknown as Prisma.InputJsonValue) : undefined,
	      contentVersion: emailContentVersion,
	    },
	  });
  await writeAuditLog(prisma, {
    organizationId: input.user.organizationId,
    actorId: input.actorId,
    action: "EMAIL_AUTOMATION_UPDATE",
    entity: "EmailAutomation",
    entityId: automation.id,
    before: toJson({ status: automation.status, senderIdentityId: automation.senderIdentityId }),
    after: toJson({ status: updated.status, senderIdentityId: updated.senderIdentityId }),
    requestId: input.requestId,
  });
  return updated;
};

const statusLabel = (status: CustomerOrderStatus | string) => {
  const labels: Record<string, string> = {
    DRAFT: "черновик",
    CONFIRMED: "подтвержден",
    READY: "готов",
    COMPLETED: "завершен",
    CANCELED: "отменен",
  };
  return labels[String(status)] ?? String(status);
};

const firstOrderSummaryBlock = (campaign: NormalizedEmailCampaign) =>
  campaign.blocks.find(
    (block): block is Extract<EmailCampaignBlock, { type: "orderSummary" }> =>
      block.type === "orderSummary",
  );

const sampleOrderForPreview = (
  store: EmailMarketingStore,
  campaign: NormalizedEmailCampaign,
): EmailRenderOrder => {
  const orderBlock = firstOrderSummaryBlock(campaign);
  const totalText = formatProductPrice(1200, store) ?? "1 200 KGS";
  return {
    number: "SO-0001",
    previousStatus: statusLabel("CONFIRMED"),
    status: statusLabel("READY"),
    totalText,
    lines: [
      {
        name: trimOptional(orderBlock?.sampleItemName) ?? "Товар",
        qty: 1,
        totalText,
      },
    ],
  };
};

const loadOrderForEmail = async (input: { organizationId: string; orderId: string }) => {
  const order = await prisma.customerOrder.findFirst({
    where: { id: input.orderId, organizationId: input.organizationId },
    include: {
      store: {
        select: {
          id: true,
          name: true,
          legalName: true,
          address: true,
          phone: true,
          currencyCode: true,
          currencyRateKgsPerUnit: true,
          enableSku: true,
          enableBarcode: true,
          bazaarCatalog: {
            select: {
              accentColor: true,
              status: true,
              publicUrlPath: true,
            },
          },
        },
      },
      lines: {
        include: {
          product: { select: { name: true } },
        },
      },
    },
  });
  if (!order) {
    throw new AppError("salesOrderNotFound", "NOT_FOUND", 404);
  }
  const store: EmailMarketingStore = order.store;
  return {
    order,
    store,
    recipient: {
      name: order.customerName,
      email: order.customerEmail,
    },
    renderOrder: {
      number: order.number,
      status: statusLabel(order.status),
      totalText: formatProductPrice(Number(order.totalKgs), store) ?? `${Number(order.totalKgs)} KGS`,
      lines: order.lines.map((line) => ({
        name: line.product.name,
        qty: line.qty,
        totalText:
          formatProductPrice(Number(line.lineTotalKgs), store) ??
          `${Number(line.lineTotalKgs)} KGS`,
      })),
    } satisfies EmailRenderOrder,
  };
};

const automationToCampaign = (input: {
	  automation: {
	    id: string;
	    storeId: string;
	    senderIdentityId: string | null;
	    subject: string;
	    preheader: string | null;
	    blocksJson: Prisma.JsonValue | null;
	    brandColor: string | null;
	    buttonColor: string | null;
	    buttonTextColor: string | null;
	    backgroundColor: string | null;
	    contentBackgroundColor: string | null;
	    textColor: string | null;
	    mutedTextColor: string | null;
	    borderColor: string | null;
	    fontFamily: EmailCampaignFontFamily;
	    logoStoreId: string | null;
	  };
  store: EmailMarketingStore;
}) =>
  normalizeCampaignInput(
    {
      id: input.automation.id,
      storeId: input.automation.storeId,
      campaignType: EmailCampaignType.TRANSACTIONAL,
      senderIdentityId: input.automation.senderIdentityId,
      subject: input.automation.subject,
      preheader: input.automation.preheader,
	      blocks: parseCampaignBlocks(input.automation.blocksJson, [
	        ...defaultAutomationBlocks(EmailAutomationTrigger.ORDER_CREATED, input.store.name),
	      ]),
	      brandColor: input.automation.brandColor ?? input.store.bazaarCatalog?.accentColor,
	      buttonColor: input.automation.buttonColor,
	      buttonTextColor: input.automation.buttonTextColor,
	      backgroundColor: input.automation.backgroundColor,
	      contentBackgroundColor: input.automation.contentBackgroundColor,
	      textColor: input.automation.textColor,
	      mutedTextColor: input.automation.mutedTextColor,
	      borderColor: input.automation.borderColor,
	      fontFamily: input.automation.fontFamily,
	      logoStoreId: input.automation.logoStoreId ?? input.automation.storeId,
	    },
    { requireSubject: true, requireContent: true },
  );

export const testEmailAutomation = async (input: {
  user: StoreAccessUser;
  actorId: string;
  requestId: string;
  automationId: string;
  to: string;
}) => {
  const automation = await prisma.emailAutomation.findFirst({
    where: { id: input.automationId, organizationId: input.user.organizationId },
  });
  if (!automation) {
    throw new AppError("emailAutomationNotFound", "NOT_FOUND", 404);
  }
  await assertUserCanAccessStore(prisma, input.user, automation.storeId);
  const to = normalizeRecipientEmail(input.to);
  if (!isValidEmail(to)) {
    throw new AppError("emailCampaignTestRecipientInvalid", "BAD_REQUEST", 400);
  }
  const orderData = await prisma.customerOrder
    .findFirst({
      where: {
        organizationId: input.user.organizationId,
        storeId: automation.storeId,
        customerEmail: { not: null },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    })
    .then((order) =>
      order
        ? loadOrderForEmail({ organizationId: input.user.organizationId, orderId: order.id })
        : null,
    );
  const brand = await getStoreBrand({
    organizationId: input.user.organizationId,
    storeId: automation.storeId,
  });
  const store = orderData?.store ?? brand.store;
  const campaign = automationToCampaign({ automation, store });
  const sender = await resolveCampaignSender({
    user: input.user,
    organizationId: input.user.organizationId,
    storeId: automation.storeId,
    senderIdentityId: automation.senderIdentityId,
    requireVerified: true,
  });
	  const logo = await resolveCampaignLogo({
	    user: input.user,
	    campaignStoreId: automation.storeId,
	    logoStoreId: campaign.logoStoreId ?? automation.storeId,
	  });
	  const rendered = renderEmailCampaign({
	    campaign,
	    store,
	    logoUrl: logo.logoUrl,
	    recipient: orderData?.recipient ?? { name: "клиент", email: to },
	    order: orderData?.renderOrder ?? sampleOrderForPreview(store, campaign),
	    baseUrl: getPublicAppBaseUrl(),
	  });
  await sendMarketingEmail({
    to,
    subject: renderVariables(campaign.subject, {
      customerName: orderData?.recipient.name,
      store,
      currentDate: new Date(),
      order: orderData?.renderOrder ?? null,
    }),
    html: rendered.html,
    text: rendered.text,
    from: sender.from,
    replyTo: sender.replyTo,
    tags: [
      { name: "category", value: "email_automation_test" },
      { name: "automation_id", value: automation.id.slice(0, 64) },
    ],
  });
  await writeAuditLog(prisma, {
    organizationId: input.user.organizationId,
    actorId: input.actorId,
    action: "EMAIL_AUTOMATION_TEST_SEND",
    entity: "EmailAutomation",
    entityId: automation.id,
    before: null,
    after: toJson({ to }),
    requestId: input.requestId,
  });
  return { ok: true as const, to };
};

export const processEmailAutomationTrigger = async (input: {
  organizationId: string;
  storeId: string;
  customerOrderId: string;
  trigger: EmailAutomationTrigger;
  oldStatus?: CustomerOrderStatus | string | null;
  newStatus?: CustomerOrderStatus | string | null;
}) => {
  const automations = await prisma.emailAutomation.findMany({
    where: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      trigger: input.trigger,
      status: EmailAutomationStatus.ACTIVE,
    },
  });
  if (!automations.length) {
    return { processed: 0, sent: 0, failed: 0, skipped: 0 };
  }
  const orderData = await loadOrderForEmail({
    organizationId: input.organizationId,
    orderId: input.customerOrderId,
  });
  const recipientEmail = normalizeRecipientEmail(orderData.order.customerEmail);
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const automation of automations) {
    const triggerKey = [
      input.trigger,
      input.customerOrderId,
      input.oldStatus ?? "none",
      input.newStatus ?? orderData.order.status,
    ].join(":");
    if (!isValidEmail(recipientEmail)) {
      skipped += 1;
      await prisma.emailAutomationDelivery
        .create({
          data: {
            organizationId: input.organizationId,
            storeId: input.storeId,
            automationId: automation.id,
            customerOrderId: input.customerOrderId,
            triggerKey,
            recipientEmail: recipientEmail || "missing",
            status: EmailAutomationDeliveryStatus.SKIPPED,
            errorMessage: "emailAutomationRecipientMissing",
          },
        })
        .catch(() => null);
      continue;
    }
    const created = await prisma.emailAutomationDelivery
      .create({
        data: {
          organizationId: input.organizationId,
          storeId: input.storeId,
          automationId: automation.id,
          customerOrderId: input.customerOrderId,
          triggerKey,
          recipientEmail,
          status: EmailAutomationDeliveryStatus.PENDING,
        },
      })
      .catch(() => null);
    if (!created) {
      skipped += 1;
      continue;
    }

	    try {
	      const campaign = automationToCampaign({ automation, store: orderData.store });
	      const renderOrder: EmailRenderOrder = {
	        ...orderData.renderOrder,
	        previousStatus: input.oldStatus ? statusLabel(input.oldStatus) : null,
	        status: statusLabel(input.newStatus ?? orderData.order.status),
	      };
	      const sender = await resolveCampaignSender({
        organizationId: input.organizationId,
        storeId: input.storeId,
        senderIdentityId: automation.senderIdentityId,
        requireVerified: true,
      });
	      const logo = await resolveCampaignLogo({
	        user: {
          id: "automation",
          organizationId: input.organizationId,
          role: "ADMIN",
          isOrgOwner: true,
	        },
	        campaignStoreId: input.storeId,
	        logoStoreId: campaign.logoStoreId ?? input.storeId,
	      });
	      const rendered = renderEmailCampaign({
	        campaign,
	        store: orderData.store,
	        logoUrl: logo.logoUrl,
	        recipient: orderData.recipient,
	        order: renderOrder,
	        baseUrl: getPublicAppBaseUrl(),
	      });
      const result = await sendMarketingEmail({
        to: recipientEmail,
        subject: renderVariables(campaign.subject, {
	          customerName: orderData.recipient.name,
	          store: orderData.store,
	          currentDate: new Date(),
	          order: renderOrder,
	        }),
        html: rendered.html,
        text: rendered.text,
        from: sender.from,
        replyTo: sender.replyTo,
        tags: [
          { name: "category", value: "email_automation" },
          { name: "automation_id", value: automation.id.slice(0, 64) },
          { name: "store_id", value: input.storeId.slice(0, 64) },
        ],
        idempotencyKey: `automation-${created.id}`,
      });
      await prisma.emailAutomationDelivery.update({
        where: { id: created.id },
        data: {
          status: EmailAutomationDeliveryStatus.SENT,
          providerMessageId: result.id,
          sentAt: new Date(),
        },
      });
      await prisma.emailAutomation.update({
        where: { id: automation.id },
        data: { lastTriggeredAt: new Date(), sentCount: { increment: 1 } },
      });
      if (sender.id) {
        await prisma.emailSenderIdentity.update({
          where: { id: sender.id },
          data: { lastUsedAt: new Date() },
        });
      }
      sent += 1;
    } catch (error) {
      failed += 1;
      await prisma.emailAutomationDelivery.update({
        where: { id: created.id },
        data: {
          status: EmailAutomationDeliveryStatus.FAILED,
          errorMessage: error instanceof Error ? error.message : "emailAutomationSendFailed",
        },
      });
      await prisma.emailAutomation.update({
        where: { id: automation.id },
        data: { lastTriggeredAt: new Date(), failedCount: { increment: 1 } },
      });
    }
  }

  return { processed: automations.length, sent, failed, skipped };
};
