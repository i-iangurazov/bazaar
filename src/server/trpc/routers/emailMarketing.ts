import { CustomerSource, EmailCampaignFontFamily, EmailCampaignTemplate } from "@prisma/client";
import { z } from "zod";

import {
  getEmailMarketingOverview,
  listEmailMarketingLogoGallery,
  listEmailCampaigns,
  previewEmailCampaign,
  sendEmailCampaignToAudience,
} from "@/server/services/emailMarketing";
import { runJob } from "@/server/jobs";
import { EMAIL_CAMPAIGN_SEND_JOB_NAME } from "@/server/jobs/emailMarketing";
import { toTRPCError } from "@/server/trpc/errors";
import { managerProcedure, rateLimit, router } from "@/server/trpc/trpc";

const sourceSchema = z
  .union([z.nativeEnum(CustomerSource), z.literal("ALL")])
  .optional()
  .nullable();

const campaignInputSchema = z.object({
  storeId: z.string().min(1),
  source: sourceSchema,
  template: z.nativeEnum(EmailCampaignTemplate).optional(),
  subject: z.string().trim().min(1).max(180),
  preheader: z.string().trim().max(180).optional().nullable(),
  heading: z.string().trim().max(180).optional().nullable(),
  body: z.string().trim().min(1).max(8_000),
  ctaLabel: z.string().trim().max(80).optional().nullable(),
  ctaUrl: z.string().trim().max(500).optional().nullable(),
  footerText: z.string().trim().max(500).optional().nullable(),
  senderDisplayName: z.string().trim().max(120).optional().nullable(),
  replyToEmail: z.string().trim().max(254).optional().nullable(),
  brandColor: z.string().trim().max(7).optional().nullable(),
  buttonColor: z.string().trim().max(7).optional().nullable(),
  fontFamily: z.nativeEnum(EmailCampaignFontFamily).optional(),
  bannerImageUrl: z.string().trim().max(1_000).optional().nullable(),
  logoStoreId: z.string().trim().min(1).optional().nullable(),
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

  preview: managerProcedure.input(campaignInputSchema).query(async ({ ctx, input }) => {
    try {
      return await previewEmailCampaign({
        user: ctx.user,
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
});
