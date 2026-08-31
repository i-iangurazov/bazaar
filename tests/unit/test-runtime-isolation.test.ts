import { describe, expect, it } from "vitest";

import {
  assertTestNetworkRequestAllowed,
  configureTestRuntimeEnvironment,
} from "../helpers/testRuntimeIsolation";

const testEnvironment = (
  overrides: Record<string, string> = {},
): Record<string, string | undefined> => ({ NODE_ENV: "test", ...overrides });

describe("test runtime isolation", () => {
  it("applies deterministic defaults to the ordinary Vitest process", async () => {
    expect(process.env).toMatchObject({
      BAZAAR_TEST_RUNTIME_LANE: "deterministic",
      REDIS_URL: "",
      REDIS_KEY_PREFIX: "",
      EMAIL_PROVIDER: "log",
      IMAGE_STORAGE_PROVIDER: "local",
      EXPORT_STORAGE_PROVIDER: "local",
      O_MARKET_MOCK_API: "1",
      MOBILE_PUSH_MODE: "disabled",
    });
    expect(process.env.RESEND_API_KEY).toBeUndefined();
    expect(process.env.OPENAI_API_KEY).toBeUndefined();
    await expect(fetch("https://external.invalid/should-never-connect")).rejects.toThrow(
      "External network request blocked for external.invalid",
    );
  });

  it("neutralizes ambient Redis and external-provider configuration in the default lane", () => {
    const env = testEnvironment({
      REDIS_URL: "redis://production.example.com:6379",
      REDIS_KEY_PREFIX: "production:",
      EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: "ambient-resend-key",
      OPENAI_API_KEY: "ambient-openai-key",
      IMAGE_STORAGE_PROVIDER: "r2",
      EXPORT_STORAGE_PROVIDER: "r2",
      R2_SECRET_ACCESS_KEY: "ambient-r2-secret",
      MMARKET_SPECS_KEYS_ENDPOINT_PROD: "https://market.example.com/specs",
      BAKAI_STORE_IMPORT_ENDPOINT: "https://bakai.example.com/import",
      FCM_SERVICE_ACCOUNT_JSON: "ambient-fcm-credentials",
      MOBILE_PUSH_MODE: "live",
      VERCEL_ENV: "production",
    });

    expect(configureTestRuntimeEnvironment(env)).toEqual({
      lane: "deterministic",
      redisKeyPrefix: "",
      providerContract: null,
      allowedNetworkHosts: [],
    });
    expect(env).toMatchObject({
      REDIS_URL: "",
      REDIS_KEY_PREFIX: "",
      EMAIL_PROVIDER: "log",
      IMAGE_STORAGE_PROVIDER: "local",
      EXPORT_STORAGE_PROVIDER: "local",
      O_MARKET_MOCK_API: "1",
      MOBILE_PUSH_MODE: "disabled",
      HARDENING_EXTERNAL_PROVIDER_MODE: "disabled",
    });
    for (const key of [
      "RESEND_API_KEY",
      "OPENAI_API_KEY",
      "R2_SECRET_ACCESS_KEY",
      "MMARKET_SPECS_KEYS_ENDPOINT_PROD",
      "BAKAI_STORE_IMPORT_ENDPOINT",
      "FCM_SERVICE_ACCOUNT_JSON",
      "VERCEL_ENV",
    ]) {
      expect(env[key]).toBeUndefined();
    }
  });

  it("requires an explicit local Redis target and exact run-scoped prefix", () => {
    const env = testEnvironment({
      BAZAAR_TEST_RUNTIME_LANE: "redis-contract",
      RUN_REDIS_CONTRACT_TESTS: "1",
      BAZAAR_TEST_RUN_ID: "agent4_20260831",
      REDIS_URL: "redis://127.0.0.1:6379/13",
      RESEND_API_KEY: "must-be-cleared",
    });

    expect(configureTestRuntimeEnvironment(env)).toMatchObject({
      lane: "redis-contract",
      redisKeyPrefix: "bazaar:test:agent4_20260831:",
    });
    expect(env.REDIS_KEY_PREFIX).toBe("bazaar:test:agent4_20260831:");
    expect(env.RESEND_API_KEY).toBeUndefined();
  });

  it("rejects a mismatched or production Redis namespace", () => {
    expect(() =>
      configureTestRuntimeEnvironment(
        testEnvironment({
          BAZAAR_TEST_RUNTIME_LANE: "redis-contract",
          RUN_REDIS_CONTRACT_TESTS: "1",
          BAZAAR_TEST_RUN_ID: "agent4_20260831",
          REDIS_URL: "redis://127.0.0.1:6379/13",
          REDIS_KEY_PREFIX: "shared:",
        }),
      ),
    ).toThrow("REDIS_KEY_PREFIX must equal bazaar:test:agent4_20260831:");

    expect(() =>
      configureTestRuntimeEnvironment(
        testEnvironment({
          BAZAAR_TEST_RUNTIME_LANE: "redis-contract",
          RUN_REDIS_CONTRACT_TESTS: "1",
          BAZAAR_TEST_RUN_ID: "agent4_20260831",
          REDIS_URL: "redis://redis.production.example.com:6379",
          REDIS_KEY_PREFIX: "bazaar:test:agent4_20260831:",
          HARDENING_TEST_REDIS_HOST_ALLOWLIST: "redis.production.example.com",
          PRODUCTION_REDIS_HOSTS: "redis.production.example.com",
        }),
      ),
    ).toThrow("identified as Production");
  });

  it("preserves only an explicitly selected sandbox provider contract", () => {
    const env = testEnvironment({
      BAZAAR_TEST_RUNTIME_LANE: "provider-contract",
      RUN_EXTERNAL_PROVIDER_CONTRACT_TESTS: "1",
      BAZAAR_TEST_PROVIDER_SANDBOX_ACK: "SANDBOX_ONLY",
      BAZAAR_TEST_PROVIDER_CONTRACT: "r2",
      HARDENING_TEST_PROVIDER_HOST_ALLOWLIST: "storage.sandbox.example.com",
      R2_ACCOUNT_ID: "sandbox-account",
      R2_ACCESS_KEY_ID: "sandbox-key",
      R2_SECRET_ACCESS_KEY: "sandbox-secret",
      R2_BUCKET_NAME: "sandbox-bucket",
      R2_PUBLIC_BASE_URL: "https://storage.sandbox.example.com/public",
      R2_ENDPOINT: "https://storage.sandbox.example.com",
      RESEND_API_KEY: "must-be-cleared",
      REDIS_URL: "redis://127.0.0.1:6379",
    });

    expect(configureTestRuntimeEnvironment(env)).toEqual({
      lane: "provider-contract",
      redisKeyPrefix: "",
      providerContract: "r2",
      allowedNetworkHosts: ["storage.sandbox.example.com"],
    });
    expect(env).toMatchObject({
      REDIS_URL: "",
      REDIS_KEY_PREFIX: "",
      IMAGE_STORAGE_PROVIDER: "r2",
      EXPORT_STORAGE_PROVIDER: "r2",
      R2_SECRET_ACCESS_KEY: "sandbox-secret",
    });
    expect(env.RESEND_API_KEY).toBeUndefined();
  });

  it("rejects provider targets that are not explicitly sandbox-labelled", () => {
    expect(() =>
      configureTestRuntimeEnvironment(
        testEnvironment({
          BAZAAR_TEST_RUNTIME_LANE: "provider-contract",
          RUN_EXTERNAL_PROVIDER_CONTRACT_TESTS: "1",
          BAZAAR_TEST_PROVIDER_SANDBOX_ACK: "SANDBOX_ONLY",
          BAZAAR_TEST_PROVIDER_CONTRACT: "openai",
          HARDENING_TEST_PROVIDER_HOST_ALLOWLIST: "api.openai.com",
        }),
      ),
    ).toThrow("does not identify a sandbox/test target");
  });

  it("blocks external fetch targets but allows loopback and an opted-in sandbox host", () => {
    const deterministic = testEnvironment();
    expect(() => assertTestNetworkRequestAllowed("/health", deterministic)).not.toThrow();
    expect(() =>
      assertTestNetworkRequestAllowed("http://127.0.0.1:3000/health", deterministic),
    ).not.toThrow();
    expect(() =>
      assertTestNetworkRequestAllowed("https://api.openai.com/v1/responses", deterministic),
    ).toThrow("External network request blocked for api.openai.com");

    const provider = testEnvironment({
      BAZAAR_TEST_RUNTIME_LANE: "provider-contract",
      RUN_EXTERNAL_PROVIDER_CONTRACT_TESTS: "1",
      BAZAAR_TEST_PROVIDER_SANDBOX_ACK: "SANDBOX_ONLY",
      BAZAAR_TEST_PROVIDER_CONTRACT: "r2",
      HARDENING_TEST_PROVIDER_HOST_ALLOWLIST: "api.sandbox.example.com",
    });
    expect(() =>
      assertTestNetworkRequestAllowed("https://api.sandbox.example.com/contract", provider),
    ).not.toThrow();
    expect(() =>
      assertTestNetworkRequestAllowed("https://unlisted.sandbox.example.com/contract", provider),
    ).toThrow("External network request blocked");
  });
});
