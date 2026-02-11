import { initTRPC, TRPCError } from "@trpc/server";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { getToken } from "next-auth/jwt";
import type { NextApiRequest } from "next";
import superjson from "superjson";

import { prisma } from "@/server/db/prisma";
import { assertStartupConfigured } from "@/server/config/startupChecks";
import { isProductionRuntime } from "@/server/config/runtime";
import { getLogger } from "@/server/logging";
import { ensureRequestId } from "@/server/middleware/requestContext";
import { createRateLimiter, type RateLimitConfig } from "@/server/middleware/rateLimiter";
import { Role } from "@prisma/client";
import { assertTrialActive } from "@/server/services/planLimits";
import { toTRPCError } from "@/server/trpc/errors";

export type AuthUser = {
  id: string;
  email: string;
  role: Role;
  organizationId: string;
  isPlatformOwner: boolean;
  isOrgOwner: boolean;
};

export type ImpersonationContext = {
  impersonator: AuthUser;
  impersonationSessionId: string;
};

const parseCookies = (cookieHeader?: string | null) => {
  if (!cookieHeader) {
    return new Map<string, string>();
  }
  return new Map(
    cookieHeader.split(";").map((pair) => {
      const [rawKey, ...rest] = pair.trim().split("=");
      const key = decodeURIComponent(rawKey);
      const value = decodeURIComponent(rest.join("="));
      return [key, value];
    }),
  );
};

export const createContext = async ({ req }: FetchCreateContextFnOptions) => {
  assertStartupConfigured();
  const requestId = ensureRequestId(req.headers.get("x-request-id"));
  const cookieHeader = req.headers.get("cookie") ?? "";
  const forwardedFor = req.headers.get("x-forwarded-for");
  const realIp = req.headers.get("x-real-ip");
  const ip = forwardedFor?.split(",")[0]?.trim() ?? realIp ?? null;
  const cookies = parseCookies(cookieHeader);
  const token = await getToken({
    req: { headers: { cookie: cookieHeader }, cookies } as unknown as NextApiRequest,
    secret: process.env.NEXTAUTH_SECRET,
  });
  const user = token
      ? {
          id: token.sub ?? "",
          email: token.email ?? "",
          role: token.role as Role,
          organizationId: token.organizationId as string,
          isPlatformOwner: Boolean(token.isPlatformOwner),
          isOrgOwner: Boolean(token.isOrgOwner),
        }
    : null;

  let impersonation: ImpersonationContext | null = null;
  let resolvedUser = user;

  const impersonationId = cookies.get("impersonation_session");
  if (user && user.role === Role.ADMIN && impersonationId) {
    const session = await prisma.impersonationSession.findUnique({
      where: { id: impersonationId },
      include: {
        targetUser: {
          select: { id: true, email: true, role: true, organizationId: true, isOrgOwner: true },
        },
      },
    });

    if (
      session &&
      !session.revokedAt &&
      session.expiresAt > new Date() &&
      session.createdById === user.id &&
      session.targetUser.organizationId === user.organizationId
    ) {
      impersonation = { impersonator: user, impersonationSessionId: session.id };
      resolvedUser = {
        id: session.targetUser.id,
        email: session.targetUser.email ?? "",
        role: session.targetUser.role,
        organizationId: session.targetUser.organizationId,
        isPlatformOwner: false,
        isOrgOwner: session.targetUser.isOrgOwner,
      };
    }
  }

  return {
    prisma,
    user: resolvedUser,
    impersonator: impersonation?.impersonator ?? null,
    impersonationSessionId: impersonation?.impersonationSessionId ?? null,
    ip,
    requestId,
    logger: getLogger(requestId),
  };
};

export type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error, ctx }) {
    const requestId = ctx?.requestId;
    return {
      ...shape,
      message: error.message,
      data: {
        ...shape.data,
        requestId,
      },
    };
  },
});

const withTiming = t.middleware(async ({ path, type, ctx, next }) => {
  const startedAt = Date.now();
  const result = await next();
  const durationMs = Date.now() - startedAt;
  if (durationMs >= 750) {
    ctx.logger.warn({ path, type, durationMs }, "slow trpc procedure");
  }
  return result;
});

export const rateLimit = (config: RateLimitConfig) => {
  const limiter = createRateLimiter(config);
  return t.middleware(async ({ ctx, next, path }) => {
    const isTest = process.env.NODE_ENV === "test" || process.env.CI === "1" || process.env.CI === "true";
    if (isTest) {
      return next();
    }
    const key = `${ctx.user?.id ?? ctx.ip ?? "anon"}:${path}`;
    try {
      await limiter.consume(key);
    } catch (error) {
      if (error instanceof Error && error.message === "rateLimited") {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "rateLimited" });
      }
      ctx.logger.warn({ path, error }, "rate limiter unavailable");
      if (isProductionRuntime()) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "genericMessage" });
      }
      return next();
    }
    return next();
  });
};

const isAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "unauthorized" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

const ensureActivePlan = t.middleware(async ({ ctx, next, type, path }) => {
  if (!ctx.user || type !== "mutation") {
    return next();
  }
  if (path.startsWith("billing.")) {
    return next();
  }
  try {
    await assertTrialActive(ctx.user.organizationId);
  } catch (error) {
    throw toTRPCError(error);
  }
  return next();
});

const hasRole = (roles: Role[]) =>
  t.middleware(({ ctx, next }) => {
    if (!ctx.user || !roles.includes(ctx.user.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "forbidden" });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  });

const baseProcedure = t.procedure.use(withTiming);

export const router = t.router;
export const publicProcedure = baseProcedure;
export const protectedProcedure = baseProcedure.use(isAuthed).use(ensureActivePlan);
export const managerProcedure = baseProcedure.use(hasRole([Role.ADMIN, Role.MANAGER])).use(ensureActivePlan);
export const adminProcedure = baseProcedure.use(hasRole([Role.ADMIN])).use(ensureActivePlan);

const isPlatformOwner = t.middleware(({ ctx, next }) => {
  if (!ctx.user || !ctx.user.isPlatformOwner) {
    throw new TRPCError({ code: "FORBIDDEN", message: "forbidden" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

const isOrgOwner = t.middleware(({ ctx, next }) => {
  if (!ctx.user || !ctx.user.isOrgOwner) {
    throw new TRPCError({ code: "FORBIDDEN", message: "forbidden" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

const isAdminOrOrgOwner = t.middleware(({ ctx, next }) => {
  if (!ctx.user || (ctx.user.role !== Role.ADMIN && !ctx.user.isOrgOwner)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "forbidden" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export const platformOwnerProcedure = baseProcedure.use(isAuthed).use(isPlatformOwner);
export const orgOwnerProcedure = baseProcedure.use(isAuthed).use(isOrgOwner).use(ensureActivePlan);
export const adminOrOrgOwnerProcedure = baseProcedure
  .use(isAuthed)
  .use(isAdminOrOrgOwner)
  .use(ensureActivePlan);
