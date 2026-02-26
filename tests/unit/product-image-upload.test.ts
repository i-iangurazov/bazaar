import { describe, expect, it, vi } from "vitest";

import {
  prepareProductImageFileForUpload,
  resolvePrimaryImageUrl,
} from "../../src/lib/productImageUpload";

const heicHeaderBytes = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0x00, 0x00, 0x00, 0x00,
  0x68, 0x65, 0x69, 0x63,
]);

const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

describe("product image upload preprocessing", () => {
  it("resolves primary image URL from first non-empty image", () => {
    expect(
      resolvePrimaryImageUrl([
        { url: "   " },
        { url: "" },
        { url: " /uploads/img-1.jpg " },
        { url: "/uploads/img-2.jpg" },
      ]),
    ).toBe("/uploads/img-1.jpg");
    expect(resolvePrimaryImageUrl([])).toBe("");
  });

  it("converts HEIC mime variants to JPEG before upload", async () => {
    const source = new File([heicHeaderBytes], "camera-upload", {
      type: "image/heic-sequence",
    });
    const converted = new File([jpegBytes], "camera-upload.jpg", {
      type: "image/jpeg",
    });

    const convertHeicToJpeg = vi.fn().mockResolvedValue(converted);
    const optimizeImageToLimit = vi.fn().mockResolvedValue(null);

    const result = await prepareProductImageFileForUpload({
      file: source,
      maxImageBytes: 5 * 1024 * 1024,
      maxInputImageBytes: 10 * 1024 * 1024,
      convertHeicToJpeg,
      optimizeImageToLimit,
    });

    expect(result).toEqual({ ok: true, file: converted });
    expect(convertHeicToJpeg).toHaveBeenCalledTimes(1);
    expect(convertHeicToJpeg).toHaveBeenCalledWith(source);
    expect(optimizeImageToLimit).not.toHaveBeenCalled();
  });

  it("detects HEIC by extension when mime type is missing", async () => {
    const source = new File([heicHeaderBytes], "holiday.HEIC", {
      type: "",
    });
    const converted = new File([jpegBytes], "holiday.jpg", {
      type: "image/jpeg",
    });

    const convertHeicToJpeg = vi.fn().mockResolvedValue(converted);
    const optimizeImageToLimit = vi.fn().mockResolvedValue(null);

    const result = await prepareProductImageFileForUpload({
      file: source,
      maxImageBytes: 5 * 1024 * 1024,
      maxInputImageBytes: 10 * 1024 * 1024,
      convertHeicToJpeg,
      optimizeImageToLimit,
    });

    expect(result).toEqual({ ok: true, file: converted });
    expect(convertHeicToJpeg).toHaveBeenCalledTimes(1);
    expect(convertHeicToJpeg).toHaveBeenCalledWith(source);
    expect(optimizeImageToLimit).not.toHaveBeenCalled();
  });

  it("detects Apple HEIF extensions when mime type is missing", async () => {
    const source = new File([heicHeaderBytes], "portrait.HIF", {
      type: "",
    });
    const converted = new File([jpegBytes], "portrait.jpg", {
      type: "image/jpeg",
    });

    const convertHeicToJpeg = vi.fn().mockResolvedValue(converted);
    const optimizeImageToLimit = vi.fn().mockResolvedValue(null);

    const result = await prepareProductImageFileForUpload({
      file: source,
      maxImageBytes: 5 * 1024 * 1024,
      maxInputImageBytes: 10 * 1024 * 1024,
      convertHeicToJpeg,
      optimizeImageToLimit,
    });

    expect(result).toEqual({ ok: true, file: converted });
    expect(convertHeicToJpeg).toHaveBeenCalledTimes(1);
    expect(convertHeicToJpeg).toHaveBeenCalledWith(source);
    expect(optimizeImageToLimit).not.toHaveBeenCalled();
  });

  it("returns compression error when HEIC conversion fails", async () => {
    const source = new File([heicHeaderBytes], "camera.heic", {
      type: "image/heic",
    });

    const convertHeicToJpeg = vi.fn().mockResolvedValue(null);
    const optimizeImageToLimit = vi.fn().mockResolvedValue(null);

    const result = await prepareProductImageFileForUpload({
      file: source,
      maxImageBytes: 5 * 1024 * 1024,
      maxInputImageBytes: 10 * 1024 * 1024,
      convertHeicToJpeg,
      optimizeImageToLimit,
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        code: "imageCompressionFailed",
      }),
    );
    expect(convertHeicToJpeg).toHaveBeenCalledTimes(1);
    expect(optimizeImageToLimit).not.toHaveBeenCalled();
  });
});
