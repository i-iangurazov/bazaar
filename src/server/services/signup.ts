import bcrypt from "bcryptjs";
import type { LegalEntityType } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { writeAuditLog } from "@/server/services/audit";
import { toJson } from "@/server/services/json";
import { createAuthToken } from "@/server/services/authTokens";
import { sendVerificationEmail } from "@/server/services/email";
import { consumeAuthToken } from "@/server/services/authTokens";
import { assertWithinLimits } from "@/server/services/planLimits";
import { isEmailVerificationRequired } from "@/server/config/auth";

const DEFAULT_TRIAL_DAYS = Number(process.env.TRIAL_DAYS ?? "14");

const ensureSignupOpen = () => {
  const mode = process.env.SIGNUP_MODE ?? "invite_only";
  if (mode !== "open") {
    throw new AppError("signupInviteOnly", "FORBIDDEN", 403);
  }
};

export const requestAccess = async (input: {
  email: string;
  orgName?: string | null;
}) => {
  const existing = await prisma.accessRequest.findFirst({
    where: { email: input.email },
  });
  if (existing) {
    return existing;
  }
  return prisma.accessRequest.create({
    data: {
      email: input.email,
      orgName: input.orgName ?? null,
    },
  });
};

export const createSignup = async (input: {
  email: string;
  password: string;
  name: string;
  preferredLocale: string;
  requestId: string;
}) => {
  ensureSignupOpen();
  const verificationRequired = isEmailVerificationRequired();

  const createRegistrationNextPath = async (userId: string, email: string, organizationId?: string | null) => {
    const registration = await createAuthToken({
      userId,
      email,
      purpose: "REGISTRATION",
      expiresInMinutes: 60,
      organizationId,
      actorId: userId,
      requestId: input.requestId,
    });
    return `/register-business/${registration.raw}`;
  };

  const existingUser = await prisma.user.findUnique({ where: { email: input.email } });
  if (existingUser) {
    if (verificationRequired && !existingUser.emailVerifiedAt) {
      const verifyLink = await sendEmailVerificationToken({
        userId: existingUser.id,
        email: existingUser.email,
        organizationId: existingUser.organizationId,
        requestId: input.requestId,
      });
      return { sent: true, verifyLink };
    }
    const updatedUser =
      !verificationRequired && !existingUser.emailVerifiedAt
        ? await prisma.user.update({
            where: { id: existingUser.id },
            data: { emailVerifiedAt: new Date() },
          })
        : existingUser;

    if (!updatedUser.organizationId) {
      const nextPath = await createRegistrationNextPath(updatedUser.id, updatedUser.email, updatedUser.organizationId);
      return { sent: true, nextPath };
    }

    const hasStore = await prisma.store.count({ where: { organizationId: updatedUser.organizationId } });
    if (hasStore === 0) {
      const nextPath = await createRegistrationNextPath(updatedUser.id, updatedUser.email, updatedUser.organizationId);
      return { sent: true, nextPath };
    }

    return { sent: true };
  }

  const passwordHash = await bcrypt.hash(input.password, 10);
  const user = await prisma.user.create({
    data: {
      organizationId: null,
      email: input.email,
      name: input.name,
      role: "ADMIN",
      passwordHash,
      preferredLocale: input.preferredLocale,
      emailVerifiedAt: verificationRequired ? null : new Date(),
    },
  });

  if (verificationRequired) {
    const verifyLink = await sendEmailVerificationToken({
      userId: user.id,
      email: user.email,
      organizationId: user.organizationId,
      requestId: input.requestId,
    });
    return { sent: true, verifyLink };
  }

  const nextPath = await createRegistrationNextPath(user.id, user.email, user.organizationId);
  return { sent: true, nextPath };
};

const normalizeCode = (value: string) => value.trim().toUpperCase().replace(/\s+/g, "-");

