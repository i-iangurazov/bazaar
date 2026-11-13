import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hardeningPreviewEnv } from "../helpers/hardeningPreviewEnv";

const fixture = hardeningPreviewEnv("postgresql://synthetic_owner@isolated.example.invalid/signup_test?sslmode=require");
const configure = (patch: Record<string, string> = {}) => {
  for (const [key, value] of Object.entries({ ...fixture, ...patch })) vi.stubEnv(key, value);
};
describe("email verification inside an explicitly isolated Preview", () => {
  beforeEach(() => { vi.resetModules(); configure(); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("honors the explicit skip after the actual runtime validator accepts all isolation pins", async () => {
    const runtime = await import("@/server/config/runtime"), auth = await import("@/server/config/auth");
    expect(() => runtime.assertRuntimeEnvConfigured()).not.toThrow();
    expect(runtime.isProductionRuntime()).toBe(true);
    expect(auth.isEmailVerificationSkipped()).toBe(true);
    expect(auth.isEmailVerificationRequired()).toBe(false);
  });
  it.each([
    ["production deployment", { VERCEL_ENV: "production" }],
    ["missing isolation guard", { HARDENING_PREVIEW_GUARD: "0" }],
    ["storage without project/blob verification", { IMAGE_STORAGE_PROVIDER: "local", EXPORT_STORAGE_PROVIDER: "local" }],
    ["foreign project", { VERCEL_PROJECT_ID: "prj_DifferentPreview" }],
    ["foreign database host", { HARDENING_PREVIEW_EXPECTED_DATABASE_HOST: "foreign.example.invalid" }],
    ["foreign database name", { HARDENING_PREVIEW_EXPECTED_DATABASE_NAME: "different" }],
    ["foreign Blob store", { BLOB_EXPORT_STORE_ID: "store_DifferentExports" }],
    ["external calls enabled", { HARDENING_EXTERNAL_PROVIDER_MODE: "live" }],
    ["external credentials present", { OPENAI_API_KEY: "synthetic-forbidden-key" }],
    ["destructive test flags", { ALLOW_TEST_DB_RESET: "1" }],
    ["skip not requested", { SKIP_EMAIL_VERIFICATION: "0" }],
  ] as const)("keeps verification required for %s", async (_label, patch) => {
    configure(patch);
    const auth = await import("@/server/config/auth");
    expect(auth.isEmailVerificationSkipped()).toBe(false);
    expect(auth.isEmailVerificationRequired()).toBe(true);
  });
  it("preserves the existing explicit nonproduction skip", async () => {
    configure({ NODE_ENV: "test", VERCEL_ENV: "development", HARDENING_PREVIEW_GUARD: "0" });
    const auth = await import("@/server/config/auth");
    expect(auth.isEmailVerificationSkipped()).toBe(true);
  });
});
