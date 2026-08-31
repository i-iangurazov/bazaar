const TEST_RUNTIME_LANES = ["deterministic", "redis-contract", "provider-contract"] as const;

export type TestRuntimeLane = (typeof TEST_RUNTIME_LANES)[number];

const LOCAL_NETWORK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const PROVIDER_CONTRACTS = [
  "resend",
  "openai",
  "r2",
  "m-market",
  "o-market",
  "bakai-store",
  "mobile-push",
] as const;

type ProviderContract = (typeof PROVIDER_CONTRACTS)[number];
type TestEnvironment = NodeJS.ProcessEnv | Record<string, string | undefined>;

const PROVIDER_ENV_KEYS = [
  "RESEND_API_KEY",
  "RESEND_WEBHOOK_SECRET",
  "OPENAI_API_KEY",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_PUBLIC_BASE_URL",
  "R2_ENDPOINT",
  "MMARKET_SPECS_KEYS_ENDPOINT_DEV",
  "MMARKET_SPECS_KEYS_ENDPOINT_PROD",
  "BAKAI_STORE_IMPORT_ENDPOINT",
  "FCM_SERVICE_ACCOUNT_JSON",
  "FCM_SERVICE_ACCOUNT_JSON_BASE64",
  "APNS_TEAM_ID",
  "APNS_KEY_ID",
  "APNS_PRIVATE_KEY",
  "APNS_BUNDLE_ID",
  "APNS_ENVIRONMENT",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_PROFILE",
  "AWS_WEB_IDENTITY_TOKEN_FILE",
  "AWS_CONTAINER_CREDENTIALS_FULL_URI",
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
] as const;

const PROVIDER_ENV_BY_CONTRACT: Record<ProviderContract, ReadonlySet<string>> = {
  resend: new Set(["RESEND_API_KEY", "RESEND_WEBHOOK_SECRET"]),
  openai: new Set(["OPENAI_API_KEY"]),
  r2: new Set([
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET_NAME",
    "R2_PUBLIC_BASE_URL",
    "R2_ENDPOINT",
  ]),
  "m-market": new Set(["MMARKET_SPECS_KEYS_ENDPOINT_DEV", "MMARKET_SPECS_KEYS_ENDPOINT_PROD"]),
  "o-market": new Set(),
  "bakai-store": new Set(["BAKAI_STORE_IMPORT_ENDPOINT"]),
  "mobile-push": new Set([
    "FCM_SERVICE_ACCOUNT_JSON",
    "FCM_SERVICE_ACCOUNT_JSON_BASE64",
    "APNS_TEAM_ID",
    "APNS_KEY_ID",
    "APNS_PRIVATE_KEY",
    "APNS_BUNDLE_ID",
    "APNS_ENVIRONMENT",
  ]),
};

const splitList = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

const isolationError = (message: string) => new Error(`[test-runtime-isolation] ${message}`);

const parseUrl = (value: string, key: string) => {
  try {
    return new URL(value);
  } catch {
    throw isolationError(`${key} must be a valid URL.`);
  }
};

export const resolveTestRuntimeLane = (env: TestEnvironment = process.env): TestRuntimeLane => {
  const configured = env.BAZAAR_TEST_RUNTIME_LANE?.trim().toLowerCase() || "deterministic";
  if (!TEST_RUNTIME_LANES.includes(configured as TestRuntimeLane)) {
    throw isolationError(
      `BAZAAR_TEST_RUNTIME_LANE must be one of ${TEST_RUNTIME_LANES.join(", ")}.`,
    );
  }
  return configured as TestRuntimeLane;
};

export const isRedisContractTestLane = (env: TestEnvironment = process.env) =>
  resolveTestRuntimeLane(env) === "redis-contract";

const assertTestNodeEnvironment = (env: TestEnvironment) => {
  if (env.NODE_ENV !== "test") {
    throw isolationError('NODE_ENV must be exactly "test".');
  }
};

const clearProviderEnvironment = (
  env: TestEnvironment,
  preservedKeys: ReadonlySet<string> = new Set(),
) => {
  for (const key of PROVIDER_ENV_KEYS) {
    if (!preservedKeys.has(key)) {
      delete env[key];
    }
  }
};

