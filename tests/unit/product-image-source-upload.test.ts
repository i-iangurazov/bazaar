import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { prepareProductStudioSource } from "@/server/services/productImageSourceUpload";

describe("real studio source codecs", () => {
  it.each(["heic", "heif"])(
    "decodes real %s bytes into a browser/provider-readable JPEG",
    async (extension) => {
      const data = await readFile("tests/fixtures/images/studio.heic");
      const result = await prepareProductStudioSource(
        new File([new Uint8Array(data)], `PHONE.${extension.toUpperCase()}`, {
          type: "application/octet-stream",
        }),
      );
      expect(result.contentType).toBe("image/jpeg");
      expect(await sharp(result.buffer).metadata()).toMatchObject({
        format: "jpeg",
        width: 800,
        height: 900,
      });
    },
  );
  it.each(["jpeg", "png", "webp", "avif", "gif", "tiff"] as const)(
    "accepts actual %s photo contents",
    async (format) => {
      const data = await sharp({
        create: { width: 600, height: 700, channels: 3, background: "blue" },
      })
        .toFormat(format)
        .toBuffer();
      const result = await prepareProductStudioSource(
        new File([new Uint8Array(data)], `photo.${format}`, { type: `image/${format}` }),
      );
      const metadata = await sharp(result.buffer).metadata();
      expect(["jpeg", "png", "webp"]).toContain(metadata.format);
      expect(metadata.width).toBe(600);
    },
  );
  it("rejects renamed HTML, SVG and invalid HEIC instead of publishing them", async () => {
    for (const [name, type] of [
      ["photo.jpg", "image/jpeg"],
      ["photo.heic", "image/heic"],
      ["photo.svg", "image/svg+xml"],
    ]) {
      await expect(
        prepareProductStudioSource(new File(["<svg><script>bad()</script></svg>"], name, { type })),
      ).rejects.toThrow("imageInvalidType");
    }
  });
});
