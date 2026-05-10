import { createHmac, timingSafeEqual } from "node:crypto";

import {
  EmailCampaignFontFamily,
  EmailCampaignRecipientStatus,
  EmailCampaignStatus,
  EmailCampaignTemplate,
} from "@prisma/client";
import type { CustomerSource } from "@prisma/client";

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
import {
  countEmailReachableCustomers,
  listEmailReachableCustomers,
} from "@/server/services/customers";

type EmailCampaignComposerInput = {
  storeId: string;
  source?: CustomerSource | "ALL" | null;
  template?: EmailCampaignTemplate;
  subject: string;
  preheader?: string | null;
  heading?: string | null;
  body: string;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  footerText?: string | null;
  senderDisplayName?: string | null;
  replyToEmail?: string | null;
  brandColor?: string | null;
  buttonColor?: string | null;
  fontFamily?: EmailCampaignFontFamily;
  bannerImageUrl?: string | null;
  logoStoreId?: string | null;
};

const defaultBrandColor = "#111827";
const defaultButtonColor = "#111827";

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

const textToParagraphs = (value: string) =>
  value
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map(
      (part) =>
        `<p style="margin:0 0 14px;color:#374151;font-size:15px;line-height:1.65;">${escapeHtml(part).replace(/\n/g, "<br />")}</p>`,
    )
    .join("");

const validateCampaignInput = (input: EmailCampaignComposerInput) => {
  const subject = input.subject.trim();
  const body = input.body.trim();
  if (!subject) {
    throw new AppError("emailCampaignSubjectRequired", "BAD_REQUEST", 400);
  }
  if (!body) {
    throw new AppError("emailCampaignBodyRequired", "BAD_REQUEST", 400);
  }
  const ctaUrl = trimOptional(input.ctaUrl);
  if (ctaUrl) {
    try {
      new URL(ctaUrl);
    } catch {
      throw new AppError("emailCampaignCtaUrlInvalid", "BAD_REQUEST", 400);
    }
  }
  const replyToEmail = trimOptional(input.replyToEmail);
  if (replyToEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyToEmail)) {
    throw new AppError("emailCampaignReplyToInvalid", "BAD_REQUEST", 400);
  }
  return {
    storeId: input.storeId,
    source: input.source ?? "ALL",
    template: input.template ?? EmailCampaignTemplate.CUSTOM,
    subject,
    preheader: trimOptional(input.preheader),
    heading: trimOptional(input.heading),
    body,
    ctaLabel: trimOptional(input.ctaLabel),
    ctaUrl,
    footerText: trimOptional(input.footerText),
    senderDisplayName: trimOptional(input.senderDisplayName),
    replyToEmail,
    brandColor: normalizeColor(input.brandColor, defaultBrandColor),
    buttonColor: normalizeColor(input.buttonColor, defaultButtonColor),
    fontFamily: input.fontFamily ?? EmailCampaignFontFamily.INTER,
    bannerImageUrl: trimOptional(input.bannerImageUrl),
    logoStoreId: trimOptional(input.logoStoreId),
  };
};

const cssFontFamily = (fontFamily: EmailCampaignFontFamily) => {
  if (fontFamily === EmailCampaignFontFamily.JOST) {
    return "Jost, Inter, Segoe UI, Arial, sans-serif";
  }
  if (fontFamily === EmailCampaignFontFamily.SYSTEM) {
    return "-apple-system, BlinkMacSystemFont, Segoe UI, Arial, sans-serif";
  }
  return "Inter, Segoe UI, Arial, sans-serif";
};

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

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
      // ignore invalid app URL configuration
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

const normalizeUnsubscribeEmail = (email: string) => email.trim().toLowerCase();

export const createEmailUnsubscribeToken = (input: { customerId: string; email: string }) =>
  createHmac("sha256", getEmailUnsubscribeSecret())
    .update(`${input.customerId}:${normalizeUnsubscribeEmail(input.email)}`)
    .digest("base64url");

const isValidEmailUnsubscribeToken = (input: { customerId: string; email: string; token: string }) => {
  const expected = createEmailUnsubscribeToken(input);
  const provided = input.token.trim();
  if (!provided) {
    return false;
  }
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
};

