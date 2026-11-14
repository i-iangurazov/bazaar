import { BlobAccessError, BlobError, BlobStoreNotFoundError } from "@vercel/blob";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), upload: vi.fn() }));
vi.mock("@/server/auth/token", () => ({ getServerAuthToken: mocks.auth }));
vi.mock("@/server/services/productImageStorage", () => ({ uploadProductImageBuffer: mocks.upload }));

import { POST } from "@/app/api/product-images/upload/route";

const privateMarker = "private-token-user-file-details-must-never-be-logged";
const request = (withOidcHeader = false) => {
  const body = new FormData();
  body.set("productId", `product-${privateMarker}`);
  body.set("file", new File([new Uint8Array([1, 2, 3])], `${privateMarker}.png`, { type: "image/png" }));
  return new Request("https://isolated-preview.invalid/api/product-images/upload", {
    method: "POST", body,
    headers: withOidcHeader ? { "x-vercel-oidc-token": privateMarker } : undefined,
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VERCEL_OIDC_TOKEN", "");
  mocks.auth.mockResolvedValue({ organizationId: `org-${privateMarker}`, role: "ADMIN" });
  mocks.upload.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("redacted product upload diagnostics", () => {
  it("records a known authentication failure and presence bits while keeping the response generic", async () => {
    mocks.upload.mockRejectedValue(new Error("blobStorageAuthenticationUnavailable"));
    const response = await POST(request(true));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ message: "genericMessage" });
    expect(console.error).toHaveBeenCalledExactlyOnceWith("productImageUploadFailed", {
      code: "blobStorageAuthenticationUnavailable", envOidcPresent: false, requestOidcHeaderPresent: true,
    });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(privateMarker);
  });

  it.each([
    [() => new BlobAccessError(), "blobProviderAccessDenied"],
    [() => new BlobStoreNotFoundError(), "blobProviderStoreNotFound"],
    [() => new BlobError(privateMarker), "blobProviderFailure"],
    [() => Object.assign(new Error(privateMarker), { name: "BlobAccessError" }), "unknownStorageFailure"],
    [() => ({ message: privateMarker, constructor: { name: privateMarker }, token: privateMarker }), "unknownStorageFailure"],
  ] as const)("logs only a fixed category for provider or unknown exceptions: %s", async (createError, expectedCode) => {
    vi.stubEnv("VERCEL_OIDC_TOKEN", privateMarker);
    const error = createError();
    if (error instanceof Error) {
      error.message = privateMarker;
      error.stack = privateMarker;
      error.cause = { authorization: privateMarker };
    }
    mocks.upload.mockRejectedValue(error);
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ message: "genericMessage" });
    expect(console.error).toHaveBeenCalledExactlyOnceWith("productImageUploadFailed", {
      code: expectedCode, envOidcPresent: true, requestOidcHeaderPresent: false,
    });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(privateMarker);
  });

  it("maps an exact Preview identity rejection to a fixed diagnostic without logging environment details", async () => {
    mocks.upload.mockRejectedValue(new Error("Blob storage does not match the approved hardening Preview project."));
    expect((await POST(request())).status).toBe(500);
    expect(console.error).toHaveBeenCalledExactlyOnceWith("productImageUploadFailed", {
      code: "blobPreviewProjectMismatch", envOidcPresent: false, requestOidcHeaderPresent: false,
    });
  });

  it("does not log credentials or ordinary validation/authorization failures", async () => {
    mocks.auth.mockResolvedValueOnce(null);
    expect((await POST(request(true))).status).toBe(401);
    expect(mocks.upload).not.toHaveBeenCalled();
    mocks.upload.mockRejectedValue(new Error("imageInvalidType"));
    expect((await POST(request(true))).status).toBe(400);
    expect(console.error).not.toHaveBeenCalled();
  });
});
