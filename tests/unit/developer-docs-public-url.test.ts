import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("public Bazaar API documentation", () => {
  it("publishes the canonical production URL without deployment placeholder copy", async () => {
    const source = await readFile(
      path.join(process.cwd(), "src/app/developers/bazaar-api/page.tsx"),
      "utf8",
    );

    expect(source).toContain("https://www.bazaar.kg/developers/bazaar-api");
    expect(source).not.toContain("После деплоя");
    expect(source).not.toContain("на вашем домене");
  });
});
