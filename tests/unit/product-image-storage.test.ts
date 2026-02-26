import { beforeEach, describe, expect, it, vi } from "vitest";

const heifContainerBytes = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x69, 0x66, 0x31, 0x00, 0x00, 0x00, 0x00,
  0x68, 0x65, 0x69, 0x63, 0x00, 0x00, 0x00, 0x00,
]);

const {
  mockMkdir,
  mockWriteFile,
  mockSharpFactory,
  mockSharpToBuffer,
  mockHeicConvert,
} = vi.hoisted(() => ({
  mockMkdir: vi.fn(),
  mockWriteFile: vi.fn(),
  mockSharpFactory: vi.fn(),
  mockSharpToBuffer: vi.fn(),
  mockHeicConvert: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...args),
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
    process.env.IMAGE_STORAGE_PROVIDER = "local";
    process.env.R2_ACCOUNT_ID = "";
    process.env.R2_ACCESS_KEY_ID = "";
    process.env.R2_SECRET_ACCESS_KEY = "";
    process.env.R2_BUCKET_NAME = "";
    process.env.R2_PUBLIC_BASE_URL = "";
    process.env.R2_ENDPOINT = "";
    mockMkdir.mockResolvedValue(undefined);
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

    const { uploadProductImageBuffer } = await import(
      "../../src/server/services/productImageStorage"
    );
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

    const { uploadProductImageBuffer } = await import(
      "../../src/server/services/productImageStorage"
    );
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

  it("falls back to heic-convert when sharp cannot decode HEIF", async () => {
    const convertedBytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0x00, 0x11]);
    mockSharpToBuffer.mockRejectedValue(new Error("Input buffer contains unsupported image format"));
    mockHeicConvert.mockResolvedValue(convertedBytes);
    mockSharpFactory.mockImplementation(() => {
      const pipeline = {
        rotate: vi.fn().mockReturnThis(),
        jpeg: vi.fn().mockReturnThis(),
        toBuffer: (...args: unknown[]) => mockSharpToBuffer(...args),
      };
      return pipeline;
    });

    const { uploadProductImageBuffer } = await import(
      "../../src/server/services/productImageStorage"
    );
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
    mockSharpToBuffer.mockRejectedValue(new Error("Input buffer contains unsupported image format"));
    mockHeicConvert.mockRejectedValue(new Error("format not supported"));
    mockSharpFactory.mockImplementation(() => {
      const pipeline = {
        rotate: vi.fn().mockReturnThis(),
        jpeg: vi.fn().mockReturnThis(),
        toBuffer: (...args: unknown[]) => mockSharpToBuffer(...args),
      };
      return pipeline;
    });

    const { uploadProductImageBuffer } = await import(
      "../../src/server/services/productImageStorage"
    );

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
