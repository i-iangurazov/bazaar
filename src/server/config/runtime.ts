import { z } from "zod";

const rawEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    VERCEL_ENV: z.enum(["development", "preview", "production"]).optional(),
    NEXT_PHASE: z.string().optional(),
    npm_lifecycle_event: z.string().optional(),
    DATABASE_URL: z.string().optional(),
    ALLOW_LOCALHOST_DATABASE_IN_PRODUCTION: z.string().optional(),
    HARDENING_PREVIEW_GUARD: z.string().optional(),
    HARDENING_PREVIEW_EXPECTED_DATABASE_NAME: z.string().optional(),
    HARDENING_PREVIEW_EXPECTED_DATABASE_HOST: z.string().optional(),
    HARDENING_EXTERNAL_PROVIDER_MODE: z.string().optional(),
    RUN_DB_TESTS: z.string().optional(),
    ALLOW_TEST_DB_RESET: z.string().optional(),
    REDIS_URL: z.string().optional(),
    REDIS_KEY_PREFIX: z.string().optional(),
    NEXTAUTH_SECRET: z.string().optional(),
    NEXTAUTH_URL: z.string().optional(),
    JOBS_SECRET: z.string().optional(),
    CRON_SECRET: z.string().optional(),
    EMAIL_PROVIDER: z.string().optional(),
    EMAIL_FROM: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    IMAGE_STORAGE_PROVIDER: z.string().optional(),
    EXPORT_STORAGE_PROVIDER: z.string().optional(),
    R2_ACCOUNT_ID: z.string().optional(),
    R2_ACCESS_KEY_ID: z.string().optional(),
    R2_SECRET_ACCESS_KEY: z.string().optional(),
    R2_BUCKET_NAME: z.string().optional(),
    R2_PUBLIC_BASE_URL: z.string().optional(),
    R2_ENDPOINT: z.string().optional(),
    O_MARKET_MOCK_API: z.string().optional(),
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

