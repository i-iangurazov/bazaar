import { CustomerSource, EmailCampaignFontFamily, EmailCampaignTemplate } from "@prisma/client";
import { z } from "zod";

import {
  getEmailCampaignDetail,
  getEmailMarketingAudiencePreview,
  getEmailMarketingOverview,
  listEmailMarketingCustomers,
  listEmailMarketingLogoGallery,
  listEmailCampaigns,
  previewEmailCampaign,
  saveEmailCampaignDraft,
  searchEmailMarketingProducts,
  sendEmailCampaignToAudience,
  sendTestEmailCampaign,
} from "@/server/services/emailMarketing";
import { runJob } from "@/server/jobs";
import { EMAIL_CAMPAIGN_SEND_JOB_NAME } from "@/server/jobs/emailMarketing";
import { toTRPCError } from "@/server/trpc/errors";
import { managerProcedure, rateLimit, router } from "@/server/trpc/trpc";

const sourceSchema = z
  .union([z.nativeEnum(CustomerSource), z.literal("ALL")])
  .optional()
  .nullable();

const audienceSchema = z
  .object({
    mode: z.enum(["manual", "segment"]).optional(),
    customerIds: z.array(z.string().min(1)).max(5_000).optional(),
    segment: z.enum(["all", "new", "source", "withPurchases", "withoutPurchases"]).optional(),
    source: sourceSchema,
    recentDays: z.number().int().min(1).max(365).optional().nullable(),
  })
  .optional()
  .nullable();

const headerBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal("header"),
  showStoreName: z.boolean().optional(),
  showLogo: z.boolean().optional(),
  heading: z.string().max(180).optional().nullable(),
});

const heroBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal("hero"),
  imageUrl: z.string().max(1_000).optional().nullable(),
  heading: z.string().max(180).optional().nullable(),
  subtitle: z.string().max(1_000).optional().nullable(),
  buttonText: z.string().max(80).optional().nullable(),
  buttonUrl: z.string().max(500).optional().nullable(),
});

const textBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal("text"),
  heading: z.string().max(180).optional().nullable(),
  body: z.string().max(8_000).optional().nullable(),
});

const buttonBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal("button"),
  text: z.string().max(80).optional().nullable(),
  url: z.string().max(500).optional().nullable(),
});

const productsBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal("products"),
  productIds: z.array(z.string().min(1)).max(12).optional(),
  showImage: z.boolean().optional(),
  showPrice: z.boolean().optional(),
  showButton: z.boolean().optional(),
  buttonText: z.string().max(80).optional().nullable(),
  buttonUrl: z.string().max(500).optional().nullable(),
  layout: z.enum(["one", "two"]).optional(),
});

const promoBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal("promo"),
  title: z.string().max(180).optional().nullable(),
  discountCode: z.string().max(80).optional().nullable(),
  description: z.string().max(1_000).optional().nullable(),
  expiryText: z.string().max(180).optional().nullable(),
  buttonText: z.string().max(80).optional().nullable(),
  buttonUrl: z.string().max(500).optional().nullable(),
});

const dividerBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal("divider"),
});

const footerBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal("footer"),
  storeName: z.string().max(180).optional().nullable(),
  phone: z.string().max(80).optional().nullable(),
  address: z.string().max(300).optional().nullable(),
  text: z.string().max(800).optional().nullable(),
  unsubscribeText: z.string().max(500).optional().nullable(),
  showUnsubscribe: z.boolean().optional(),
});

const blockSchema = z.discriminatedUnion("type", [
  headerBlockSchema,
  heroBlockSchema,
  textBlockSchema,
  buttonBlockSchema,
  productsBlockSchema,
  promoBlockSchema,
  dividerBlockSchema,
  footerBlockSchema,
]);

