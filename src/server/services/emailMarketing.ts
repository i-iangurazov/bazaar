import { createHmac, timingSafeEqual } from "node:crypto";

import {
  BazaarCatalogFontFamily,
  BazaarCatalogStatus,
  EmailCampaignFontFamily,
  EmailCampaignRecipientStatus,
  EmailCampaignStatus,
  EmailCampaignTemplate,
} from "@prisma/client";
import type { CustomerSource, Prisma } from "@prisma/client";

import { formatKgsMoney } from "@/lib/currencyDisplay";
import { prisma } from "@/server/db/prisma";
import {
  getMarketingEmailConfiguration,
  MARKETING_EMAIL_FROM,
  sendMarketingEmail,
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

export type EmailCampaignBlock =
  | {
      id: string;
      type: "header";
      showStoreName?: boolean;
      showLogo?: boolean;
      heading?: string | null;
    }
  | {
      id: string;
      type: "hero";
      imageUrl?: string | null;
      heading?: string | null;
      subtitle?: string | null;
      buttonText?: string | null;
      buttonUrl?: string | null;
    }
  | {
      id: string;
      type: "text";
      heading?: string | null;
      body?: string | null;
    }
  | {
      id: string;
      type: "button";
      text?: string | null;
      url?: string | null;
    }
  | {
      id: string;
      type: "products";
      productIds?: string[];
      showImage?: boolean;
      showPrice?: boolean;
      showButton?: boolean;
      buttonText?: string | null;
      buttonUrl?: string | null;
      layout?: "one" | "two";
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
    };

type EmailCampaignComposerInput = {
  storeId: string;
  name?: string | null;
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
  storeId: string;
  name: string;
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

const localEmailAssetHostnames = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

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
      return Boolean(block.showStoreName ?? true) || Boolean(trimOptional(block.heading));
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
          return [block.heading];
        case "hero":
          return [block.heading, block.subtitle, block.buttonText];
        case "text":
          return [block.heading, block.body];
        case "button":
          return [block.text, block.url];
        case "products":
          return [`Products: ${(block.productIds ?? []).join(", ")}`];
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
    storeId: input.storeId,
    name: campaignName.slice(0, 180),
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
}) => {
  await assertUserCanAccessStore(prisma, input.user, input.storeId);
  const brand = await getStoreBrand({
    organizationId: input.user.organizationId,
    storeId: input.storeId,
  });
  const search = trimOptional(input.search);
  const category = trimOptional(input.category);
  const products = await prisma.product.findMany({
    where: {
      organizationId: input.user.organizationId,
      isDeleted: false,
      storeProducts: {
        some: {
          organizationId: input.user.organizationId,
          storeId: input.storeId,
          isActive: true,
        },
      },
      ...(category ? { OR: [{ category }, { categories: { has: category } }] } : {}),
      ...(search
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
        : {}),
    },
    select: {
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
        orderBy: { position: "asc" },
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
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: Math.min(50, Math.max(1, input.limit ?? 20)),
  });

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
    throw new AppError("emailCampaignImagePublicUrlRequired", "BAD_REQUEST", 400);
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
      message:
        "Некоторые изображения письма ведут на localhost. Они видны в админке, но не откроются в почтовом ящике. Укажите публичный NEXTAUTH_URL/NEXT_PUBLIC_APP_URL или R2_PUBLIC_BASE_URL.",
    });
  }
  return warnings;
};

