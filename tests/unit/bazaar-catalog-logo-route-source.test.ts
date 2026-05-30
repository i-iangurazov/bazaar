import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

describe("bazaar catalog logo route source", () => {
  it("checks target store access before uploading logo bytes", async () => {
    const source = await readSource("src/app/api/bazaar-catalog/logo/route.ts");

    const accessCheckIndex = source.indexOf("await assertUserCanAccessStore");
    const uploadIndex = source.indexOf("await uploadProductImageBuffer");

    expect(source).toContain('!token.organizationId || !token.sub || !isManagerOrAdmin(token.role)');
    expect(accessCheckIndex).toBeGreaterThan(-1);
    expect(uploadIndex).toBeGreaterThan(-1);
    expect(accessCheckIndex).toBeLessThan(uploadIndex);
    expect(source).toContain('message === "forbidden" || message === "storeAccessDenied"');
  });

  it("rejects SVG logo files at route validation", async () => {
    const source = await readSource("src/app/api/bazaar-catalog/logo/route.ts");

    expect(source).toContain('normalizedType === "image/svg+xml"');
    expect(source).not.toContain('svg: "image/svg+xml"');
  });
});
