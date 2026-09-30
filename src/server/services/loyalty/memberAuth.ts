import { createHash, randomBytes, randomInt } from "node:crypto";

import { prisma } from "@/server/db/prisma";
import { isProductionRuntime } from "@/server/config/runtime";
import { AppError } from "@/server/services/errors";
import { sendTransactionalEmail } from "@/server/services/email";
import { createRateLimiter } from "@/server/middleware/rateLimiter";
import { availablePoints, ensureAccount } from "@/server/services/loyalty/ledger";

export const LOYALTY_SESSION_COOKIE = "loyalty_session";
export const OTP_TTL_MINUTES = 10;
export const SESSION_TTL_DAYS = 30;
export const CARD_TOKEN_TTL_SECONDS = 120;
const OTP_MAX_ATTEMPTS = 5;
const OTP_WINDOW_MS = 10 * 60_000;
const OTP_MAX_PER_WINDOW = 5;

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const randomToken = () => randomBytes(32).toString("hex");

const otpLimiter = createRateLimiter({ windowMs: 60_000, max: 6, prefix: "loyalty-otp" });
const verifyLimiter = createRateLimiter({ windowMs: 60_000, max: 20, prefix: "loyalty-otp-verify" });

const isTestRuntime = () => process.env.NODE_ENV === "test";

export const normalizeEmail = (value: string) => value.trim().toLowerCase();
export const emailContactKey = (value: string) => `email:${normalizeEmail(value)}`;
export const phoneContactKey = (value: string) =>
  `phone:${value.replace(/[^0-9]/g, "")}`;

export type LoyaltyJoinTarget = {
  programStoreId: string;
  organizationId: string;
  programId: string;
  storeId: string;
  storeName: string;
  enabled: boolean;
};

/** Public "get card" target for a store QR. Scanning never earns or spends points. */
export const resolveJoinTarget = async (programStoreId: string): Promise<LoyaltyJoinTarget | null> => {
  const link = await prisma.loyaltyProgramStore.findUnique({
    where: { id: programStoreId },
  });
  if (!link) return null;
  const [program, store] = await Promise.all([
    prisma.loyaltyProgram.findUnique({
      where: { id: link.programId },
      select: { id: true, organizationId: true, enabled: true },
    }),
    prisma.store.findFirst({
      where: { id: link.storeId, organizationId: link.organizationId },
      select: { name: true },
    }),
  ]);
  if (!program || program.organizationId !== link.organizationId || !store) return null;
  return {
    programStoreId: link.id,
    organizationId: link.organizationId,
    programId: link.programId,
    storeId: link.storeId,
    storeName: store.name,
    enabled: program.enabled,
  };
};

/** Emails one OTP. Never logs the code; delivery is skipped in tests. */
export const requestJoinOtp = async (input: { programStoreId: string; email: string }) => {
  const target = await resolveJoinTarget(input.programStoreId);
  if (!target || !target.enabled) throw new AppError("loyaltyDisabled", "FORBIDDEN", 403);
  const email = normalizeEmail(input.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new AppError("invalidInput", "BAD_REQUEST", 400);

  await otpLimiter.consume(`email:${email}`);
  const recent = await prisma.loyaltyOtpChallenge.count({
    where: { organizationId: target.organizationId, email, createdAt: { gte: new Date(Date.now() - OTP_WINDOW_MS) } },
  });
  if (recent >= OTP_MAX_PER_WINDOW) throw new AppError("loyaltyOtpRateLimited", "TOO_MANY_REQUESTS", 429);

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const contactKey = emailContactKey(email);
  await prisma.loyaltyOtpChallenge.create({
    data: {
      organizationId: target.organizationId,
      programId: target.programId,
      contactKey,
      email,
      purpose: "JOIN",
      codeHash: hash(code),
      expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60_000),
    },
  });

  if (!isTestRuntime()) {
    await sendTransactionalEmail({
      to: email,
      subject: "Код подтверждения BAZAAR",
      text: `Ваш код подтверждения: ${code}\nКод действует ${OTP_TTL_MINUTES} минут.`,
      html: `<p>Ваш код подтверждения: <b>${code}</b></p><p>Код действует ${OTP_TTL_MINUTES} минут.</p>`,
      tags: [{ name: "kind", value: "loyalty_otp" }],
    });
  }
  // The code is returned only to automated tests; production never exposes it.
  return { delivered: true, expiresInMinutes: OTP_TTL_MINUTES, ...(isTestRuntime() ? { code } : {}) };
};

