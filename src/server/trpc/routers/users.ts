import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import { createUser, resetUserPassword, setUserActive, updatePreferredLocale, updateUser } from "@/server/services/users";
import { defaultLocale, normalizeLocale } from "@/lib/locales";

export const usersRouter = router({
  list: adminProcedure.query(async ({ ctx }) => {
    return ctx.prisma.user.findMany({
      where: { organizationId: ctx.user.organizationId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        preferredLocale: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }),

  create: adminProcedure
    .input(
      z.object({
        email: z.string().email(),
        name: z.string().min(2),
        role: z.enum(["ADMIN", "MANAGER", "STAFF", "CASHIER"]),
        password: z.string().min(8),
        preferredLocale: z.enum(["ru", "kg"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await createUser({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          email: input.email,
          name: input.name,
          role: input.role,
          password: input.password,
          preferredLocale: input.preferredLocale ?? defaultLocale,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  update: adminProcedure
    .input(
      z.object({
        userId: z.string(),
        email: z.string().email(),
        name: z.string().min(2),
        role: z.enum(["ADMIN", "MANAGER", "STAFF", "CASHIER"]),
        preferredLocale: z.enum(["ru", "kg"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await updateUser({
          userId: input.userId,
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          email: input.email,
          name: input.name,
          role: input.role,
          preferredLocale: input.preferredLocale,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  setActive: adminProcedure
    .input(z.object({ userId: z.string(), isActive: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await setUserActive({
          userId: input.userId,
          isActive: input.isActive,
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  resetPassword: adminProcedure
    .input(z.object({ userId: z.string(), password: z.string().min(8) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await resetUserPassword({
          userId: input.userId,
          password: input.password,
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  updateLocale: protectedProcedure
    .input(z.object({ locale: z.enum(["ru", "kg"]) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const resolvedLocale = normalizeLocale(input.locale) ?? defaultLocale;
        return await updatePreferredLocale({
          userId: ctx.user.id,
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          locale: resolvedLocale,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});
