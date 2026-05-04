import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  shouldFrameCatalogProductImage,
  transformCatalogImageToWebp,
} from "@/server/services/catalogImageTransform";

describe("catalog image transform", () => {
  it("frames transparent PNG cutouts on a padded square canvas", async () => {
    const sourceBuffer = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([
        {
          input: Buffer.from(
            `<svg width="80" height="40" xmlns="http://www.w3.org/2000/svg"><rect width="80" height="40" fill="black"/></svg>`,
          ),
          left: 10,
          top: 30,
        },
      ])
      .png()
      .toBuffer();

    const output = await transformCatalogImageToWebp({
      sourceBuffer,
      width: 400,
      quality: 80,
      sourceMimeType: "image/png",
    });
    const metadata = await sharp(output).metadata();

    expect(metadata.width).toBe(400);
    expect(metadata.height).toBe(400);

    const alpha = await sharp(output).ensureAlpha().extractChannel("alpha").raw().toBuffer();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;

    alpha.forEach((value, index) => {
      if (value === 0) {
        return;
      }
      const x = index % width;
      const y = Math.floor(index / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    });

    expect(minX).toBeGreaterThan(30);
    expect(minY).toBeGreaterThan(30);
    expect(maxX).toBeLessThan(370);
    expect(maxY).toBeLessThan(370);
  });

  it("only considers images with an alpha channel for transparent cutout framing", () => {
    expect(
      shouldFrameCatalogProductImage({
        metadata: { format: "jpeg", hasAlpha: false },
        sourceMimeType: "image/jpeg",
      }),
    ).toBe(false);
    expect(
      shouldFrameCatalogProductImage({
        metadata: { format: "png", hasAlpha: false },
        sourceMimeType: "image/png",
      }),
    ).toBe(false);
    expect(
      shouldFrameCatalogProductImage({
        metadata: { format: "png", hasAlpha: true },
        sourceMimeType: "image/png",
      }),
    ).toBe(true);
  });

  it("outputs opaque product photos as square images without transparent padding", async () => {
    const sourceBuffer = await sharp({
      create: {
        width: 300,
        height: 180,
        channels: 3,
        background: { r: 12, g: 80, b: 180 },
      },
    })
      .jpeg()
      .toBuffer();

    const output = await transformCatalogImageToWebp({
      sourceBuffer,
      width: 400,
      quality: 80,
      sourceMimeType: "image/jpeg",
    });
    const metadata = await sharp(output).metadata();

    expect(metadata.width).toBe(400);
    expect(metadata.height).toBe(400);
  });
});
