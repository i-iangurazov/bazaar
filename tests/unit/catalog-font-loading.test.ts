import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("catalog font loading", () => {
  it("keeps the Bazaar base font global and scopes optional families to catalog routes", () => {
    const fontSource = readSource("src/lib/catalogFonts.ts");
    const rootLayout = readSource("src/app/layout.tsx");
    const publicCatalogLayout = readSource("src/app/c/[slug]/layout.tsx");
    const settingsLayout = readSource(
      "src/app/(app)/operations/integrations/bazaar-catalog/layout.tsx",
    );

    expect(rootLayout).toContain("bazaarBaseFontStylesheetHref");
    expect(rootLayout).not.toContain("bazaarCatalogFontStylesheetHref");
    expect(fontSource).toContain("family=Jost");
    expect(fontSource).toContain("family=Montserrat");
    expect(publicCatalogLayout).toContain("bazaarCatalogFontStylesheetHref");
    expect(settingsLayout).toContain("bazaarCatalogFontStylesheetHref");
  });
});