/** Verifies an OTP, creates the member/account if new, and returns a session token. */
export const verifyJoinOtp = async (input: { programStoreId: string; email: string; code: string }) => {
  const target = await resolveJoinTarget(input.programStoreId);
  if (!target || !target.enabled) throw new AppError("loyaltyDisabled", "FORBIDDEN", 403);
  const email = normalizeEmail(input.email);
  await verifyLimiter.consume(`email:${email}`);

  const challenge = await prisma.loyaltyOtpChallenge.findFirst({
    where: { organizationId: target.organizationId, email, purpose: "JOIN", consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  const now = new Date();
  if (!challenge || challenge.expiresAt <= now) throw new AppError("loyaltyOtpExpired", "BAD_REQUEST", 400);
  if (challenge.attempts >= OTP_MAX_ATTEMPTS) throw new AppError("loyaltyOtpTooManyAttempts", "TOO_MANY_REQUESTS", 429);
  if (hash(input.code.trim()) !== challenge.codeHash) {
    await prisma.loyaltyOtpChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    });
    throw new AppError("loyaltyOtpInvalid", "BAD_REQUEST", 400);
  }

  const contactKey = emailContactKey(email);
  const result = await prisma.$transaction(async (tx) => {
    const claimed = await tx.loyaltyOtpChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { consumedAt: now },
    });
    if (claimed.count === 0) throw new AppError("loyaltyOtpUsed", "CONFLICT", 409);
    const member = await tx.loyaltyMember.upsert({
      where: { programId_contactKey: { programId: target.programId, contactKey } },
      create: {
        organizationId: target.organizationId,
        programId: target.programId,
        contactKey,
        email,
      },
      update: { email },
    });
    const account = await ensureAccount(tx, {
      organizationId: target.organizationId,
      programId: target.programId,
      memberId: member.id,
    });
    const raw = randomToken();
    await tx.loyaltySession.create({
      data: {
        organizationId: target.organizationId,
        programId: target.programId,
        memberId: member.id,
        tokenHash: hash(raw),
        expiresAt: new Date(now.getTime() + SESSION_TTL_DAYS * 86_400_000),
      },
    });
    return { raw, member, account };
  });
  return { token: result.raw, memberId: result.member.id, expiresAt: result.account.updatedAt };
};

/** Resolves a customer session cookie to its member and programme. */
export const getSessionMember = async (rawToken: string | undefined | null) => {
  if (!rawToken) return null;
  const session = await prisma.loyaltySession.findUnique({ where: { tokenHash: hash(rawToken) } });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
  const [member, program, account] = await Promise.all([
    prisma.loyaltyMember.findUnique({ where: { id: session.memberId } }),
    prisma.loyaltyProgram.findUnique({ where: { id: session.programId } }),
    prisma.loyaltyAccount.findUnique({ where: { memberId: session.memberId } }),
  ]);
  if (!member || member.status !== "ACTIVE" || !program || !account) return null;
  if (member.organizationId !== program.organizationId) return null;
  return { session, member, program, account };
};

