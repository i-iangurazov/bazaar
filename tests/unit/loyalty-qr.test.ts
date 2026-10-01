import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { BinaryBitmap, HybridBinarizer, MultiFormatReader, RGBLuminanceSource } from "@zxing/library";
import { renderQrPng } from "@/server/services/loyalty/qr";

describe("customer card QR", () => {
  it("decodes its signed payload and has an opaque white quiet zone", async () => {
    const token = "bazaar-loyalty-card:" + "aB9-_".repeat(35);
    const png = await renderQrPng(token);
    const { data, info } = await sharp(png).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBe(255);
    const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(new Uint8ClampedArray(data), info.width, info.height)));
    expect(new MultiFormatReader().decode(bitmap).getText()).toBe(token);
  });
});
