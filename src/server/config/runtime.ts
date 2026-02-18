import { z } from "zod";

const rawEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    NEXT_PHASE: z.string().optional(),
    npm_lifecycle_event: z.string().optional(),
    DATABASE_URL: z.string().optional(),
    REDIS_URL: z.string().optional(),
    NEXTAUTH_SECRET: z.string().optional(),
    NEXTAUTH_URL: z.string().optional(),
    JOBS_SECRET: z.string().optional(),
    EMAIL_PROVIDER: z.string().optional(),
    EMAIL_FROM: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
    ALLOW_LOG_EMAIL_IN_PRODUCTION: z.string().optional(),
    SIGNUP_MODE: z.enum(["invite_only", "open"]).optional(),
    SKIP_EMAIL_VERIFICATION: z.string().optional(),
    AUTH_TRUSTED_PROXY_HOPS: z.string().optional(),
  })
  .passthrough();

const parseBool = (value?: string) => {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

const parseTrustedProxyHops = (value: string | undefined, nodeEnv: "development" | "test" | "production") => {
  if (value === undefined || value === "") {
    return nodeEnv === "production" ? 1 : 0;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    throw new Error("AUTH_TRUSTED_PROXY_HOPS must be a non-negative integer.");
  }
  return parsed;
};

const normalizeEmailProvider = (value?: string) => (value ?? "").trim().toLowerCase();

export type RuntimeEnv = {
  nodeEnv: "development" | "test" | "production";
  isBuildPhase: boolean;
  databaseUrl: string;
  redisUrl: string;
  nextAuthSecret: string;
  nextAuthUrl: string;
  jobsSecret: string;
  emailProvider: string;
  emailFrom: string;
  resendApiKey: string;
  allowLogEmailInProduction: boolean;
  signupMode: "invite_only" | "open";
  skipEmailVerification: boolean;
  authTrustedProxyHops: number;
};

let cachedEnv: RuntimeEnv | null = null;

const parseRuntimeEnv = (source: NodeJS.ProcessEnv): RuntimeEnv => {
  const parsed = rawEnvSchema.parse(source);
  const nodeEnv = parsed.NODE_ENV;
  const isBuildPhase =
    parsed.NEXT_PHASE === "phase-production-build" || parsed.npm_lifecycle_event === "build";
  return {
    nodeEnv,
    isBuildPhase,
    databaseUrl: parsed.DATABASE_URL?.trim() ?? "",
    redisUrl: parsed.REDIS_URL?.trim() ?? "",
    nextAuthSecret: parsed.NEXTAUTH_SECRET?.trim() ?? "",
    nextAuthUrl: parsed.NEXTAUTH_URL?.trim() ?? "",
    jobsSecret: parsed.JOBS_SECRET?.trim() ?? "",
    emailProvider: normalizeEmailProvider(parsed.EMAIL_PROVIDER),
    emailFrom: parsed.EMAIL_FROM?.trim() ?? "",
    resendApiKey: parsed.RESEND_API_KEY?.trim() ?? "",
    allowLogEmailInProduction: parseBool(parsed.ALLOW_LOG_EMAIL_IN_PRODUCTION),
    signupMode: parsed.SIGNUP_MODE ?? "invite_only",
    skipEmailVerification: parseBool(parsed.SKIP_EMAIL_VERIFICATION),
    authTrustedProxyHops: parseTrustedProxyHops(parsed.AUTH_TRUSTED_PROXY_HOPS, nodeEnv),
  };
};

export const getRuntimeEnv = () => {
  if (cachedEnv) {
    return cachedEnv;
  }
  cachedEnv = parseRuntimeEnv(process.env);
  return cachedEnv;
};

const assertPresent = (value: string, message: string) => {
  if (!value) {
    throw new Error(message);
  }
};

const assertValidUrl = (value: string, key: string) => {
  try {
    void new URL(value);
  } catch {
    throw new Error(`${key} is invalid.`);
  }
};

const assertDatabaseUrlSafeForProduction = (databaseUrl: string) => {
  assertValidUrl(databaseUrl, "DATABASE_URL");
  const host = new URL(databaseUrl).hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") {
    throw new Error("DATABASE_URL cannot point to localhost in production.");
  }
};

const assertProductionEnv = (env: RuntimeEnv, target: "build" | "runtime") => {
  if (env.nodeEnv !== "production") {
    return;
  }
  if (target === "runtime" && env.isBuildPhase) {
    return;
  }

  assertPresent(env.databaseUrl, "DATABASE_URL is required in production.");
  assertDatabaseUrlSafeForProduction(env.databaseUrl);
  assertPresent(env.nextAuthSecret, "NEXTAUTH_SECRET is required in production.");
  assertPresent(env.nextAuthUrl, "NEXTAUTH_URL is required in production.");
  assertValidUrl(env.nextAuthUrl, "NEXTAUTH_URL");
  assertPresent(env.jobsSecret, "JOBS_SECRET is required in production.");
  assertPresent(env.redisUrl, "REDIS_URL is required in production.");

  if (env.emailProvider === "resend") {
    assertPresent(env.emailFrom, "EMAIL_FROM is required when EMAIL_PROVIDER=resend.");
    assertPresent(env.resendApiKey, "RESEND_API_KEY is required when EMAIL_PROVIDER=resend.");
  }
  if (env.emailProvider === "log" && !env.allowLogEmailInProduction) {
    throw new Error("EMAIL_PROVIDER=log is not allowed in production without ALLOW_LOG_EMAIL_IN_PRODUCTION.");
  }
};

export const assertRuntimeEnvConfigured = () => {
  const env = getRuntimeEnv();
  assertProductionEnv(env, "runtime");
  return env;
};

export const assertBuildEnvConfigured = () => {
  const env = getRuntimeEnv();
  assertProductionEnv(env, "build");
  return env;
};

export const isBuildPhase = () => getRuntimeEnv().isBuildPhase;

export const isProductionRuntime = () => {
  const env = getRuntimeEnv();
  return env.nodeEnv === "production" && !env.isBuildPhase;
};
