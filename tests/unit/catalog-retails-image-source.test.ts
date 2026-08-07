import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("public catalog R2 image references", () => {
  it("routes relative /retails objects through the bounded public image proxy", async () => {
    const source = await readFile(
      path.join(process.cwd(), "src/components/catalog/public-catalog-page.tsx"),
      "utf8",
    );

    expect(source).toContain('normalized.startsWith("/retails/")');
    expect(source).toContain("/api/public/catalog/image?");
  });
});