const renderVariables = (
  value: string | null | undefined,
  input: {
    customerName?: string | null;
    store: EmailMarketingStore;
    currentDate: Date;
    discountCode?: string | null;
    unsubscribeUrl?: string | null;
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

export const renderEmailCampaign = (input: {
  campaign: NormalizedEmailCampaign;
  store: EmailMarketingStore;
  productsById?: Map<string, EmailMarketingProduct>;
  logoUrl?: string | null;
  unsubscribeUrl?: string | null;
  recipient?: { name?: string | null; email?: string | null } | null;
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
  };
  const preheader = input.campaign.preheader
    ? escapeHtml(renderVariables(input.campaign.preheader, variableContext))
    : "";
  const htmlParts: string[] = [];
  const textParts: string[] = [];

  for (const block of input.campaign.blocks) {
    if (block.type === "header") {
      const heading = trimOptional(renderVariables(block.heading, variableContext));
      const showLogo = block.showLogo ?? true;
      const showStoreName = block.showStoreName ?? true;
      htmlParts.push(`
        <div style="padding:22px 24px;border-bottom:1px solid ${borderColor};text-align:left;">
          ${
            showLogo && input.logoUrl
              ? `<img src="${escapeHtml(input.logoUrl)}" alt="${escapeHtml(storeName)}" width="140" style="display:block;width:140px;max-width:100%;max-height:120px;height:auto;object-fit:contain;margin:0 0 8px;" />`
              : ""
          }
          ${showStoreName ? `<div style="font-size:18px;font-weight:800;color:${brandColor};">${escapeHtml(storeName)}</div>` : ""}
          ${heading ? `<div style="margin-top:8px;color:${mutedTextColor};font-size:14px;line-height:1.5;">${escapeHtml(heading)}</div>` : ""}
        </div>
      `);
      textParts.push([showStoreName ? storeName : null, heading].filter(Boolean).join("\n"));
    }

    if (block.type === "hero") {
      const imageUrl = resolveEmailMarketingAssetUrl(block.imageUrl);
      const heading = trimOptional(renderVariables(block.heading, variableContext));
      const subtitle = trimOptional(renderVariables(block.subtitle, variableContext));
      const buttonText = trimOptional(renderVariables(block.buttonText, variableContext));
      const buttonUrl = resolveEmailLinkUrl(block.buttonUrl, input.baseUrl);
      htmlParts.push(`
        <div style="padding:24px;">
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
      const heading = trimOptional(renderVariables(block.heading, variableContext));
      const body = trimOptional(renderVariables(block.body, variableContext));
      htmlParts.push(`
        <div style="padding:8px 24px 22px;">
          ${heading ? `<h2 style="margin:0 0 10px;color:${textColor};font-size:20px;line-height:1.3;">${escapeHtml(heading)}</h2>` : ""}
          ${body ? `<div style="color:${mutedTextColor};font-size:15px;line-height:1.65;">${textToHtml(body)}</div>` : ""}
        </div>
      `);
      textParts.push([heading, body].filter(Boolean).join("\n\n"));
    }

    if (block.type === "button") {
      const text = trimOptional(renderVariables(block.text, variableContext));
      const href = resolveEmailLinkUrl(block.url, input.baseUrl);
      if (text && href) {
        htmlParts.push(`
          <div style="padding:8px 24px 24px;text-align:left;">
            ${renderButton({ href, text, color: buttonColor, textColor: buttonTextColor })}
          </div>
        `);
        textParts.push(`${text}: ${href}`);
      }
    }

    if (block.type === "products") {
      const ids = block.productIds ?? [];
      const selectedProducts = ids.flatMap((id) => {
        const product = productsById.get(id);
        return product ? [product] : [];
      });
      const showImage = block.showImage ?? true;
      const showPrice = block.showPrice ?? true;
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
            <div style="border:1px solid ${borderColor};padding:14px;background:${contentBackgroundColor};">
              ${
                showImage && product.imageUrl
                  ? `<img src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.name)}" style="display:block;width:100%;height:auto;margin:0 0 12px;" />`
                  : showImage
                    ? `<div style="background:${backgroundColor};color:${mutedTextColor};font-size:13px;line-height:1.4;padding:28px 12px;text-align:center;margin:0 0 12px;">Фото товара</div>`
                    : ""
              }
              <h3 style="margin:0 0 8px;color:${textColor};font-size:16px;line-height:1.35;">${escapeHtml(product.name)}</h3>
              ${
                product.description
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
              [product.name, showPrice ? product.priceText : null].filter(Boolean).join(" - "),
            )
            .join("\n"),
        );
      }
    }

    if (block.type === "promo") {
      const title = trimOptional(renderVariables(block.title, variableContext));
      const code = trimOptional(renderVariables(block.discountCode, variableContext));
      const description = trimOptional(renderVariables(block.description, variableContext));
      const expiryText = trimOptional(renderVariables(block.expiryText, variableContext));
      const buttonText = trimOptional(renderVariables(block.buttonText, variableContext));
      const buttonUrl = resolveEmailLinkUrl(block.buttonUrl, input.baseUrl);
      htmlParts.push(`
        <div style="padding:8px 24px 24px;">
          <div style="border:1px solid ${brandColor};background:${backgroundColor};padding:18px;">
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
        <div style="padding:18px 24px;border-top:1px solid ${borderColor};color:${mutedTextColor};font-size:12px;line-height:1.55;">
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
    baseUrl,
  });
  return {
    reachableCustomers: audience.summary.validRecipients,
    audienceSummary: audience.summary,
    from: MARKETING_EMAIL_FROM,
    rendered,
    warnings,
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
  const config = getMarketingEmailConfiguration();
  if (!config.ready) {
    throw new AppError("emailMarketingNotConfigured", "BAD_REQUEST", 400);
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
    replyTo: campaign.replyToEmail,
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
  const created = await prisma.emailCampaign.create({
    data: {
      organizationId: input.user.organizationId,
      storeId: campaignInput.storeId,
      createdById: input.actorId,
      status: EmailCampaignStatus.DRAFT,
      template: campaignInput.template,
      templateKey: campaignInput.templateKey,
      name: campaignInput.name,
      subject: campaignInput.subject || campaignInput.name,
      preheader: campaignInput.preheader,
      body: campaignInput.legacyBody,
      blocksJson: campaignInput.blocks as unknown as Prisma.InputJsonValue,
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
      logoImageId: logo.logoImageId,
      recipientCount: audience.summary.validRecipients,
    },
  });
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
  const config = getMarketingEmailConfiguration();
  if (!config.ready) {
    throw new AppError("emailMarketingNotConfigured", "BAD_REQUEST", 400);
  }
  requireEmailMarketingPublicAppBaseUrl();
  getEmailUnsubscribeSecret();

  const campaignInput = normalizeCampaignInput(input.campaign, {
    requireSubject: true,
    requireContent: true,
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
        template: campaignInput.template,
        templateKey: campaignInput.templateKey,
        name: campaignInput.name,
        subject: campaignInput.subject,
        preheader: campaignInput.preheader,
        body: campaignInput.legacyBody,
        blocksJson: campaignInput.blocks as unknown as Prisma.InputJsonValue,
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
    from: MARKETING_EMAIL_FROM,
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
  storeId: string;
  template: EmailCampaignTemplate;
  templateKey: string;
  name: string;
  subject: string;
  preheader: string | null;
  body: string;
  blocksJson: Prisma.JsonValue | null;
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
    storeId: campaign.storeId,
    name: campaign.name,
    audience: { mode: "segment", segment: "all" },
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

    try {
      await sendMarketingEmail({
        to: recipient.email,
        subject: campaign.subject,
        html: rendered.html,
        text: rendered.text,
        replyTo: campaign.replyToEmail,
      });
      sent += 1;
      await prisma.emailCampaignRecipient.update({
        where: { id: recipient.id },
        data: {
          status: EmailCampaignRecipientStatus.SENT,
          sentAt: new Date(),
        },
      });
    } catch (error) {
      failed += 1;
      await prisma.emailCampaignRecipient.update({
        where: { id: recipient.id },
        data: {
          status: EmailCampaignRecipientStatus.FAILED,
          errorMessage: error instanceof Error ? error.message : "emailSendFailed",
        },
      });
    }
  }

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
    },
    include: {
      createdBy: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(50, Math.max(1, input.limit ?? 20)),
  });
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
