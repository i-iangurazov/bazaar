import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const rootDir = process.cwd();
const readSource = (path: string) => readFileSync(join(rootDir, path), "utf8");

describe("product AI generation source contract", () => {
  it("keeps Products page overwrite and missing-only modes explicit", () => {
    const source = readSource("src/app/(app)/products/page.tsx");

    expect(source).toContain("confirmBulkGenerateDescriptions");
    expect(source).toContain("confirmBulkGenerateMissingDescriptions");
    expect(source).toContain("overwriteExisting: true");
    expect(source).toContain("overwriteExisting: false");
    expect(source).toContain("handleBulkGenerateMissingDescriptions");
  });

  it("keeps integration overwrite actions aligned with replacement confirmation copy", () => {
    const mMarketSource = readSource("src/app/(app)/operations/integrations/m-market/page.tsx");
    const bakaiSource = readSource("src/app/(app)/operations/integrations/bakai-store/page.tsx");

    expect(mMarketSource).toContain("confirmGenerateDescriptions");
    expect(mMarketSource).toContain("confirmBulkGenerateDescriptions");
    expect(mMarketSource.match(/overwriteExisting: true/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(bakaiSource).toContain("confirmBulkGenerateDescriptions");
    expect(bakaiSource).toContain("overwriteExisting: true");
  });
});
