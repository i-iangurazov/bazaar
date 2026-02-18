import { prisma } from "@/server/db/prisma";
import { assertStartupConfigured } from "@/server/config/startupChecks";
import { getRedisPublisher } from "@/server/redis";
import { assertBuildEnvConfigured, getRuntimeEnv } from "@/server/config/runtime";

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
  const envOnly = process.argv.includes("--env-only");

  try {
    assertBuildEnvConfigured();
    ok("Build/runtime environment schema checks passed");
  } catch (error) {
    fail(`Environment schema checks failed: ${(error as Error).message}`);
    if (envOnly) {
      return;
    }
  }

  const env = getRuntimeEnv();
  const nodeEnv = env.nodeEnv;
  const dbUrl = env.databaseUrl;
  const authUrl = env.nextAuthUrl;
  const authSecret = env.nextAuthSecret;
  const jobsSecret = env.jobsSecret;
  const redisUrl = env.redisUrl;
  const emailProvider = env.emailProvider;
  const emailFrom = env.emailFrom;
  const resendApiKey = env.resendApiKey;
  const allowLogEmailInProduction = env.allowLogEmailInProduction;
  const signupMode = env.signupMode;

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

  if (envOnly) {
    return;
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    ok("Database connectivity check passed");
  } catch (error) {
    fail(`Database connectivity check failed: ${(error as Error).message}`);
  }

  try {
    await assertStartupConfigured();
    ok("Startup configuration checks passed");
  } catch (error) {
    fail(`Startup configuration checks failed: ${(error as Error).message}`);
  }

  let redisClient: ReturnType<typeof getRedisPublisher> = null;
  try {
    redisClient = getRedisPublisher();
    if (!redisClient) {
      if (nodeEnv === "production") {
        fail("Redis client unavailable in production");
      } else {
        ok("Redis is optional in non-production and is currently not configured");
      }
    } else {
      await redisClient.ping();
      ok("Redis ping check passed");
    }
  } catch (error) {
    fail(`Redis check failed: ${(error as Error).message}`);
  } finally {
    if (redisClient) {
      try {
        await redisClient.quit();
      } catch {
        redisClient.disconnect();
      }
    }
  }

  await prisma.$disconnect();

  if (process.exitCode && process.exitCode > 0) {
    process.exit(process.exitCode);
  }
  console.log("[preflight] DONE");
};

void main();