export const revokeSession = async (rawToken: string) => {
  await prisma.loyaltySession.updateMany({
    where: { tokenHash: hash(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
};

/** Issues a short-lived opaque customer QR token for the register. */
export const issueCardToken = async (rawSessionToken: string) => {
  const context = await getSessionMember(rawSessionToken);
  if (!context) throw new AppError("loyaltyUnauthorized", "UNAUTHORIZED", 401);
  const raw = randomToken();
  await prisma.loyaltyCardToken.create({
    data: {
      organizationId: context.program.organizationId,
      programId: context.program.id,
      memberId: context.member.id,
      tokenHash: hash(raw),
      expiresAt: new Date(Date.now() + CARD_TOKEN_TTL_SECONDS * 1000),
    },
  });
  return { token: raw, expiresAt: new Date(Date.now() + CARD_TOKEN_TTL_SECONDS * 1000) };
};

/**
 * Register-side verification of a customer QR. Binds the member to one organization,
 * expires quickly and can be consumed once.
 */
export const verifyCardToken = async (rawToken: string, organizationId: string) => {
  const token = await prisma.loyaltyCardToken.findUnique({ where: { tokenHash: hash(rawToken) } });
  if (!token || token.organizationId !== organizationId) {
    throw new AppError("loyaltyCardInvalid", "NOT_FOUND", 404);
  }
  if (token.expiresAt <= new Date()) throw new AppError("loyaltyCardExpired", "CONFLICT", 409);
  if (token.usedAt) throw new AppError("loyaltyCardUsed", "CONFLICT", 409);
  const claimed = await prisma.loyaltyCardToken.updateMany({
    where: { id: token.id, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (claimed.count === 0) throw new AppError("loyaltyCardUsed", "CONFLICT", 409);
  const [member, account, program] = await Promise.all([
    prisma.loyaltyMember.findUniqueOrThrow({ where: { id: token.memberId } }),
    prisma.loyaltyAccount.findUniqueOrThrow({ where: { memberId: token.memberId } }),
    prisma.loyaltyProgram.findUniqueOrThrow({ where: { id: token.programId } }),
  ]);
  const available = await availablePoints(prisma, account.id);
  return { member, account, program, availablePoints: available };
};

export type LoyaltyCardView = {
  member: { id: string; displayName: string | null; email: string | null };
  store: { id: string; name: string } | null;
  rules: {
    memberDiscountPercent: number;
    earnPercent: number;
    maxSpendPercent: number;
    pointValueKgs: number;
  };
  rulesText: string | null;
  balancePoints: number;
  availablePoints: number;
  history: Array<{ id: string; type: string; points: number; balanceAfter: number; createdAt: string }>;
};

export const getCardView = async (rawSessionToken: string): Promise<LoyaltyCardView> => {
  const context = await getSessionMember(rawSessionToken);
  if (!context) throw new AppError("loyaltyUnauthorized", "UNAUTHORIZED", 401);
  const [store, history, available] = await Promise.all([
    prisma.loyaltyProgramStore.findFirst({
      where: { programId: context.program.id },
      orderBy: { createdAt: "asc" },
      select: { storeId: true },
    }),
    prisma.loyaltyLedgerEntry.findMany({
      where: { accountId: context.account.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, type: true, points: true, balanceAfter: true, createdAt: true },
    }),
    availablePoints(prisma, context.account.id),
  ]);
  const storeRow = store
    ? await prisma.store.findUnique({ where: { id: store.storeId }, select: { id: true, name: true } })
    : null;
  return {
    member: {
      id: context.member.id,
      displayName: context.member.displayName,
      email: context.member.email,
    },
    store: storeRow,
    rules: {
      memberDiscountPercent: Number(context.program.memberDiscountPercent),
      earnPercent: Number(context.program.earnPercent),
      maxSpendPercent: Number(context.program.maxSpendPercent),
      pointValueKgs: Number(context.program.pointValueKgs),
    },
    rulesText: context.program.rulesText,
    balancePoints: context.account.balancePoints,
    availablePoints: available,
    history: history.map((entry) => ({
      id: entry.id,
      type: entry.type,
      points: entry.points,
      balanceAfter: entry.balanceAfter,
      createdAt: entry.createdAt.toISOString(),
    })),
  };
};

export const isLoyaltyTestRuntime = isTestRuntime;
export const loyaltySessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: isProductionRuntime(),
  path: "/",
  maxAge: SESSION_TTL_DAYS * 86_400,
};
