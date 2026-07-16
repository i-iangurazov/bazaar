import {
  CustomerSource,
  EmailAutomationStatus,
  EmailCampaignFontFamily,
  EmailCampaignTemplate,
  EmailCampaignType,
} from "@prisma/client";
import { z } from "zod";

import {
  getEmailCampaignDetail,
  getEmailMarketingAudiencePreview,
  getEmailMarketingOverview,
  archiveEmailCampaign,
  archiveEmailSenderIdentity,
  checkEmailSenderDomain,
  continueEmailCampaignDelivery,
  createEmailSenderIdentity,
  deleteEmailCampaignDraft,
  duplicateEmailCampaign,
  listEmailMarketingCustomers,
  listEmailMarketingLogoGallery,
  listEmailCampaigns,
  listEmailAutomations,
  listEmailSenderSetup,
  previewEmailCampaign,
  saveEmailCampaignDraft,
  searchEmailMarketingProducts,
  sendEmailCampaignToAudience,
  sendSavedEmailCampaignToAudience,
  sendTestEmailCampaign,
  testEmailAutomation,
  updateEmailAutomation,
} from "@/server/services/emailMarketing";
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
const blockAlignmentSchema = z.enum(["left", "center", "right"]);
const textFontSizeSchema = z.enum(["small", "normal", "large", "huge"]);

const headerBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal("header"),
  showStoreName: z.boolean().optional(),
  showLogo: z.boolean().optional(),
  storeName: z.string().max(180).optional().nullable(),
  heading: z.string().max(180).optional().nullable(),
  alignment: blockAlignmentSchema.optional(),
});

const heroBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal("hero"),
  imageUrl: z.string().max(1_000).optional().nullable(),
  heading: z.string().max(180).optional().nullable(),
  subtitle: z.string().max(1_000).optional().nullable(),
  buttonText: z.string().max(80).optional().nullable(),
  buttonUrl: z.string().max(500).optional().nullable(),
  alignment: blockAlignmentSchema.optional(),
});

const textBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal("text"),
  heading: z.string().max(180).optional().nullable(),
  body: z.string().max(8_000).optional().nullable(),
  bodyBold: z.boolean().optional(),
  bodyFontSize: textFontSizeSchema.optional(),
  alignment: blockAlignmentSchema.optional(),
});

const buttonBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal("button"),
  text: z.string().max(80).optional().nullable(),
  url: z.string().max(500).optional().nullable(),
  alignment: blockAlignmentSchema.optional(),
});

const productsBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal("products"),
  productIds: z.array(z.string().min(1)).max(12).optional(),
  showImage: z.boolean().optional(),
  showPrice: z.boolean().optional(),
  showDescription: z.boolean().optional(),
  showButton: z.boolean().optional(),
  buttonText: z.string().max(80).optional().nullable(),
  buttonUrl: z.string().max(500).optional().nullable(),
  productButtonUrls: z.record(z.string().max(500)).optional(),
  layout: z.enum(["one", "two"]).optional(),
  alignment: blockAlignmentSchema.optional(),
});

const orderSummaryBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal("orderSummary"),
  title: z.string().max(180).optional().nullable(),
  summaryText: z.string().max(500).optional().nullable(),
  itemsLabel: z.string().max(120).optional().nullable(),
  totalLabel: z.string().max(120).optional().nullable(),
  emptyOrderText: z.string().max(500).optional().nullable(),
  quantitySeparator: z.string().max(12).optional().nullable(),
  sampleItemName: z.string().max(180).optional().nullable(),
  showSummary: z.boolean().optional(),
  showItems: z.boolean().optional(),
  showTotals: z.boolean().optional(),
  alignment: blockAlignmentSchema.optional(),
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
  alignment: blockAlignmentSchema.optional(),
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
  alignment: blockAlignmentSchema.optional(),
});

const blockSchema = z.discriminatedUnion("type", [
  headerBlockSchema,
  heroBlockSchema,
  textBlockSchema,
  buttonBlockSchema,
  productsBlockSchema,
  orderSummaryBlockSchema,
  promoBlockSchema,
  dividerBlockSchema,
  footerBlockSchema,
]);

