import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

import { prisma } from "@/server/db/prisma";
import { createAuthToken, consumeAuthToken } from "@/server/services/authTokens";
import { createSignup, sendEmailVerificationToken } from "@/server/services/signup";
import { sendResetEmail, sendInviteEmail } from "@/server/services/email";

const log = (message: string) => {
  console.log(`[email-flow] ${message}`);
};

const parseTokenFromLink = (url: string) => {
  const parts = url.split("/");
  return parts[parts.length - 1] ?? "";
};

const main = async () => {
  const email = `ops-check-${Date.now()}@example.test`;
  const requestId = `ops-email-${randomUUID()}`;
  const originalSignupMode = process.env.SIGNUP_MODE;

  process.env.SIGNUP_MODE = "open";

  try {
    log(`Creating signup for ${email}`);
    const signup = await createSignup({
      email,
      password: "OpsCheck123!",
      name: "Ops Check",
      preferredLocale: "ru",
      requestId,
    });
    if (!signup.verifyLink && !signup.nextPath) {
      throw new Error("verifyFlowMissing");
    }

    if (signup.verifyLink) {
      const verifyToken = parseTokenFromLink(signup.verifyLink);
      log("Consuming email verification token");
      const consumed = await consumeAuthToken({ purpose: "EMAIL_VERIFY", token: verifyToken });
      if (!consumed.userId) {
        throw new Error("verifyTokenUserMissing");
      }

      await prisma.user.update({
        where: { id: consumed.userId },
        data: { emailVerifiedAt: new Date() },
      });
      log("Email verification flow passed");
    } else {
      log("Email verification is skipped in current configuration");
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new Error("userMissingAfterVerification");
    }

    const reset = await createAuthToken({
      userId: user.id,
      email: user.email,
      purpose: "PASSWORD_RESET",
      expiresInMinutes: 15,
      organizationId: user.organizationId,
      actorId: user.id,
      requestId,
    });
    const resetLink = `${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/reset/${reset.raw}`;
    await sendResetEmail({ email: user.email, resetLink });
    log("Password reset email delivery passed");

    const resendVerifyLink = await sendEmailVerificationToken({
      userId: user.id,
      email: user.email,
      organizationId: user.organizationId,
      requestId,
    });
    if (!resendVerifyLink.includes("/verify/")) {
      throw new Error("resendVerifyLinkInvalid");
    }
    log("Verification resend delivery passed");

    await sendInviteEmail({
      email: `invite-${Date.now()}@example.test`,
      inviteLink: `${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/invite/${randomUUID()}`,
    });
    log("Invite email delivery passed");

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash("OpsCheck123!1", 10) },
    });
    log("User password update step passed");
  } finally {
    if (originalSignupMode === undefined) {
      delete process.env.SIGNUP_MODE;
    } else {
      process.env.SIGNUP_MODE = originalSignupMode;
    }
    await prisma.user.deleteMany({
      where: { email },
    });
    await prisma.authToken.deleteMany({
      where: { email },
    });
    await prisma.$disconnect();
  }

  log("DONE");
};

void main();