const normalizeOptional = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export const registerBusinessFromToken = async (input: {
  token: string;
  orgName: string;
  storeName: string;
  storeCode: string;
  legalEntityType?: LegalEntityType | null;
  legalName?: string | null;
  inn?: string | null;
  address?: string | null;
  phone?: string | null;
  requestId: string;
}) => {
  const token = await consumeAuthToken({ purpose: "REGISTRATION", token: input.token });
  if (!token.userId) {
    throw new AppError("tokenInvalid", "NOT_FOUND", 404);
  }
  const userId = token.userId;

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AppError("userNotFound", "NOT_FOUND", 404);
    }
    if (isEmailVerificationRequired() && !user.emailVerifiedAt) {
      throw new AppError("emailNotVerified", "FORBIDDEN", 403);
    }

    const code = normalizeCode(input.storeCode);
    if (!/^[A-Z0-9_-]{2,20}$/.test(code)) {
      throw new AppError("invalidStoreCode", "BAD_REQUEST", 400);
    }

    const inn = normalizeOptional(input.inn);
    if (inn && !/^\d{10,14}$/.test(inn)) {
      throw new AppError("invalidInn", "BAD_REQUEST", 400);
    }

    let organizationId = user.organizationId;
    let beforeOrg = null;
    const hasExistingOrganization = Boolean(organizationId);

    if (hasExistingOrganization && organizationId) {
      const storesCount = await tx.store.count({ where: { organizationId } });
      if (storesCount > 0) {
        throw new AppError("registrationAlreadyCompleted", "CONFLICT", 409);
      }
      beforeOrg = await tx.organization.findUnique({ where: { id: organizationId } });
      if (!beforeOrg) {
        throw new AppError("orgNotFound", "NOT_FOUND", 404);
      }
      await assertWithinLimits({ organizationId, kind: "stores" });
    } else {
      const trialDays = Number.isFinite(DEFAULT_TRIAL_DAYS) && DEFAULT_TRIAL_DAYS > 0 ? DEFAULT_TRIAL_DAYS : 14;
      const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000);
      const createdOrg = await tx.organization.create({
        data: {
          name: input.orgName.trim(),
          plan: "STARTER",
          subscriptionStatus: "ACTIVE",
          trialEndsAt,
          currentPeriodEndsAt: trialEndsAt,
        },
      });
      organizationId = createdOrg.id;
      await tx.user.update({
        where: { id: user.id },
        data: { organizationId },
      });
    }

    const org = await tx.organization.update({
      where: { id: organizationId },
      data: { name: input.orgName.trim() },
    });

    const store = await tx.store.create({
      data: {
        organizationId,
        name: input.storeName.trim(),
        code,
        allowNegativeStock: false,
        trackExpiryLots: false,
        legalEntityType: input.legalEntityType ?? null,
        legalName: normalizeOptional(input.legalName),
        inn,
        address: normalizeOptional(input.address),
        phone: normalizeOptional(input.phone),
      },
    });

    await writeAuditLog(tx, {
      organizationId,
      actorId: user.id,
      action: "ORG_SIGNUP_COMPLETE",
      entity: "Organization",
      entityId: org.id,
      before: toJson(beforeOrg),
      after: toJson(org),
      requestId: input.requestId,
    });

    await writeAuditLog(tx, {
      organizationId,
      actorId: user.id,
      action: "STORE_CREATE",
      entity: "Store",
      entityId: store.id,
      before: null,
      after: toJson(store),
      requestId: input.requestId,
    });

    return { organizationId, storeId: store.id, userId: user.id };
  });
};

export const sendEmailVerificationToken = async (input: {
  userId: string;
  email: string;
  organizationId?: string | null;
  requestId: string;
}) => {
  if (!isEmailVerificationRequired()) {
    return null;
  }
  const { raw } = await createAuthToken({
    userId: input.userId,
    email: input.email,
    purpose: "EMAIL_VERIFY",
    expiresInMinutes: 60 * 24,
    organizationId: input.organizationId,
    actorId: input.userId,
    requestId: input.requestId,
  });

  const verifyLink = `${process.env.NEXTAUTH_URL ?? ""}/verify/${raw}`;
  await sendVerificationEmail({ email: input.email, verifyLink });
  return verifyLink;
};
