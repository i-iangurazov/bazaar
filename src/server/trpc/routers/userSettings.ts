import { ThemePreference } from "@prisma/client";
import { z } from "zod";

import { defaultLocale, normalizeLocale } from "@/lib/locales";
import {
  getMyProfile,
  updateMyPreferences,
  updateMyProfile,
} from "@/server/services/userSettings";
import { toTRPCError } from "@/server/trpc/errors";
import { protectedProcedure, router } from "@/server/trpc/trpc";

export const userSettingsRouter = router({
  getMyProfile: protectedProcedure.query(async ({ ctx }) => {
    try {
      return await getMyProfile({
        userId: ctx.user.id,
        organizationId: ctx.user.organizationId,
      });
    } catch (error) {
      throw toTRPCError(error);
    }
  }),

  updateMyProfile: protectedProcedure
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

  updateMyPreferences: protectedProcedure
    .input(
      z.object({
        preferredLocale: z.enum(["ru", "kg"]).optional(),
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
