import { ThemePreference } from "@prisma/client";
import { z } from "zod";

import { defaultLocale, locales, normalizeLocale } from "@/lib/locales";
import {
  getMyLoginPhone,
  getMyProfile,
  updateMyLoginPhone,
  updateMyPreferences,
  updateMyProfile,
} from "@/server/services/userSettings";
import { toTRPCError } from "@/server/trpc/errors";
import { personalAccountProcedure, rateLimit, router } from "@/server/trpc/trpc";
import { deleteOwnAccount, getAccountDeletionPreview } from "@/server/services/accountDeletion";
import { getAiConsent, updateAiConsent } from "@/server/services/aiPrivacy";
import { keepBackgroundTaskAlive } from "@/server/jobs/background";

export const userSettingsRouter = router({
  aiConsent: personalAccountProcedure.query(async ({ ctx }) => {
    try { return await getAiConsent({ userId: ctx.user.id, organizationId: ctx.user.organizationId }); }
    catch (error) { throw toTRPCError(error); }
  }),
  updateAiConsent: personalAccountProcedure
    .input(z.object({ granted: z.boolean(), version: z.string().max(40) }).strict())
    .mutation(async ({ ctx, input }) => {
      try { return await updateAiConsent({ ...input, userId: ctx.user.id,
        organizationId: ctx.user.organizationId, requestId: ctx.requestId }); }
      catch (error) { throw toTRPCError(error); }
    }),
  accountDeletionPreview: personalAccountProcedure.query(async ({ ctx }) => {
    try { return await getAccountDeletionPreview({ userId: ctx.user.id, organizationId: ctx.user.organizationId }); }
    catch (error) { throw toTRPCError(error); }
  }),
  deleteMyAccount: personalAccountProcedure
    .use(rateLimit({ windowMs: 15 * 60_000, max: 5, prefix: "own-account-delete" }))
    .input(z.object({ password: z.string().min(1).max(1024), confirmation: z.literal("DELETE"),
      successorUserId: z.string().min(1).max(100).optional() }).strict())
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await deleteOwnAccount({ ...input, userId: ctx.user.id,
          organizationId: ctx.user.organizationId, requestId: ctx.requestId });
        // Durable recovery is scheduled as well; request only a bounded attempt.
        keepBackgroundTaskAlive(import("@/server/jobs").then(({ runJob }) => runJob("account-asset-erasure"))
          .catch(() => undefined));
        return result;
      } catch (error) { throw toTRPCError(error); }
    }),
  getMyProfile: personalAccountProcedure.query(async ({ ctx }) => {
    try {
      return await getMyProfile({
        userId: ctx.user.id,
        organizationId: ctx.user.organizationId,
      });
    } catch (error) {
      throw toTRPCError(error);
    }
  }),

  getMyLoginPhone: personalAccountProcedure.query(async ({ ctx }) => {
    try {
      return await getMyLoginPhone({ userId: ctx.user.id, organizationId: ctx.user.organizationId });
    } catch (error) {
      throw toTRPCError(error);
    }
  }),

  updateMyLoginPhone: personalAccountProcedure
    .use(rateLimit({ windowMs: 15 * 60_000, max: 5, prefix: "own-login-phone" }))
    .input(z.object({ phone: z.string().max(40).nullable(), password: z.string().min(1).max(1024) }).strict())
    .mutation(async ({ ctx, input }) => {
      try {
        return await updateMyLoginPhone({
          ...input,
          userId: ctx.user.id,
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  updateMyProfile: personalAccountProcedure
    .input(
      z.object({
        name: z.string().min(2),
        phone: z.string().max(40).nullable().optional(),
        jobTitle: z.string().max(120).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await updateMyProfile({
          userId: ctx.user.id,
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          name: input.name.trim(),
          phone: input.phone ?? null,
          jobTitle: input.jobTitle ?? null,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  updateMyPreferences: personalAccountProcedure
    .input(
      z.object({
        preferredLocale: z.enum(locales).optional(),
        themePreference: z.preprocess(
          (value) => (value === "" ? undefined : value),
          z.nativeEnum(ThemePreference).optional(),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const preferredLocale = input.preferredLocale
          ? (normalizeLocale(input.preferredLocale) ?? defaultLocale)
          : undefined;
        return await updateMyPreferences({
          userId: ctx.user.id,
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          preferredLocale,
          themePreference: input.themePreference,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});