export const buildEmailUnsubscribeUrl = (input: {
  baseUrl: string;
  customerId: string;
  email: string;
}) => {
  const url = new URL("/api/email-marketing/unsubscribe", input.baseUrl);
  url.searchParams.set("customerId", input.customerId);
  url.searchParams.set("email", normalizeUnsubscribeEmail(input.email));
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
  const email = normalizeUnsubscribeEmail(input.email);
  const customer = await prisma.customer.findUnique({
    where: { id: input.customerId },
    select: {
      id: true,
      email: true,
      emailMarketingUnsubscribedAt: true,
    },
  });
  if (!customer || normalizeUnsubscribeEmail(customer.email ?? "") !== email) {
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

export const renderEmailCampaign = (input: {
  campaign: ReturnType<typeof validateCampaignInput>;
  storeName: string;
  logoUrl?: string | null;
  unsubscribeUrl?: string | null;
}) => {
  const fontFamily = cssFontFamily(input.campaign.fontFamily);
  const storeName = escapeHtml(input.storeName);
  const heading = escapeHtml(input.campaign.heading ?? input.campaign.subject);
  const preheader = input.campaign.preheader ? escapeHtml(input.campaign.preheader) : "";
  const footerText =
    input.campaign.footerText ??
    "You are receiving this message because your email is in this store customer database.";
  const cta =
    input.campaign.ctaLabel && input.campaign.ctaUrl
      ? `<p style="margin:20px 0;"><a href="${escapeHtml(input.campaign.ctaUrl)}" style="display:inline-block;background:${input.campaign.buttonColor};color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:0;font-weight:700;">${escapeHtml(input.campaign.ctaLabel)}</a></p>`
      : "";
  const banner = input.campaign.bannerImageUrl
    ? `<img src="${escapeHtml(input.campaign.bannerImageUrl)}" alt="" style="display:block;width:100%;max-height:260px;object-fit:cover;margin:0 0 20px;" />`
    : "";
  const logo = input.logoUrl
    ? `<img src="${escapeHtml(input.logoUrl)}" alt="${storeName}" width="140" style="display:block;width:140px;max-width:100%;max-height:120px;height:auto;object-fit:contain;" />`
    : `<strong style="font-size:18px;letter-spacing:0;color:${input.campaign.brandColor};">${storeName}</strong>`;
  const unsubscribeLine = input.unsubscribeUrl
    ? `Unsubscribe: ${input.unsubscribeUrl}`
    : "Unsubscribe preferences are managed by the store.";
  const unsubscribeHtml = input.unsubscribeUrl
    ? `<a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#4b5563;text-decoration:underline;">Unsubscribe</a>`
    : "Unsubscribe preferences are managed by the store.";
  const text = [
    input.campaign.heading ?? input.campaign.subject,
    input.campaign.body,
    input.campaign.ctaLabel && input.campaign.ctaUrl
      ? `${input.campaign.ctaLabel}: ${input.campaign.ctaUrl}`
      : null,
    footerText,
    `From: ${MARKETING_EMAIL_FROM}`,
    unsubscribeLine,
  ]
    .filter(Boolean)
    .join("\n\n");

  const html = `
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
    <div style="background:#f3f4f6;padding:24px;font-family:${fontFamily};">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;">
        <div style="padding:22px 24px;border-bottom:1px solid #e5e7eb;">${logo}</div>
        <div style="padding:24px;">
          ${banner}
          <h1 style="margin:0 0 14px;color:${input.campaign.brandColor};font-size:24px;line-height:1.25;">${heading}</h1>
          ${textToParagraphs(input.campaign.body)}
          ${cta}
        </div>
        <div style="padding:18px 24px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;line-height:1.5;">
          <p style="margin:0 0 8px;">${escapeHtml(footerText)}</p>
          <p style="margin:0;">${storeName} · ${MARKETING_EMAIL_FROM}</p>
          <p style="margin:8px 0 0;">${unsubscribeHtml}</p>
        </div>
      </div>
    </div>
  `;

  return { html, text };
};

const getStoreBrand = async (input: { organizationId: string; storeId: string }) => {
  const store = await prisma.store.findFirst({
    where: { id: input.storeId, organizationId: input.organizationId },
    select: {
      id: true,
      name: true,
      legalName: true,
      bazaarCatalog: {
        select: {
          accentColor: true,
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
  const stores = await listAccessibleStores(prisma, input.user);
  const storeIds = stores.map((store) => store.id);
  if (!storeIds.length) {
    return [];
  }

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
      imageId: logo?.imageId ?? null,
      logoUrl: resolveEmailMarketingAssetUrl(logo?.image.url) ?? null,
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

  return {
    logoImageId: logo?.imageId ?? null,
    logoUrl: resolveEmailMarketingAssetUrl(logo?.image.url) ?? null,
  };
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
      reachableCustomers: 0,
      status: "NOT_CONFIGURED" as const,
      config,
    };
  }
  await assertUserCanAccessStore(prisma, input.user, storeId);
  const reachableCustomers = await countEmailReachableCustomers({
    user: input.user,
    storeId,
    source: input.source,
  });
  const status = config.ready ? "READY" : "NOT_CONFIGURED";
  return { storeId, reachableCustomers, status, config };
};

export const previewEmailCampaign = async (input: {
  user: StoreAccessUser;
  campaign: EmailCampaignComposerInput;
}) => {
  await assertUserCanAccessStore(prisma, input.user, input.campaign.storeId);
  const campaign = validateCampaignInput(input.campaign);
  const brand = await getStoreBrand({
    organizationId: input.user.organizationId,
    storeId: campaign.storeId,
  });
  const logo = await resolveCampaignLogo({
    user: input.user,
    campaignStoreId: campaign.storeId,
    logoStoreId: campaign.logoStoreId,
  });
  const reachableCustomers = await countEmailReachableCustomers({
    user: input.user,
    storeId: campaign.storeId,
    source: campaign.source,
  });
  const rendered = renderEmailCampaign({
    campaign: {
      ...campaign,
      brandColor: campaign.brandColor ?? brand.brandColor,
    },
    storeName: brand.storeName,
    logoUrl: logo.logoUrl,
  });
  return {
    reachableCustomers,
    from: MARKETING_EMAIL_FROM,
    rendered,
  };
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

  const campaignInput = validateCampaignInput(input.campaign);
  const logo = await resolveCampaignLogo({
    user: input.user,
    campaignStoreId: campaignInput.storeId,
    logoStoreId: campaignInput.logoStoreId,
  });
  const customers = await listEmailReachableCustomers({
    organizationId: input.user.organizationId,
    storeId: campaignInput.storeId,
    source: campaignInput.source,
  });
  if (!customers.length) {
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
        subject: campaignInput.subject,
        preheader: campaignInput.preheader,
        heading: campaignInput.heading,
        body: campaignInput.body,
        ctaLabel: campaignInput.ctaLabel,
        ctaUrl: campaignInput.ctaUrl,
        footerText: campaignInput.footerText,
        senderDisplayName: campaignInput.senderDisplayName,
        replyToEmail: campaignInput.replyToEmail,
        brandColor: campaignInput.brandColor,
        buttonColor: campaignInput.buttonColor,
        fontFamily: campaignInput.fontFamily,
        bannerImageUrl: campaignInput.bannerImageUrl,
        logoImageId: logo.logoImageId,
        recipientCount: customers.length,
        recipients: {
          create: customers.map((customer) => ({
            organizationId: input.user.organizationId,
            customerId: customer.id,
            email: customer.email ?? "",
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
        recipientCount: customers.length,
      }),
      requestId: input.requestId,
    });
    return created;
  });

  return {
    campaign,
    sent: 0,
    failed: 0,
    recipientCount: customers.length,
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
  subject: string;
  preheader: string | null;
  heading: string | null;
  body: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
  footerText: string | null;
  senderDisplayName: string | null;
  replyToEmail: string | null;
  brandColor: string | null;
  buttonColor: string | null;
  fontFamily: EmailCampaignFontFamily;
  bannerImageUrl: string | null;
  store: { bazaarCatalog: { accentColor: string | null } | null };
}) =>
  validateCampaignInput({
    storeId: campaign.storeId,
    source: "ALL",
    template: campaign.template,
    subject: campaign.subject,
    preheader: campaign.preheader,
    heading: campaign.heading,
    body: campaign.body,
    ctaLabel: campaign.ctaLabel,
    ctaUrl: campaign.ctaUrl,
    footerText: campaign.footerText,
    senderDisplayName: campaign.senderDisplayName,
    replyToEmail: campaign.replyToEmail,
    brandColor: campaign.brandColor ?? campaign.store.bazaarCatalog?.accentColor ?? defaultBrandColor,
    buttonColor: campaign.buttonColor ?? defaultButtonColor,
    fontFamily: campaign.fontFamily,
    bannerImageUrl: campaign.bannerImageUrl,
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
          name: true,
          legalName: true,
          bazaarCatalog: { select: { accentColor: true } },
        },
      },
      logoImage: { select: { url: true } },
      recipients: {
        where: { status: EmailCampaignRecipientStatus.PENDING },
        include: {
          customer: {
            select: {
              id: true,
              email: true,
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
  const storeName = campaign.store.legalName?.trim() || campaign.store.name;
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const recipient of campaign.recipients) {
    const recipientEmail = normalizeUnsubscribeEmail(recipient.email);
    const customerEmail = normalizeUnsubscribeEmail(recipient.customer.email ?? "");
    if (
      !recipientEmail ||
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
      storeName,
      logoUrl,
      unsubscribeUrl,
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
  const countByStatus = new Map(
    statusCounts.map((row) => [row.status, row._count._all]),
  );
  const totalFailed = countByStatus.get(EmailCampaignRecipientStatus.FAILED) ?? 0;
  const totalPending = countByStatus.get(EmailCampaignRecipientStatus.PENDING) ?? 0;
  const finalStatus =
    totalPending > 0 || totalFailed > 0 ? EmailCampaignStatus.FAILED : EmailCampaignStatus.SENT;

  const updated = await prisma.emailCampaign.update({
    where: { id: campaign.id },
    data: {
      status: finalStatus,
      sentAt: finalStatus === EmailCampaignStatus.SENT ? new Date() : null,
      errorMessage:
        finalStatus === EmailCampaignStatus.FAILED ? "emailCampaignPartialOrFullFailure" : null,
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
