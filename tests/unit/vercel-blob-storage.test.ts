import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn(), head: vi.fn(), del: vi.fn(), mkdir: vi.fn(), writeFile: vi.fn() }));
const oidc = vi.hoisted(() => ({ getToken: vi.fn() }));
vi.mock("@vercel/blob", () => ({ ...sdk, BlobNotFoundError: class extends Error {} }));
vi.mock("@vercel/oidc", () => ({ getVercelOidcToken: oidc.getToken }));
vi.mock("node:fs/promises", () => ({ mkdir: sdk.mkdir, writeFile: sdk.writeFile, rm: vi.fn() }));

const imageBase = "https://testimages.public.blob.vercel-storage.com";
const exportBase = "https://testexports.private.blob.vercel-storage.com";

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubEnv("HARDENING_PREVIEW_GUARD", "0");
  vi.stubEnv("IMAGE_STORAGE_PROVIDER", "vercel-blob");
  vi.stubEnv("EXPORT_STORAGE_PROVIDER", "vercel-blob");
  vi.stubEnv("BLOB_IMAGE_STORE_ID", "store_testImages");
  vi.stubEnv("BLOB_EXPORT_STORE_ID", "store_testExports");
  vi.stubEnv("VERCEL_OIDC_TOKEN", "synthetic-platform-oidc");
  vi.stubEnv("BLOB_STORE_ID", "store_foreignDefault");
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "synthetic-foreign-default-token-must-not-be-used");
  oidc.getToken.mockReset().mockResolvedValue("synthetic-resolved-oidc");
  sdk.put.mockImplementation(async (path: string, _body: unknown, options: { access: string }) => ({
    url: `${options.access === "public" ? imageBase : exportBase}/${path}`,
  }));
  sdk.del.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("explicit separate Vercel Blob stores", () => {
  it("uses public images and private exports with explicit store identities and no generic token", async () => {
    const { putManagedBlob } = await import("@/server/services/vercelBlobStorage");
    await expect(putManagedBlob({ purpose: "images", pathname: "retails/org/products/product/photo.png", body: Buffer.from("image"), contentType: "image/png" }))
      .resolves.toBe(`${imageBase}/retails/org/products/product/photo.png`);
    await expect(putManagedBlob({ purpose: "exports", pathname: "exports/org/job/report.csv", body: Buffer.from("report"), contentType: "text/csv" }))
      .resolves.toBe(`${exportBase}/exports/org/job/report.csv`);
    expect(sdk.put.mock.calls[0]?.[2]).toMatchObject({ storeId: "store_testImages", oidcToken: "synthetic-resolved-oidc", access: "public", addRandomSuffix: false });
    expect(sdk.put.mock.calls[1]?.[2]).toMatchObject({ storeId: "store_testExports", oidcToken: "synthetic-resolved-oidc", access: "private", cacheControlMaxAge: 60 });
    for (const call of sdk.put.mock.calls) {
      expect(call[2]).not.toHaveProperty("token");
      expect(call[2]).toHaveProperty("oidcToken", "synthetic-resolved-oidc");
    }
  });

  it("accepts the official runtime resolver token when the build-only env token is absent", async () => {
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    oidc.getToken.mockResolvedValue("synthetic-request-context-oidc");
    const { putManagedBlob } = await import("@/server/services/vercelBlobStorage");
    await expect(putManagedBlob({ purpose: "images", pathname: "retails/org/products/product/photo.png", body: Buffer.from("image"), contentType: "image/png" }))
      .resolves.toBe(`${imageBase}/retails/org/products/product/photo.png`);
    expect(oidc.getToken).toHaveBeenCalledOnce();
    expect(sdk.put.mock.calls[0]?.[2]).toMatchObject({ storeId: "store_testImages", oidcToken: "synthetic-request-context-oidc" });
    expect(sdk.put.mock.calls[0]?.[2]).not.toHaveProperty("token");
  });

  it.each(["throw", "empty", "whitespace"])("fails closed for %s OIDC resolution despite a generic default token/store", async (failure) => {
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    if (failure === "throw") oidc.getToken.mockRejectedValue(new Error("private SDK details must not escape"));
    else oidc.getToken.mockResolvedValue(failure === "empty" ? "" : "  ");
    const { putManagedBlob, readManagedBlob, statManagedBlob, deleteManagedBlob } = await import("@/server/services/vercelBlobStorage");
    await expect(putManagedBlob({ purpose: "exports", pathname: "exports/org/job/report.csv", body: Buffer.from("report"), contentType: "text/csv" }))
      .rejects.toThrow("blobStorageAuthenticationUnavailable");
    await expect(readManagedBlob("exports", "exports/org/job/report.csv")).rejects.toThrow("blobStorageAuthenticationUnavailable");
    await expect(statManagedBlob("exports", "exports/org/job/report.csv")).rejects.toThrow("blobStorageAuthenticationUnavailable");
    await expect(deleteManagedBlob("exports", "exports/org/job/report.csv")).rejects.toThrow("blobStorageAuthenticationUnavailable");
    for (const command of [sdk.put, sdk.get, sdk.head, sdk.del]) expect(command).not.toHaveBeenCalled();
  });

  it("resolves fresh credentials separately for upload, read, metadata and deletion", async () => {
    vi.stubEnv("VERCEL_OIDC_TOKEN", "stale-build-oidc-must-not-be-used");
    oidc.getToken.mockResolvedValueOnce("current-upload-oidc").mockResolvedValueOnce("current-read-oidc")
      .mockResolvedValueOnce("current-metadata-oidc").mockResolvedValueOnce("current-delete-oidc");
    sdk.get.mockResolvedValue({ statusCode: 200, stream: new Response("report").body, blob: { size: 6 } });
    sdk.head.mockResolvedValue({ size: 6 });
    const { putManagedBlob, readManagedBlob, statManagedBlob, deleteManagedBlob } = await import("@/server/services/vercelBlobStorage");
    const location = "exports/org/job/report.csv";
    await putManagedBlob({ purpose: "exports", pathname: location, body: Buffer.from("report"), contentType: "text/csv" });
    await readManagedBlob("exports", location);
    await statManagedBlob("exports", location);
    await deleteManagedBlob("exports", location);
    expect(oidc.getToken).toHaveBeenCalledTimes(4);
    for (const [command, index, expected] of [
      [sdk.put, 2, "current-upload-oidc"], [sdk.get, 1, "current-read-oidc"],
      [sdk.head, 1, "current-metadata-oidc"], [sdk.del, 1, "current-delete-oidc"],
    ] as const) {
      expect(command.mock.calls[0]?.[index]).toMatchObject({ storeId: "store_testExports", oidcToken: expected, abortSignal: expect.any(AbortSignal) });
      expect(command.mock.calls[0]?.[index]).not.toHaveProperty("token");
    }
  });

  it("never accepts a missing explicit store or a shared public/private store", async () => {
    vi.stubEnv("BLOB_EXPORT_STORE_ID", "");
    const { putManagedBlob } = await import("@/server/services/vercelBlobStorage");
    await expect(putManagedBlob({ purpose: "exports", pathname: "exports/org/job/report.csv", body: Buffer.from("report"), contentType: "text/csv" }))
      .rejects.toThrow("blobStorageNotConfigured");
    vi.stubEnv("BLOB_EXPORT_STORE_ID", "store_testImages");
    vi.resetModules();
    const again = await import("@/server/services/vercelBlobStorage");
    await expect(again.putManagedBlob({ purpose: "exports", pathname: "exports/org/job/report.csv", body: Buffer.from("report"), contentType: "text/csv" }))
      .rejects.toThrow("blobStorageStoresMustDiffer");
    expect(sdk.put).not.toHaveBeenCalled();
  });

  it("reads private exports as a stream without caching or redirecting to a public URL", async () => {
    const { readManagedBlob, statManagedBlob } = await import("@/server/services/vercelBlobStorage");
    sdk.get.mockResolvedValue({ statusCode: 200, stream: new Response("private report").body, blob: { size: 14 } });
    sdk.head.mockResolvedValue({ size: 14 });
    const result = await readManagedBlob("exports", `${exportBase}/exports/org/job/report.csv`);
    expect(await new Response(result?.stream).text()).toBe("private report");
    expect(sdk.get).toHaveBeenCalledWith("exports/org/job/report.csv", expect.objectContaining({ access: "private", storeId: "store_testExports", useCache: false }));
    expect(await statManagedBlob("exports", `${exportBase}/exports/org/job/report.csv`)).toEqual({ size: 14 });
  });

  it.each([
    "https://foreign.private.blob.vercel-storage.com/exports/org/job/report.csv",
    "https://testexports.private.blob.vercel-storage.com.evil.invalid/exports/a.csv",
    `${imageBase}/exports/org/job/report.csv`,
    `${exportBase}/exports/org/job/report.csv?download=1`,
    "../exports/org/report.csv", "/exports/org/report.csv", "exports/%2e%2e/report.csv",
  ])("rejects an untrusted or cross-store location before a provider call: %s", async (location) => {
    const { readManagedBlob, deleteManagedBlob } = await import("@/server/services/vercelBlobStorage");
    await expect(readManagedBlob("exports", location)).rejects.toThrow("blobStorageLocationInvalid");
    await expect(deleteManagedBlob("exports", location)).rejects.toThrow("blobStorageLocationInvalid");
    expect(sdk.get).not.toHaveBeenCalled(); expect(sdk.del).not.toHaveBeenCalled();
  });

  it("stores actual product upload bytes durably and validates organization-scoped erasure", async () => {
    const { uploadProductImageBuffer, isManagedProductImageUrl, deleteManagedAccountAsset, createProductImageDirectUploadTarget } =
      await import("@/server/services/productImageStorage");
    const bytes = Buffer.from([1, 2, 3, 4]);
    const result = await uploadProductImageBuffer({ organizationId: "org", productId: "product", buffer: bytes, contentType: "image/png" });
    expect(result.url).toMatch(/^https:\/\/testimages\.public\.blob\.vercel-storage\.com\/retails\/org\/products\/product\/[a-f0-9]{40}\.png$/);
    expect(sdk.put.mock.calls[0]?.[1]).toEqual(bytes);
    expect(sdk.mkdir).not.toHaveBeenCalled(); expect(sdk.writeFile).not.toHaveBeenCalled();
    expect(isManagedProductImageUrl(result.url)).toBe(true);
    expect(isManagedProductImageUrl(result.url.replace("testimages.public", "foreign.public"))).toBe(false);
    await expect(deleteManagedAccountAsset("foreign-org", result.url)).rejects.toThrow("accountAssetInvalid");
    expect(sdk.del).not.toHaveBeenCalled();
    await deleteManagedAccountAsset("org", result.url);
    expect(sdk.del).toHaveBeenCalledWith(expect.stringMatching(/^retails\/org\/products\/product\//), expect.objectContaining({ storeId: "store_testImages" }));
    expect(await createProductImageDirectUploadTarget({ organizationId: "org", contentType: "image/png", fileSize: 4 })).toBeNull();
  });
});