const applyDeterministicDefaults = (env: TestEnvironment) => {
  env.HARDENING_EXTERNAL_PROVIDER_MODE = "disabled";
  env.NEXTAUTH_SECRET = "bazaar-test-only-nextauth-secret";
  env.NEXTAUTH_URL = "http://localhost:3000";
  env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  env.EMAIL_PROVIDER = "log";
  env.EMAIL_FROM = "no-reply@bazaar.test";
  env.EMAIL_UNSUBSCRIBE_SECRET = "bazaar-test-only-unsubscribe-secret";
  env.IMAGE_STORAGE_PROVIDER = "local";
  env.EXPORT_STORAGE_PROVIDER = "local";
  env.O_MARKET_MOCK_API = "1";
  env.MOBILE_PUSH_MODE = "disabled";
  env.NEXT_PUBLIC_AI_FEATURES_ENABLED = "0";
  env.NEXT_PUBLIC_AI_DESCRIPTION_GENERATION_ENABLED = "0";
  delete env.APP_URL;
  delete env.VERCEL_URL;
  delete env.EMAIL_LOGO_URL;
  delete env.MMARKET_TOKEN_ENCRYPTION_KEY;
  delete env.O_MARKET_TOKEN_ENCRYPTION_KEY;
  delete env.BAKAI_STORE_TOKEN_ENCRYPTION_KEY;
  delete env.MARKET_TOKEN_ENCRYPTION_SECRET;
  delete env.MOBILE_PUSH_TOKEN_ENCRYPTION_SECRET;
  delete env.VERCEL_ENV;
};

const assertRedisContractEnvironment = (env: TestEnvironment) => {
  if (env.RUN_REDIS_CONTRACT_TESTS !== "1") {
    throw isolationError('RUN_REDIS_CONTRACT_TESTS must be exactly "1".');
  }
  const runId = env.BAZAAR_TEST_RUN_ID?.trim() ?? "";
  if (!/^[a-z0-9][a-z0-9_-]{7,47}$/.test(runId)) {
    throw isolationError(
      "BAZAAR_TEST_RUN_ID must be a unique 8-48 character lowercase test-run identifier.",
    );
  }
  const expectedPrefix = `bazaar:test:${runId}:`;
  const configuredPrefix = env.REDIS_KEY_PREFIX?.trim() ?? "";
  if (configuredPrefix && configuredPrefix !== expectedPrefix) {
    throw isolationError(`REDIS_KEY_PREFIX must equal ${expectedPrefix}.`);
  }

  const redisUrlValue = env.REDIS_URL?.trim() ?? "";
  if (!redisUrlValue) {
    throw isolationError("REDIS_URL is required for the Redis contract lane.");
  }
  const redisUrl = parseUrl(redisUrlValue, "REDIS_URL");
  if (redisUrl.protocol !== "redis:" && redisUrl.protocol !== "rediss:") {
    throw isolationError("REDIS_URL must use redis:// or rediss://.");
  }
  const hostname = redisUrl.hostname.toLowerCase();
  const allowedRemoteHosts = new Set(splitList(env.HARDENING_TEST_REDIS_HOST_ALLOWLIST));
  if (!LOCAL_NETWORK_HOSTS.has(hostname) && !allowedRemoteHosts.has(hostname)) {
    throw isolationError(
      `Redis host ${hostname} must be local or explicitly allowlisted for hardening tests.`,
    );
  }
  const productionHosts = new Set(splitList(env.PRODUCTION_REDIS_HOSTS));
  const productionUrl = env.PRODUCTION_REDIS_URL?.trim();
  if (productionUrl) {
    productionHosts.add(parseUrl(productionUrl, "PRODUCTION_REDIS_URL").hostname.toLowerCase());
  }
  if (productionHosts.has(hostname)) {
    throw isolationError(`Redis host ${hostname} is identified as Production.`);
  }

  env.BAZAAR_TEST_RUN_ID = runId;
  env.REDIS_KEY_PREFIX = expectedPrefix;
};

const resolveProviderContract = (env: TestEnvironment): ProviderContract => {
  const provider = env.BAZAAR_TEST_PROVIDER_CONTRACT?.trim().toLowerCase() ?? "";
  if (!PROVIDER_CONTRACTS.includes(provider as ProviderContract)) {
    throw isolationError(
      `BAZAAR_TEST_PROVIDER_CONTRACT must be one of ${PROVIDER_CONTRACTS.join(", ")}.`,
    );
  }
  return provider as ProviderContract;
};

