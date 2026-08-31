import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("runtime font loading", () => {
  it("uses local-first font stacks without browser requests to external font providers", () => {
    const fontSource = readSource("src/lib/catalogFonts.ts");
    const rootLayout = readSource("src/app/layout.tsx");
    const publicCatalogLayout = readSource("src/app/c/[slug]/layout.tsx");
    const settingsLayout = readSource(
      "src/app/(app)/operations/integrations/bazaar-catalog/layout.tsx",
    );
    const globalStyles = readSource("src/app/globals.css");
    const runtimeSources = [fontSource, rootLayout, publicCatalogLayout, settingsLayout];

    for (const source of runtimeSources) {
      expect(source).not.toContain("fonts.googleapis.com");
      expect(source).not.toContain("fonts.gstatic.com");
      expect(source).not.toMatch(/<link[^>]+rel=["']stylesheet["'][^>]+https?:\/\//);
    }
    expect(rootLayout).not.toContain("FontStylesheetHref");
    expect(publicCatalogLayout).not.toContain("FontStylesheetHref");
    expect(settingsLayout).not.toContain("FontStylesheetHref");
    expect(fontSource).toContain("bazaarBaseLocalFontStack");
    expect(fontSource).toContain('"Jost"');
    expect(fontSource).toContain('"Montserrat"');
    expect(globalStyles).toContain('"Jost", "Inter", system-ui');
  });
});