const campaignInputSchema = z.object({
  storeId: z.string().min(1),
  name: z.string().trim().max(180).optional().nullable(),
  audience: audienceSchema,
  source: sourceSchema,
  template: z.nativeEnum(EmailCampaignTemplate).optional(),
  templateKey: z.string().trim().max(80).optional().nullable(),
  subject: z.string().trim().max(180),
  preheader: z.string().trim().max(180).optional().nullable(),
  heading: z.string().trim().max(180).optional().nullable(),
  body: z.string().trim().max(8_000).optional().nullable(),
  ctaLabel: z.string().trim().max(80).optional().nullable(),
  ctaUrl: z.string().trim().max(500).optional().nullable(),
  footerText: z.string().trim().max(500).optional().nullable(),
  senderDisplayName: z.string().trim().max(120).optional().nullable(),
  replyToEmail: z.string().trim().max(254).optional().nullable(),
  brandColor: z.string().trim().max(7).optional().nullable(),
  buttonColor: z.string().trim().max(7).optional().nullable(),
  buttonTextColor: z.string().trim().max(7).optional().nullable(),
  backgroundColor: z.string().trim().max(7).optional().nullable(),
  contentBackgroundColor: z.string().trim().max(7).optional().nullable(),
  textColor: z.string().trim().max(7).optional().nullable(),
  mutedTextColor: z.string().trim().max(7).optional().nullable(),
  borderColor: z.string().trim().max(7).optional().nullable(),
  fontFamily: z.nativeEnum(EmailCampaignFontFamily).optional(),
  bannerImageUrl: z.string().trim().max(1_000).optional().nullable(),
  logoStoreId: z.string().trim().min(1).optional().nullable(),
  blocks: z.array(blockSchema).max(30).optional().nullable(),
});

export const emailMarketingRouter = router({
  logoGallery: managerProcedure.query(async ({ ctx }) => {
    try {
      return await listEmailMarketingLogoGallery({ user: ctx.user });
    } catch (error) {
      throw toTRPCError(error);
    }
  }),

  overview: managerProcedure
    .input(
      z
        .object({
          storeId: z.string().min(1).optional().nullable(),
          source: sourceSchema,
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await getEmailMarketingOverview({
          user: ctx.user,
          storeId: input?.storeId,
          source: input?.source,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  preview: managerProcedure.input(campaignInputSchema).mutation(async ({ ctx, input }) => {
    try {
      return await previewEmailCampaign({
        user: ctx.user,
        campaign: input,
      });
    } catch (error) {
      throw toTRPCError(error);
    }
  }),

  audiencePreview: managerProcedure
    .input(
      z.object({
        storeId: z.string().min(1),
        audience: audienceSchema,
        source: sourceSchema,
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await getEmailMarketingAudiencePreview({
          user: ctx.user,
          storeId: input.storeId,
          audience: input.audience,
          source: input.source,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  customers: managerProcedure
    .input(
      z.object({
        storeId: z.string().min(1),
        search: z.string().max(200).optional().nullable(),
        source: sourceSchema,
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(1).max(100).optional(),
        includeSelectableIds: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await listEmailMarketingCustomers({
          user: ctx.user,
          storeId: input.storeId,
          search: input.search,
          source: input.source,
          page: input.page,
          pageSize: input.pageSize,
          includeSelectableIds: input.includeSelectableIds,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  products: managerProcedure
    .input(
      z.object({
        storeId: z.string().min(1),
        search: z.string().max(200).optional().nullable(),
        category: z.string().max(180).optional().nullable(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await searchEmailMarketingProducts({
          user: ctx.user,
          storeId: input.storeId,
          search: input.search,
          category: input.category,
          limit: input.limit,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  sendTest: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 8, prefix: "email-marketing-test" }))
    .input(
      z.object({
        campaign: campaignInputSchema,
        to: z.string().trim().min(1).max(254),
        sampleCustomerId: z.string().min(1).optional().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await sendTestEmailCampaign({
          user: ctx.user,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          campaign: input.campaign,
          to: input.to,
          sampleCustomerId: input.sampleCustomerId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  saveDraft: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 20, prefix: "email-marketing-draft" }))
    .input(campaignInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await saveEmailCampaignDraft({
          user: ctx.user,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          campaign: input,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  send: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 3, prefix: "email-marketing-send" }))
    .input(campaignInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await sendEmailCampaignToAudience({
          user: ctx.user,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          campaign: input,
        });
        void runJob(EMAIL_CAMPAIGN_SEND_JOB_NAME, {
          organizationId: ctx.user.organizationId,
          campaignId: result.campaign.id,
          requestId: ctx.requestId,
        });
        return result;
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  history: managerProcedure
    .input(
      z.object({ storeId: z.string().min(1), limit: z.number().int().min(1).max(50).optional() }),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await listEmailCampaigns({
          user: ctx.user,
          storeId: input.storeId,
          limit: input.limit,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  detail: managerProcedure
    .input(z.object({ campaignId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      try {
        return await getEmailCampaignDetail({
          user: ctx.user,
          campaignId: input.campaignId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});