const assertProviderContractEnvironment = (env: TestEnvironment) => {
  if (env.RUN_EXTERNAL_PROVIDER_CONTRACT_TESTS !== "1") {
    throw isolationError('RUN_EXTERNAL_PROVIDER_CONTRACT_TESTS must be exactly "1".');
  }
  if (env.BAZAAR_TEST_PROVIDER_SANDBOX_ACK !== "SANDBOX_ONLY") {
    throw isolationError('BAZAAR_TEST_PROVIDER_SANDBOX_ACK must be exactly "SANDBOX_ONLY".');
  }
  const provider = resolveProviderContract(env);
  const hosts = splitList(env.HARDENING_TEST_PROVIDER_HOST_ALLOWLIST);
  if (!hosts.length) {
    throw isolationError("HARDENING_TEST_PROVIDER_HOST_ALLOWLIST must name the sandbox hosts.");
  }
  for (const host of hosts) {
    if (!/^[a-z0-9.-]+$/.test(host)) {
      throw isolationError(`Provider host ${host} is invalid.`);
    }
    if (
      !LOCAL_NETWORK_HOSTS.has(host) &&
      !host.split(".").some((label) => /^(?:dev|test|testing|sandbox|staging)$/.test(label))
    ) {
      throw isolationError(`Provider host ${host} does not identify a sandbox/test target.`);
    }
  }
  clearProviderEnvironment(env, PROVIDER_ENV_BY_CONTRACT[provider]);
  env.HARDENING_EXTERNAL_PROVIDER_MODE = "contract";
  env.BAZAAR_TEST_PROVIDER_CONTRACT = provider;
  if (provider === "resend") {
    env.EMAIL_PROVIDER = "resend";
  }
  if (provider === "r2") {
    const endpoint = env.R2_ENDPOINT?.trim() ?? "";
    if (!endpoint) {
      throw isolationError("R2_ENDPOINT is required for the R2 provider contract.");
    }
    const endpointHost = parseUrl(endpoint, "R2_ENDPOINT").hostname.toLowerCase();
    if (!hosts.includes(endpointHost)) {
      throw isolationError("R2_ENDPOINT must use an explicitly allowlisted sandbox host.");
    }
    env.IMAGE_STORAGE_PROVIDER = "r2";
    env.EXPORT_STORAGE_PROVIDER = "r2";
  }
  if (provider === "o-market") {
    env.O_MARKET_MOCK_API = "0";
  }
  if (provider === "bakai-store") {
    const endpoint = env.BAKAI_STORE_IMPORT_ENDPOINT?.trim() ?? "";
    if (!endpoint) {
      throw isolationError(
        "BAKAI_STORE_IMPORT_ENDPOINT is required for the Bakai Store provider contract.",
      );
    }
    const endpointHost = parseUrl(endpoint, "BAKAI_STORE_IMPORT_ENDPOINT").hostname.toLowerCase();
    if (!hosts.includes(endpointHost)) {
      throw isolationError(
        "BAKAI_STORE_IMPORT_ENDPOINT must use an explicitly allowlisted sandbox host.",
      );
    }
  }
  if (provider === "mobile-push") {
    env.MOBILE_PUSH_MODE = "live";
  }
};

export type TestRuntimePolicy = {
  lane: TestRuntimeLane;
  redisKeyPrefix: string;
  providerContract: ProviderContract | null;
  allowedNetworkHosts: string[];
};

export const configureTestRuntimeEnvironment = (
  env: TestEnvironment = process.env,
): TestRuntimePolicy => {
  assertTestNodeEnvironment(env);
  const lane = resolveTestRuntimeLane(env);
  applyDeterministicDefaults(env);

  if (lane === "redis-contract") {
    clearProviderEnvironment(env);
    assertRedisContractEnvironment(env);
  } else if (lane === "provider-contract") {
    env.REDIS_URL = "";
    env.REDIS_KEY_PREFIX = "";
    assertProviderContractEnvironment(env);
  } else {
    env.REDIS_URL = "";
    env.REDIS_KEY_PREFIX = "";
    clearProviderEnvironment(env);
  }

  return {
    lane,
    redisKeyPrefix: env.REDIS_KEY_PREFIX ?? "",
    providerContract: lane === "provider-contract" ? resolveProviderContract(env) : null,
    allowedNetworkHosts:
      lane === "provider-contract" ? splitList(env.HARDENING_TEST_PROVIDER_HOST_ALLOWLIST) : [],
  };
};

const requestUrl = (input: string | URL | Request) => {
  if (input instanceof URL) return input;
  if (typeof input === "string") return new URL(input, "http://localhost");
  return new URL(input.url, "http://localhost");
};

export const assertTestNetworkRequestAllowed = (
  input: string | URL | Request,
  env: TestEnvironment = process.env,
) => {
  const url = requestUrl(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return;
  }
  const hostname = url.hostname.toLowerCase();
  if (LOCAL_NETWORK_HOSTS.has(hostname)) {
    return;
  }
  if (
    resolveTestRuntimeLane(env) === "provider-contract" &&
    env.RUN_EXTERNAL_PROVIDER_CONTRACT_TESTS === "1" &&
    env.BAZAAR_TEST_PROVIDER_SANDBOX_ACK === "SANDBOX_ONLY" &&
    PROVIDER_CONTRACTS.includes(
      env.BAZAAR_TEST_PROVIDER_CONTRACT?.trim().toLowerCase() as ProviderContract,
    ) &&
    splitList(env.HARDENING_TEST_PROVIDER_HOST_ALLOWLIST).includes(hostname)
  ) {
    return;
  }
  throw isolationError(`External network request blocked for ${hostname}.`);
};

type TestGlobal = typeof globalThis & {
  __bazaarNativeTestFetch?: typeof fetch;
};

export const installTestNetworkGuard = (env: TestEnvironment = process.env) => {
  const testGlobal = globalThis as TestGlobal;
  const nativeFetch = testGlobal.__bazaarNativeTestFetch ?? globalThis.fetch.bind(globalThis);
  testGlobal.__bazaarNativeTestFetch = nativeFetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    assertTestNetworkRequestAllowed(input, env);
    return nativeFetch(input, init);
  }) as typeof fetch;
};
