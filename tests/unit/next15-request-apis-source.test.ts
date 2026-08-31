import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

const collectTypeScriptFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return collectTypeScriptFiles(entryPath);
      }
      return /\.tsx?$/.test(entry.name) ? [entryPath] : [];
    }),
  );
  return nested.flat();
};

const asyncParamFiles = [
  "src/app/(app)/inventory/counts/[id]/layout.tsx",
  "src/app/(app)/inventory/receiving/[id]/edit/page.tsx",
  "src/app/(app)/inventory/transfers/[id]/edit/page.tsx",
  "src/app/(app)/inventory/write-offs/[id]/edit/page.tsx",
  "src/app/(app)/products/[id]/layout.tsx",
  "src/app/(app)/sales/orders/[id]/layout.tsx",
  "src/app/(app)/stores/[id]/layout.tsx",
  "src/app/(guide)/help/[category]/[guide]/page.tsx",
  "src/app/(guide)/help/[category]/page.tsx",
  "src/app/[locale]/[...slug]/page.tsx",
  "src/app/[locale]/layout.tsx",
  "src/app/api/bakai-store/jobs/[id]/error-report/route.ts",
  "src/app/api/bakai-store/jobs/[id]/workbook/route.ts",
  "src/app/api/bazaar/v1/orders/[id]/route.ts",
  "src/app/api/exports/[id]/route.ts",
  "src/app/api/jobs/cron/[group]/route.ts",
  "src/app/api/m-market/jobs/[id]/error-report/route.ts",
  "src/app/api/o-market/jobs/[id]/error-report/route.ts",
  "src/app/api/pos/receipts/[id]/pdf/route.ts",
  "src/app/api/product-image-studio/jobs/[id]/image/route.ts",
  "src/app/api/public/catalog/[slug]/checkout/route.ts",
  "src/app/api/public/catalog/[slug]/route.ts",
  "src/app/api/purchase-orders/[id]/pdf/route.ts",
  "src/app/c/[slug]/layout.tsx",
  "src/app/c/[slug]/page.tsx",
  "src/app/inventory/movements/[id]/print/page.tsx",
  "src/app/register-business/[token]/layout.tsx",
  "src/app/reset/[token]/page.tsx",
] as const;

const asyncSearchParamFiles = [
  "src/app/(app)/inventory/receiving/[id]/edit/page.tsx",
  "src/app/(app)/inventory/transfers/[id]/edit/page.tsx",
  "src/app/(app)/inventory/write-offs/[id]/edit/page.tsx",
  "src/app/(guide)/help/[category]/[guide]/page.tsx",
  "src/app/[locale]/[...slug]/page.tsx",
  "src/app/inventory/movements/[id]/print/page.tsx",
] as const;

describe("Next 15 asynchronous request APIs", () => {
  it("awaits every cookies() and headers() store before reading it", async () => {
    const sourceFiles = await collectTypeScriptFiles(path.join(process.cwd(), "src"));
    const requestApiFiles: Array<{ file: string; source: string }> = [];

    for (const file of sourceFiles) {
      const source = await readFile(file, "utf8");
      if (source.includes('from "next/headers"')) {
        requestApiFiles.push({ file, source });
      }
    }

    expect(requestApiFiles.length).toBeGreaterThan(0);
    for (const { file, source } of requestApiFiles) {
      expect(source, file).not.toMatch(/\b(?:cookies|headers)\(\)\s*\./);
      if (source.includes("cookies()")) {
        expect(source, file).toMatch(
          /await\s+(?:cookies\(\)|Promise\.all\([\s\S]{0,200}?cookies\(\))/,
        );
      }
      if (source.includes("headers()")) {
        expect(source, file).toMatch(
          /await\s+(?:headers\(\)|Promise\.all\([\s\S]{0,200}?headers\(\))/,
        );
      }
    }
  });

  it.each(asyncParamFiles)("uses and resolves Promise params in %s", async (file) => {
    const source = await readSource(file);
    expect(source).toContain("params: Promise<");
    expect(source).toMatch(/await\s+(?:params|context\.params|Promise\.all\(\[params)/);
  });

  it.each(asyncSearchParamFiles)("uses and resolves Promise searchParams in %s", async (file) => {
    const source = await readSource(file);
    expect(source).toContain("searchParams: Promise<");
    expect(source).toContain("await Promise.all([params, searchParams])");
  });

  it("uses the stable Next 15 server external packages config", async () => {
    const source = await readSource("next.config.mjs");
    expect(source).toContain("serverExternalPackages:");
    expect(source).not.toContain("serverComponentsExternalPackages");
  });
});