const campaignInputSchema = z.object({
  id: z.string().trim().min(1).optional().nullable(),
  storeId: z.string().min(1),
  campaignType: z.nativeEnum(EmailCampaignType).optional(),
  senderIdentityId: z.string().trim().min(1).optional().nullable(),
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

const kickEmailCampaignDelivery = async (input: {
  user: Parameters<typeof continueEmailCampaignDelivery>[0]["user"];
  campaignId: string;
}) => {
  try {
    return await continueEmailCampaignDelivery({
      user: input.user,
      campaignId: input.campaignId,
    });
  } catch (error) {
    return {
      processed: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      pending: 0,
      campaigns: [input.campaignId],
      error: error instanceof Error ? error.message : "emailCampaignDeliveryKickFailed",
    };
  }
};

export const emailMarketingRouter = router({
  logoGallery: managerProcedure.query(async ({ ctx }) => {
    try {
      return await listEmailMarketingLogoGallery({ user: ctx.user });
    } catch (error) {
      throw toTRPCError(error);
    }
  }),

  senders: managerProcedure
    .input(z.object({ storeId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      try {
        return await listEmailSenderSetup({ user: ctx.user, storeId: input.storeId });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  createSender: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 10, prefix: "email-sender-create" }))
    .input(
      z.object({
        storeId: z.string().min(1),
        displayName: z.string().trim().min(1).max(120),
        fromEmail: z.string().trim().min(3).max(254),
        replyToEmail: z.string().trim().max(254).optional().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await createEmailSenderIdentity({
          user: ctx.user,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          ...input,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  checkSenderDomain: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 12, prefix: "email-domain-check" }))
    .input(
      z.object({
        domainId: z.string().min(1),
        triggerVerification: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await checkEmailSenderDomain({
          user: ctx.user,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          domainId: input.domainId,
          triggerVerification: input.triggerVerification,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  archiveSender: managerProcedure
    .input(z.object({ senderId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await archiveEmailSenderIdentity({
          user: ctx.user,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          senderId: input.senderId,
        });
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
        includeIds: z.array(z.string().min(1)).max(500).optional(),
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
          includeIds: input.includeIds,
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
    .use(rateLimit({ windowMs: 60_000, max: 20, prefix: "email-marketing-send" }))
    .input(campaignInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await sendEmailCampaignToAudience({
          user: ctx.user,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          campaign: input,
        });
        const delivery = await kickEmailCampaignDelivery({
          user: ctx.user,
          campaignId: result.campaign.id,
        });
        return { ...result, delivery };
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  sendCampaign: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 20, prefix: "email-marketing-send-saved" }))
    .input(z.object({ campaignId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await sendSavedEmailCampaignToAudience({
          user: ctx.user,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          campaignId: input.campaignId,
        });
        const delivery = await kickEmailCampaignDelivery({
          user: ctx.user,
          campaignId: result.campaign.id,
        });
        return { ...result, delivery };
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  resumeCampaign: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 30, prefix: "email-marketing-resume" }))
    .input(z.object({ campaignId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await continueEmailCampaignDelivery({
          user: ctx.user,
          campaignId: input.campaignId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  duplicateCampaign: managerProcedure
    .input(z.object({ campaignId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await duplicateEmailCampaign({
          user: ctx.user,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          campaignId: input.campaignId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  archiveCampaign: managerProcedure
    .input(z.object({ campaignId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await archiveEmailCampaign({
          user: ctx.user,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          campaignId: input.campaignId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  deleteCampaignDraft: managerProcedure
    .input(z.object({ campaignId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await deleteEmailCampaignDraft({
          user: ctx.user,
          campaignId: input.campaignId,
        });
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

  automations: managerProcedure
    .input(z.object({ storeId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      try {
        return await listEmailAutomations({ user: ctx.user, storeId: input.storeId });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  updateAutomation: managerProcedure
    .input(
      z.object({
        automationId: z.string().min(1),
        status: z.nativeEnum(EmailAutomationStatus).optional(),
        senderIdentityId: z.string().min(1).optional().nullable(),
	        subject: z.string().trim().max(180).optional().nullable(),
	        preheader: z.string().trim().max(180).optional().nullable(),
	        brandColor: z.string().max(24).optional().nullable(),
	        buttonColor: z.string().max(24).optional().nullable(),
	        buttonTextColor: z.string().max(24).optional().nullable(),
	        backgroundColor: z.string().max(24).optional().nullable(),
	        contentBackgroundColor: z.string().max(24).optional().nullable(),
	        textColor: z.string().max(24).optional().nullable(),
	        mutedTextColor: z.string().max(24).optional().nullable(),
	        borderColor: z.string().max(24).optional().nullable(),
	        fontFamily: z.nativeEnum(EmailCampaignFontFamily).optional(),
	        logoStoreId: z.string().min(1).optional().nullable(),
	        blocks: z.array(blockSchema).max(30).optional().nullable(),
	      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await updateEmailAutomation({
          user: ctx.user,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          automationId: input.automationId,
          status: input.status,
	          senderIdentityId: input.senderIdentityId,
	          subject: input.subject,
	          preheader: input.preheader,
	          brandColor: input.brandColor,
	          buttonColor: input.buttonColor,
	          buttonTextColor: input.buttonTextColor,
	          backgroundColor: input.backgroundColor,
	          contentBackgroundColor: input.contentBackgroundColor,
	          textColor: input.textColor,
	          mutedTextColor: input.mutedTextColor,
	          borderColor: input.borderColor,
	          fontFamily: input.fontFamily,
	          logoStoreId: input.logoStoreId,
	          blocks: input.blocks,
	        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  testAutomation: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 8, prefix: "email-automation-test" }))
    .input(
      z.object({
        automationId: z.string().min(1),
        to: z.string().trim().min(1).max(254),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await testEmailAutomation({
          user: ctx.user,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          automationId: input.automationId,
          to: input.to,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});
