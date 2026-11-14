import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  for (const [name, value] of Object.entries({
    NODE_ENV: "production", VERCEL_ENV: "preview", VERCEL_PROJECT_ID: "prj_syntheticPreview",
    DATABASE_URL: "postgresql://synthetic:synthetic@isolated-db.invalid/synthetic_preview",
    HARDENING_PREVIEW_GUARD: "1", HARDENING_PREVIEW_EXPECTED_DATABASE_NAME: "synthetic_preview",
    HARDENING_PREVIEW_EXPECTED_DATABASE_HOST: "isolated-db.invalid",
    HARDENING_PREVIEW_EXPECTED_PROJECT_ID: "prj_syntheticPreview",
    HARDENING_PREVIEW_EXPECTED_IMAGE_STORE_ID: "store_testImages",
    HARDENING_PREVIEW_EXPECTED_EXPORT_STORE_ID: "store_testExports",
    BLOB_IMAGE_STORE_ID: "store_testImages", BLOB_EXPORT_STORE_ID: "store_testExports",
    IMAGE_STORAGE_PROVIDER: "vercel-blob", EXPORT_STORAGE_PROVIDER: "vercel-blob",
    HARDENING_EXTERNAL_PROVIDER_MODE: "disabled", RUN_DB_TESTS: "0", ALLOW_TEST_DB_RESET: "0",
    EMAIL_PROVIDER: "log", ALLOW_LOG_EMAIL_IN_PRODUCTION: "1",
    R2_ACCOUNT_ID: "", R2_ACCESS_KEY_ID: "", R2_SECRET_ACCESS_KEY: "", R2_BUCKET_NAME: "", R2_PUBLIC_BASE_URL: "", R2_ENDPOINT: "",
    RESEND_API_KEY: "", OPENAI_API_KEY: "", DEEPSEEK_API_KEY: "", O_MARKET_MOCK_API: "1",
    REDIS_URL: "redis://isolated-redis.invalid:6379", REDIS_KEY_PREFIX: "synthetic:preview:",
    NEXTAUTH_SECRET: "synthetic-auth-secret", NEXTAUTH_URL: "https://isolated-preview.invalid",
    JOBS_SECRET: "synthetic-job-secret", CRON_SECRET: "synthetic-cron-secret-at-least16",
  })) vi.stubEnv(name, value);
});
afterEach(() => vi.unstubAllEnvs());

describe("isolated Preview Blob identity", () => {
  it("accepts only the explicit project and two separate stores while external providers remain disabled", async () => {
    const runtime = await import("@/server/config/runtime");
    expect(() => runtime.assertBuildEnvConfigured()).not.toThrow();
    expect(() => runtime.assertVercelBlobStorageAllowed("images", "store_testImages")).not.toThrow();
    expect(() => runtime.assertVercelBlobStorageAllowed("exports", "store_testExports")).not.toThrow();
    for (const provider of ["openai", "deepseek", "r2", "resend", "vercel-blob"]) {
      expect(() => runtime.assertExternalProviderCallAllowed(provider)).toThrow(`externalProviderDisabled:${provider}`);
    }
    expect(() => runtime.assertVercelBlobStorageAllowed("exports", "store_foreign")).toThrow("blobStorageNotConfigured");
  });

  it.each([
    ["VERCEL_PROJECT_ID", "prj_other", "approved hardening Preview project"],
    ["HARDENING_PREVIEW_EXPECTED_PROJECT_ID", "", "approved hardening Preview project"],
    ["BLOB_IMAGE_STORE_ID", "store_other", "two approved hardening Preview stores"],
    ["BLOB_EXPORT_STORE_ID", "store_other", "two approved hardening Preview stores"],
    ["HARDENING_PREVIEW_EXPECTED_IMAGE_STORE_ID", "", "two approved hardening Preview stores"],
    ["EXPORT_STORAGE_PROVIDER", "local", "explicit image and export providers"],
    ["R2_ENDPOINT", "https://real-bucket.invalid", "R2 credentials and endpoints are forbidden"],
    ["OPENAI_API_KEY", "forbidden", "External provider credentials are forbidden"],
    ["DEEPSEEK_API_KEY", "forbidden", "External provider credentials are forbidden"],
  ])("rejects mismatched or forbidden %s before runtime calls", async (name, value, message) => {
    vi.stubEnv(name, value);
    const runtime = await import("@/server/config/runtime");
    expect(() => runtime.assertBuildEnvConfigured()).toThrow(message);
    expect(() => runtime.assertVercelBlobStorageAllowed("exports", "store_testExports")).toThrow(message);
  });

  it("rejects shared public/private store identity even when both expected values were copied", async () => {
    vi.stubEnv("BLOB_EXPORT_STORE_ID", "store_testImages");
    vi.stubEnv("HARDENING_PREVIEW_EXPECTED_EXPORT_STORE_ID", "store_testImages");
    const { assertBuildEnvConfigured } = await import("@/server/config/runtime");
    expect(() => assertBuildEnvConfigured()).toThrow("two approved hardening Preview stores");
  });
});
