import { beforeEach, describe, expect, it, vi } from "vitest";

const heifContainerBytes = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x69, 0x66, 0x31, 0x00, 0x00, 0x00, 0x00,
  0x68, 0x65, 0x69, 0x63, 0x00, 0x00, 0x00, 0x00,
]);

const {
  mockMkdir,
  mockReadFile,
  mockRealpath,
  mockStat,
  mockWriteFile,
  mockSharpFactory,
  mockSharpToBuffer,
  mockHeicConvert,
} = vi.hoisted(() => ({
  mockMkdir: vi.fn(),
  mockReadFile: vi.fn(),
  mockRealpath: vi.fn(),
  mockStat: vi.fn(),
  mockWriteFile: vi.fn(),
  mockSharpFactory: vi.fn(),
  mockSharpToBuffer: vi.fn(),
  mockHeicConvert: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  realpath: (...args: unknown[]) => mockRealpath(...args),
  stat: (...args: unknown[]) => mockStat(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}));

vi.mock("sharp", () => ({
  default: (...args: unknown[]) => mockSharpFactory(...args),
}));

vi.mock("heic-convert", () => ({
  default: (...args: unknown[]) => mockHeicConvert(...args),
}));

describe("product image storage", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    process.env.IMAGE_STORAGE_PROVIDER = "local";
    process.env.R2_ACCOUNT_ID = "";
    process.env.R2_ACCESS_KEY_ID = "";
    process.env.R2_SECRET_ACCESS_KEY = "";
    process.env.R2_BUCKET_NAME = "";
    process.env.R2_PUBLIC_BASE_URL = "";
    process.env.R2_ENDPOINT = "";
    mockMkdir.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff]));
    mockRealpath.mockImplementation(async (path: unknown) => String(path));
    mockStat.mockResolvedValue({ isFile: () => true, size: 3 });
    mockWriteFile.mockResolvedValue(undefined);
    mockHeicConvert.mockReset();
  });

  it("transcodes HEIC uploads to JPEG before writing to storage", async () => {
    const convertedBytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    mockSharpToBuffer.mockResolvedValue(convertedBytes);
    mockSharpFactory.mockImplementation(() => {
      const pipeline = {
        rotate: vi.fn().mockReturnThis(),
        jpeg: vi.fn().mockReturnThis(),
        toBuffer: (...args: unknown[]) => mockSharpToBuffer(...args),
      };
      return pipeline;
    });

    const { uploadProductImageBuffer } =
      await import("../../src/server/services/productImageStorage");
    const result = await uploadProductImageBuffer({
      organizationId: "org-1",
      productId: "prod-1",
      buffer: Buffer.from([1, 2, 3, 4]),
      contentType: "image/heic",
      sourceFileName: "camera.HEIC",
    });

    expect(mockSharpFactory).toHaveBeenCalledTimes(1);
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    const [path, data] = mockWriteFile.mock.calls[0] as [string, Buffer];
    expect(path).toMatch(/\.jpg$/);
    expect(data.equals(convertedBytes)).toBe(true);
    expect(result.url).toMatch(/\.jpg$/);
  });

  it("stores PNG uploads as-is without HEIC transcoding", async () => {
    const inputBytes = Buffer.from([7, 8, 9, 10]);

    const { uploadProductImageBuffer } =
      await import("../../src/server/services/productImageStorage");
    const result = await uploadProductImageBuffer({
      organizationId: "org-1",
      productId: "prod-1",
      buffer: inputBytes,
      contentType: "image/png",
      sourceFileName: "photo.png",
    });

    expect(mockSharpFactory).not.toHaveBeenCalled();
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    const [path, data] = mockWriteFile.mock.calls[0] as [string, Buffer];
    expect(path).toMatch(/\.png$/);
    expect(data.equals(inputBytes)).toBe(true);
    expect(result.url).toMatch(/\.png$/);
  });

  it("rejects SVG uploads before writing to storage", async () => {
    const { uploadProductImageBuffer } =
      await import("../../src/server/services/productImageStorage");

    await expect(
      uploadProductImageBuffer({
        organizationId: "org-1",
        productId: "prod-1",
        buffer: Buffer.from("<svg></svg>"),
        contentType: "image/svg+xml",
        sourceFileName: "icon.svg",
      }),
    ).rejects.toThrow("imageInvalidType");

    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("normalizes image URLs copied from JSON-like spreadsheet cells", async () => {
    const { normalizeProductImageUrl } =
      await import("../../src/server/services/productImageStorage");

    expect(
      normalizeProductImageUrl(
        '["https://cdn.shopify.com/s/files/1/test/files/photo.jpg?v=1760877521"]',
      ),
    ).toBe("https://cdn.shopify.com/s/files/1/test/files/photo.jpg?v=1760877521");
    expect(normalizeProductImageUrl('"https://cdn.shopify.com/photo.jpg?v=1"')).toBe(
      "https://cdn.shopify.com/photo.jpg?v=1",
    );
    expect(normalizeProductImageUrl("retails/org-1/products/prod-1/photo.jpg")).toBe(
      "/retails/org-1/products/prod-1/photo.jpg",
    );
    expect(normalizeProductImageUrl("/retails/org-1/products/prod-1/photo.jpg")).toBe(
      "/retails/org-1/products/prod-1/photo.jpg",
    );
  });

  it("can disable source-url fallback when a remote image cannot be copied", async () => {
    const { resolveProductImageUrl } =
      await import("../../src/server/services/productImageStorage");

    await expect(
      resolveProductImageUrl({
        value: "https://localhost/private.jpg",
        organizationId: "org-1",
      }),
    ).resolves.toMatchObject({
      url: "https://localhost/private.jpg",
      managed: false,
    });

    await expect(
      resolveProductImageUrl({
        value: "https://localhost/private.jpg",
        organizationId: "org-1",
        fallbackToSource: false,
      }),
    ).resolves.toMatchObject({
      url: null,
      managed: false,
    });
  });

  it("does not follow remote image redirects to blocked hosts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/private.png" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { downloadRemoteImage } = await import("../../src/server/services/productImageStorage");

    await expect(downloadRemoteImage("http://93.184.216.34/image.jpg")).resolves.toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
  });

  it("keeps managed R2 redirects inside the configured origin and tenant prefix", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://93.184.216.35/retails/org-1/products/secret.png" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { downloadManagedRemoteImage } =
      await import("../../src/server/services/productImageStorage");

    await expect(
      downloadManagedRemoteImage("https://93.184.216.34/retails/org-1/products/image.jpg", {
        allowedOrigin: "https://93.184.216.34",
        allowedPathPrefix: "/retails/org-1/",
      }),
    ).resolves.toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
  });

  it("rejects encoded separators in managed R2 redirects before the second fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: {
          location: "https://93.184.216.34/retails/org-1/products/hidden%2Fsecret.png",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { downloadManagedRemoteImage } =
      await import("../../src/server/services/productImageStorage");

    await expect(
      downloadManagedRemoteImage("https://93.184.216.34/retails/org-1/products/image.jpg", {
        allowedOrigin: "https://93.184.216.34",
        allowedPathPrefix: "/retails/org-1/",
      }),
    ).resolves.toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("canonicalizes each same-tenant managed R2 redirect before fetching", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {
            location: "https://93.184.216.34/retails/org-1/products/final.png",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(png, {
          status: 200,
          headers: { "content-type": "image/png", "content-length": String(png.length) },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { downloadManagedRemoteImage } =
      await import("../../src/server/services/productImageStorage");

    await expect(
      downloadManagedRemoteImage("https://93.184.216.34/retails/org-1/products/image.jpg", {
        allowedOrigin: "https://93.184.216.34",
        allowedPathPrefix: "/retails/org-1/",
      }),
    ).resolves.toEqual({ buffer: png, contentType: "image/png" });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://93.184.216.34/retails/org-1/products/final.png",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("keeps already-managed unassigned upload URLs without synchronous re-copying", async () => {
    const { resolveProductImageUrl } =
      await import("../../src/server/services/productImageStorage");
    const managedUrl = "/uploads/imported-products/org-1/products/unassigned/photo.jpg";

    await expect(
      resolveProductImageUrl({
        value: managedUrl,
        organizationId: "org-1",
        productId: "prod-1",
      }),
    ).resolves.toEqual({
      url: managedUrl,
      managed: true,
    });

    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("reads tenant-scoped extensionless managed images for byte-based MIME detection", async () => {
    const { readManagedLocalProductImage } =
      await import("../../src/server/services/productImageStorage");

    await expect(
      readManagedLocalProductImage({
        url: "/uploads/imported-products/org-1/products/unassigned/image-without-extension",
        organizationId: "org-1",
      }),
    ).resolves.toEqual({
      buffer: Buffer.from([0xff, 0xd8, 0xff]),
      contentType: "application/octet-stream",
    });
  });

  it("rejects cross-tenant and traversal-like managed paths before file access", async () => {
    const { readManagedLocalProductImage } =
      await import("../../src/server/services/productImageStorage");

    await expect(
      readManagedLocalProductImage({
        url: "/uploads/imported-products/other-org/products/p-1/photo.jpg",
        organizationId: "org-1",
      }),
    ).resolves.toBeNull();
    await expect(
      readManagedLocalProductImage({
        url: "/uploads/imported-products/org-1/../../../../.env",
        organizationId: "org-1",
      }),
    ).resolves.toBeNull();

    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("falls back to heic-convert when sharp cannot decode HEIF", async () => {
    const convertedBytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0x00, 0x11]);
    mockSharpToBuffer.mockRejectedValue(
      new Error("Input buffer contains unsupported image format"),
    );
    mockHeicConvert.mockResolvedValue(convertedBytes);
    mockSharpFactory.mockImplementation(() => {
      const pipeline = {
        rotate: vi.fn().mockReturnThis(),
        jpeg: vi.fn().mockReturnThis(),
        toBuffer: (...args: unknown[]) => mockSharpToBuffer(...args),
      };
      return pipeline;
    });

    const { uploadProductImageBuffer } =
      await import("../../src/server/services/productImageStorage");
    const result = await uploadProductImageBuffer({
      organizationId: "org-1",
      productId: "prod-1",
      buffer: heifContainerBytes,
      contentType: "image/heif",
      sourceFileName: "camera.HEIF",
    });

    expect(mockSharpFactory).toHaveBeenCalledTimes(1);
    expect(mockHeicConvert).toHaveBeenCalledTimes(1);
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    const [path, data] = mockWriteFile.mock.calls[0] as [string, Buffer];
    expect(path).toMatch(/\.jpg$/);
    expect(data.equals(convertedBytes)).toBe(true);
    expect(result.url).toMatch(/\.jpg$/);
  });

  it("rejects HEIF upload when all converters fail", async () => {
    mockSharpToBuffer.mockRejectedValue(
      new Error("Input buffer contains unsupported image format"),
    );
    mockHeicConvert.mockRejectedValue(new Error("format not supported"));
    mockSharpFactory.mockImplementation(() => {
      const pipeline = {
        rotate: vi.fn().mockReturnThis(),
        jpeg: vi.fn().mockReturnThis(),
        toBuffer: (...args: unknown[]) => mockSharpToBuffer(...args),
      };
      return pipeline;
    });

    const { uploadProductImageBuffer } =
      await import("../../src/server/services/productImageStorage");

    await expect(
      uploadProductImageBuffer({
        organizationId: "org-1",
        productId: "prod-1",
        buffer: heifContainerBytes,
        contentType: "image/heif",
        sourceFileName: "camera.heif",
      }),
    ).rejects.toThrow("imageInvalidType");

    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});
