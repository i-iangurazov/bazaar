import { z } from "zod";
import type { LegalEntityType } from "@prisma/client";

import { publicProcedure, rateLimit, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import {
  createSignup,
  registerBusinessFromToken,
  requestAccess,
  sendEmailVerificationToken,
} from "@/server/services/signup";
import { consumeAuthToken, createAuthToken } from "@/server/services/authTokens";
import { sendResetEmail } from "@/server/services/email";
import { getInviteByToken, acceptInvite } from "@/server/services/invites";
import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import bcrypt from "bcryptjs";
import { writeAuditLog } from "@/server/services/audit";
import { toJson } from "@/server/services/json";
import { isEmailVerificationRequired } from "@/server/config/auth";

const emailSchema = z.string().email();
const sanitizeUserAudit = <T extends { passwordHash?: string }>(user: T | null) => {
  if (!user) {
    return null;
  }
  const { passwordHash: _passwordHash, ...safeUser } = user;
  void _passwordHash;
  return safeUser;
};

export const publicAuthRouter = router({
  signupMode: publicProcedure.query(() => ({
    mode: process.env.SIGNUP_MODE ?? "invite_only",
  })),

  requestAccess: publicProcedure
    .use(rateLimit({ windowMs: 60_000, max: 5, prefix: "access-request" }))
    .input(z.object({ email: emailSchema, orgName: z.string().optional() }))
    .mutation(async ({ input }) => {
      try {
        return await requestAccess({ email: input.email, orgName: input.orgName });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  signup: publicProcedure
    .use(rateLimit({ windowMs: 60_000, max: 3, prefix: "signup" }))
    .input(
      z.object({
        email: emailSchema,
        password: z.string().min(8),
        name: z.string().min(2),
        preferredLocale: z.enum(["ru", "kg"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await createSignup({
          email: input.email,
          password: input.password,
          name: input.name,
          preferredLocale: input.preferredLocale,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  verifyEmail: publicProcedure
    .use(rateLimit({ windowMs: 60_000, max: 10, prefix: "verify-email" }))
    .input(z.object({ token: z.string().min(10) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const token = await consumeAuthToken({ purpose: "EMAIL_VERIFY", token: input.token });
        if (!token.userId) {
          throw new AppError("tokenInvalid", "NOT_FOUND", 404);
        }
        const user = await prisma.user.findUnique({ where: { id: token.userId } });
        if (!user) {
          throw new AppError("userNotFound", "NOT_FOUND", 404);
        }
        const updated = await prisma.user.update({
          where: { id: user.id },
          data: { emailVerifiedAt: new Date() },
        });

        const storeCount = updated.organizationId
          ? await prisma.store.count({
              where: { organizationId: updated.organizationId },
            })
          : 0;

        let nextPath = "/login";
        let registrationToken: string | null = null;
        if (!updated.organizationId || storeCount === 0) {
          const registration = await createAuthToken({
            userId: updated.id,
            email: updated.email,
            purpose: "REGISTRATION",
            expiresInMinutes: 60,
            organizationId: updated.organizationId,
            actorId: updated.id,
            requestId: ctx.requestId,
          });
          registrationToken = registration.raw;
          nextPath = `/register-business/${registration.raw}`;
        }

        if (updated.organizationId) {
          await writeAuditLog(prisma, {
            organizationId: updated.organizationId,
            actorId: updated.id,
            action: "EMAIL_VERIFY",
            entity: "User",
            entityId: updated.id,
            before: toJson(sanitizeUserAudit(user)),
            after: toJson(updated),
            requestId: ctx.requestId,
          });
        }

        return { verified: true, nextPath, registrationToken };
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  registerBusiness: publicProcedure
    .use(rateLimit({ windowMs: 60_000, max: 5, prefix: "register-business" }))
    .input(
      z.object({
        token: z.string().min(10),
        orgName: z.string().min(2),
        storeName: z.string().min(2),
        storeCode: z.string().min(2),
        legalEntityType: z.enum(["IP", "OSOO", "AO", "OTHER"] as const).optional(),
        legalName: z.string().optional(),
        inn: z.string().optional(),
        address: z.string().optional(),
        phone: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const registration = await registerBusinessFromToken({
          token: input.token,
          orgName: input.orgName,
          storeName: input.storeName,
          storeCode: input.storeCode,
          legalEntityType: (input.legalEntityType as LegalEntityType | undefined) ?? null,
          legalName: input.legalName,
          inn: input.inn,
          address: input.address,
          phone: input.phone,
          requestId: ctx.requestId,
        });
        if (!isEmailVerificationRequired()) {
          return { ...registration, requiresEmailVerification: false };
        }
        const user = await prisma.user.findUnique({ where: { id: registration.userId } });
        if (user && !user.emailVerifiedAt) {
          await sendEmailVerificationToken({
            userId: user.id,
            email: user.email,
            organizationId: user.organizationId,
            preferredLocale: user.preferredLocale,
            requestId: ctx.requestId,
          });
          return { ...registration, requiresEmailVerification: true };
        }
        return { ...registration, requiresEmailVerification: false };
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  requestPasswordReset: publicProcedure
    .use(rateLimit({ windowMs: 60_000, max: 5, prefix: "password-reset" }))
    .input(z.object({ email: emailSchema }))
    .mutation(async ({ ctx, input }) => {
      try {
        const user = await prisma.user.findUnique({ where: { email: input.email } });
        if (!user) {
          return { sent: true };
        }

        const { raw } = await createAuthToken({
          userId: user.id,
          email: user.email,
          purpose: "PASSWORD_RESET",
          expiresInMinutes: 60,
          organizationId: user.organizationId,
          actorId: user.id,
          requestId: ctx.requestId,
        });

        const resetLink = `${process.env.NEXTAUTH_URL ?? ""}/reset/${raw}`;
        try {
          await sendResetEmail({ email: user.email, resetLink });
        } catch (emailError) {
          ctx.logger.warn({ emailError, email: user.email }, "password reset email delivery failed");
        }
        return { sent: true };
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  resetPassword: publicProcedure
    .use(rateLimit({ windowMs: 60_000, max: 5, prefix: "password-reset" }))
    .input(z.object({ token: z.string().min(10), password: z.string().min(8) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const token = await consumeAuthToken({ purpose: "PASSWORD_RESET", token: input.token });
        const user = await prisma.user.findUnique({ where: { email: token.email } });
        if (!user) {
          throw new AppError("userNotFound", "NOT_FOUND", 404);
        }
        const passwordHash = await bcrypt.hash(input.password, 10);
        const updated = await prisma.user.update({
          where: { id: user.id },
          data: { passwordHash },
        });

        if (updated.organizationId) {
          await writeAuditLog(prisma, {
            organizationId: updated.organizationId,
            actorId: updated.id,
            action: "USER_PASSWORD_RESET",
            entity: "User",
            entityId: updated.id,
            before: toJson(sanitizeUserAudit(user)),
            after: toJson(updated),
            requestId: ctx.requestId,
          });
        }

        return { reset: true };
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  inviteDetails: publicProcedure
    .use(rateLimit({ windowMs: 60_000, max: 10, prefix: "invite-details" }))
    .input(z.object({ token: z.string().min(10) }))
    .query(async ({ input }) => {
      try {
        const invite = await getInviteByToken(input.token);
        return {
          email: invite.email,
          role: invite.role,
          organizationName: invite.organization.name,
          expiresAt: invite.expiresAt,
        };
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  acceptInvite: publicProcedure
    .use(rateLimit({ windowMs: 60_000, max: 5, prefix: "invite-accept" }))
    .input(
      z.object({
        token: z.string().min(10),
        name: z.string().min(2),
        password: z.string().min(8),
        preferredLocale: z.enum(["ru", "kg"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const user = await acceptInvite({
          token: input.token,
          name: input.name,
          password: input.password,
          preferredLocale: input.preferredLocale,
          requestId: ctx.requestId,
        });
        if (!isEmailVerificationRequired()) {
          return { user, verifyLink: null };
        }

        const verifyLink = await sendEmailVerificationToken({
          userId: user.id,
          email: user.email,
          organizationId: user.organizationId,
          preferredLocale: input.preferredLocale,
          requestId: ctx.requestId,
        });
        return { user, verifyLink };
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  resendVerification: publicProcedure
    .use(rateLimit({ windowMs: 60_000, max: 3, prefix: "verify-resend" }))
    .input(z.object({ email: emailSchema }))
    .mutation(async ({ ctx, input }) => {
      try {
        if (!isEmailVerificationRequired()) {
          return { sent: true };
        }
        const user = await prisma.user.findUnique({ where: { email: input.email } });
        if (!user) {
          return { sent: true };
        }
        if (user.emailVerifiedAt) {
          return { sent: true };
        }

        await sendEmailVerificationToken({
          userId: user.id,
          email: user.email,
          organizationId: user.organizationId,
          preferredLocale: user.preferredLocale,
          requestId: ctx.requestId,
        });
        return { sent: true };
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});
