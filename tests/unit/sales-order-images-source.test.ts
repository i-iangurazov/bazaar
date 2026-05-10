import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

describe("customer order product images source", () => {
  it("selects and renders product images in order line items", async () => {
    const serviceSource = await readSource("src/server/services/salesOrders.ts");
    const pageSource = await readSource("src/app/(app)/sales/orders/[id]/page.tsx");

    expect(serviceSource).toContain("photoUrl: true");
    expect(serviceSource).toContain("images: {");
    expect(pageSource).toContain("ProductImageThumb");
    expect(pageSource).toContain("line.product.photoUrl ?? line.product.images?.[0]?.url ?? null");
  });
});