const parseTrustedProxyHops = (
  value: string | undefined,
  nodeEnv: "development" | "test" | "production",
) => {
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

const normalizeRedisKeyPrefix = (value?: string) => {
  const configured = (value ?? "").trim();
  if (!configured) {
    return "";
  }
  if (!/^[A-Za-z0-9:_-]{1,64}$/.test(configured)) {
    throw new Error(
      "REDIS_KEY_PREFIX must contain only letters, numbers, colon, underscore, or hyphen (max 64 characters).",
    );
  }
  return configured.endsWith(":") ? configured : `${configured}:`;
};

export type RuntimeEnv = {
  nodeEnv: "development" | "test" | "production";
  vercelEnv: "development" | "preview" | "production" | "";
  isBuildPhase: boolean;
  databaseUrl: string;
  allowLocalhostDatabaseInProduction: boolean;
  hardeningPreviewGuard: boolean;
  hardeningPreviewExpectedDatabaseName: string;
  hardeningPreviewExpectedDatabaseHost: string;
  hardeningExternalProviderMode: string;
  runDbTests: boolean;
  allowTestDbReset: boolean;
  redisUrl: string;
  redisKeyPrefix: string;
  nextAuthSecret: string;
  nextAuthUrl: string;
  jobsSecret: string;
  cronSecret: string;
  emailProvider: string;
  emailFrom: string;
  resendApiKey: string;
  openAiApiKey: string;
  imageStorageProvider: string;
  exportStorageProvider: string;
  r2Configured: boolean;
  oMarketMockApi: boolean;
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
    vercelEnv: parsed.VERCEL_ENV ?? "",
    isBuildPhase,
    databaseUrl: parsed.DATABASE_URL?.trim() ?? "",
    allowLocalhostDatabaseInProduction: parseBool(parsed.ALLOW_LOCALHOST_DATABASE_IN_PRODUCTION),
    hardeningPreviewGuard: parseBool(parsed.HARDENING_PREVIEW_GUARD),
    hardeningPreviewExpectedDatabaseName:
      parsed.HARDENING_PREVIEW_EXPECTED_DATABASE_NAME?.trim() ?? "",
    hardeningPreviewExpectedDatabaseHost:
      parsed.HARDENING_PREVIEW_EXPECTED_DATABASE_HOST?.trim().toLowerCase() ?? "",
    hardeningExternalProviderMode:
      parsed.HARDENING_EXTERNAL_PROVIDER_MODE?.trim().toLowerCase() ?? "",
    runDbTests: parseBool(parsed.RUN_DB_TESTS),
    allowTestDbReset: parseBool(parsed.ALLOW_TEST_DB_RESET),
    redisUrl: parsed.REDIS_URL?.trim() ?? "",
    redisKeyPrefix: normalizeRedisKeyPrefix(parsed.REDIS_KEY_PREFIX),
    nextAuthSecret: parsed.NEXTAUTH_SECRET?.trim() ?? "",
    nextAuthUrl: parsed.NEXTAUTH_URL?.trim() ?? "",
    jobsSecret: parsed.JOBS_SECRET?.trim() ?? "",
    cronSecret: parsed.CRON_SECRET?.trim() ?? "",
    emailProvider: normalizeEmailProvider(parsed.EMAIL_PROVIDER),
    emailFrom: parsed.EMAIL_FROM?.trim() ?? "",
    resendApiKey: parsed.RESEND_API_KEY?.trim() ?? "",
    openAiApiKey: parsed.OPENAI_API_KEY?.trim() ?? "",
    imageStorageProvider: parsed.IMAGE_STORAGE_PROVIDER?.trim().toLowerCase() ?? "",
    exportStorageProvider: parsed.EXPORT_STORAGE_PROVIDER?.trim().toLowerCase() ?? "",
    r2Configured: Boolean(
      parsed.R2_ACCOUNT_ID?.trim() ||
      parsed.R2_ACCESS_KEY_ID?.trim() ||
      parsed.R2_SECRET_ACCESS_KEY?.trim() ||
      parsed.R2_BUCKET_NAME?.trim() ||
      parsed.R2_PUBLIC_BASE_URL?.trim() ||
      parsed.R2_ENDPOINT?.trim(),
    ),
    oMarketMockApi: parseBool(parsed.O_MARKET_MOCK_API),
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

const assertDatabaseUrlSafeForProduction = (
  databaseUrl: string,
  allowLocalhostDatabaseInProduction: boolean,
) => {
  assertValidUrl(databaseUrl, "DATABASE_URL");
  const host = new URL(databaseUrl).hostname.toLowerCase();
  if (
    !allowLocalhostDatabaseInProduction &&
    (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0")
  ) {
    throw new Error("DATABASE_URL cannot point to localhost in production.");
  }
};

const databaseNameFromUrl = (databaseUrl: string) => {
  const pathname = new URL(databaseUrl).pathname.replace(/^\/+/, "");
  return decodeURIComponent(pathname);
};

const assertHardeningPreviewEnv = (env: RuntimeEnv) => {
  if (!env.hardeningPreviewGuard) {
    return;
  }
  if (env.vercelEnv !== "preview") {
    throw new Error("HARDENING_PREVIEW_GUARD requires VERCEL_ENV=preview.");
  }
  assertPresent(
    env.hardeningPreviewExpectedDatabaseName,
    "HARDENING_PREVIEW_EXPECTED_DATABASE_NAME is required.",
  );
  assertPresent(
    env.hardeningPreviewExpectedDatabaseHost,
    "HARDENING_PREVIEW_EXPECTED_DATABASE_HOST is required.",
  );
  const databaseUrl = new URL(env.databaseUrl);
  const databaseName = databaseNameFromUrl(env.databaseUrl);
  if (databaseName !== env.hardeningPreviewExpectedDatabaseName) {
    throw new Error("DATABASE_URL does not match the approved hardening Preview database.");
  }
  if (databaseUrl.hostname.toLowerCase() !== env.hardeningPreviewExpectedDatabaseHost) {
    throw new Error("DATABASE_URL host does not match the approved hardening Preview host.");
  }
  if (env.runDbTests || env.allowTestDbReset) {
    throw new Error("Destructive DB test flags must be disabled in hardening Preview runtime.");
  }
  if (env.hardeningExternalProviderMode !== "disabled") {
    throw new Error("HARDENING_EXTERNAL_PROVIDER_MODE must be disabled in hardening Preview.");
  }
  if (env.emailProvider !== "log" || !env.allowLogEmailInProduction) {
    throw new Error("Hardening Preview email must use the local log provider.");
  }
  if (env.resendApiKey || env.openAiApiKey) {
    throw new Error("External provider credentials are forbidden in hardening Preview.");
  }
  if (env.imageStorageProvider && env.imageStorageProvider !== "local") {
    throw new Error("Hardening Preview storage must use the isolated local provider.");
  }
  if (env.exportStorageProvider && env.exportStorageProvider !== "local") {
    throw new Error("Hardening Preview exports must use the isolated local provider.");
  }
  if (env.r2Configured) {
    throw new Error("R2 credentials and endpoints are forbidden in hardening Preview.");
  }
  if (!env.oMarketMockApi) {
    throw new Error("O_MARKET_MOCK_API=1 is required in hardening Preview.");
  }
};

export const assertExternalProviderCallAllowed = (provider: string) => {
  const env = getRuntimeEnv();
  if (env.hardeningPreviewGuard && env.hardeningExternalProviderMode === "disabled") {
    throw new Error(`externalProviderDisabled:${provider}`);
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
  assertDatabaseUrlSafeForProduction(env.databaseUrl, env.allowLocalhostDatabaseInProduction);
  assertPresent(env.nextAuthSecret, "NEXTAUTH_SECRET is required in production.");
  assertPresent(env.nextAuthUrl, "NEXTAUTH_URL is required in production.");
  assertValidUrl(env.nextAuthUrl, "NEXTAUTH_URL");
  assertPresent(env.jobsSecret, "JOBS_SECRET is required in production.");
  assertPresent(env.cronSecret, "CRON_SECRET is required in production.");
  if (env.cronSecret.length < 16) {
    throw new Error("CRON_SECRET must contain at least 16 characters.");
  }
  assertPresent(env.redisUrl, "REDIS_URL is required in production.");
  if (env.vercelEnv === "preview") {
    assertPresent(env.redisKeyPrefix, "REDIS_KEY_PREFIX is required for Vercel Preview isolation.");
  }
  assertHardeningPreviewEnv(env);

  if (env.emailProvider === "resend") {
    assertPresent(env.emailFrom, "EMAIL_FROM is required when EMAIL_PROVIDER=resend.");
    assertPresent(env.resendApiKey, "RESEND_API_KEY is required when EMAIL_PROVIDER=resend.");
  }
  if (env.emailProvider === "log" && !env.allowLogEmailInProduction) {
    throw new Error(
      "EMAIL_PROVIDER=log is not allowed in production without ALLOW_LOG_EMAIL_IN_PRODUCTION.",
    );
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
