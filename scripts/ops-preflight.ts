import { prisma } from "@/server/db/prisma";
import { assertStartupConfigured } from "@/server/config/startupChecks";
import { getRedisPublisher } from "@/server/redis";

const fail = (message: string) => {
  console.error(`[preflight] FAIL: ${message}`);
  process.exitCode = 1;
};

const ok = (message: string) => {
  console.log(`[preflight] OK: ${message}`);
};

const ensure = (condition: boolean, message: string) => {
  if (!condition) {
    fail(message);
    return false;
  }
  ok(message);
  return true;
};

const main = async () => {
  const nodeEnv = process.env.NODE_ENV ?? "";
  const dbUrl = process.env.DATABASE_URL ?? "";
  const authUrl = process.env.NEXTAUTH_URL ?? "";
  const authSecret = process.env.NEXTAUTH_SECRET ?? "";
  const jobsSecret = process.env.JOBS_SECRET ?? "";
  const redisUrl = process.env.REDIS_URL ?? "";
  const emailProvider = (process.env.EMAIL_PROVIDER ?? "").trim().toLowerCase();
  const emailFrom = process.env.EMAIL_FROM ?? "";
  const resendApiKey = process.env.RESEND_API_KEY ?? "";
  const allowLogEmailInProduction = ["1", "true", "yes"].includes(
    (process.env.ALLOW_LOG_EMAIL_IN_PRODUCTION ?? "").trim().toLowerCase(),
  );
  const signupMode = process.env.SIGNUP_MODE ?? "invite_only";

  ensure(Boolean(nodeEnv), "NODE_ENV is set");
  ensure(Boolean(dbUrl), "DATABASE_URL is set");
  ensure(Boolean(authUrl), "NEXTAUTH_URL is set");
  ensure(Boolean(authSecret), "NEXTAUTH_SECRET is set");
  ensure(Boolean(jobsSecret), "JOBS_SECRET is set");
  ensure(signupMode === "invite_only" || signupMode === "open", "SIGNUP_MODE is valid");

  if (nodeEnv === "production") {
    ensure(Boolean(redisUrl), "REDIS_URL is set for production");
    ensure(emailProvider !== "log" || allowLogEmailInProduction, "EMAIL_PROVIDER is configured for production");
    if (emailProvider === "resend") {
      ensure(Boolean(emailFrom), "EMAIL_FROM is set for resend");
      ensure(Boolean(resendApiKey), "RESEND_API_KEY is set for resend");
    }
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    ok("Database connectivity check passed");
  } catch (error) {
    fail(`Database connectivity check failed: ${(error as Error).message}`);
  }

  try {
    assertStartupConfigured();
    ok("Startup configuration checks passed");
  } catch (error) {
    fail(`Startup configuration checks failed: ${(error as Error).message}`);
  }

  try {
    const redis = getRedisPublisher();
    if (!redis) {
      if (nodeEnv === "production") {
        fail("Redis client unavailable in production");
      } else {
        ok("Redis is optional in non-production and is currently not configured");
      }
    } else {
      await redis.ping();
      ok("Redis ping check passed");
    }
  } catch (error) {
    fail(`Redis check failed: ${(error as Error).message}`);
  }

  await prisma.$disconnect();

  if (process.exitCode && process.exitCode > 0) {
    process.exit(process.exitCode);
  }
  console.log("[preflight] DONE");
};

void main();
