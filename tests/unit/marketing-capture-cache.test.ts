import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { marketingCaptures } from "@/content/marketing/assets";

describe("public product capture delivery", () => {
  it("versions each shipped WebP by its content and keeps the declared image proportions", async () => {
    for (const [name, source] of Object.entries(marketingCaptures)) {
      const url = new URL(source, "https://www.bazaar.kg");
      const bytes = await readFile(`public${url.pathname}`);
      expect(url.searchParams.get("v"), name).toBe(
        createHash("sha256").update(bytes).digest("hex").slice(0, 12),
      );
      const image = await sharp(bytes).metadata();
      expect(image.format, name).toBe("webp");
      expect(image.width! / image.height!, name).toBeCloseTo(
        name === "posMobile" ? 780 / 1688 : 1920 / 1080,
        6,
      );
    }
  });
});
