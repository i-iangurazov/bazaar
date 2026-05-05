import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

describe("index page source layout", () => {
  it.each([
    ["products", "src/app/(app)/products/page.tsx", "<CardTitle>{t(\"title\")}</CardTitle>"],
    [
      "inventory",
      "src/app/(app)/inventory/page.tsx",
      "<CardTitle>{t(\"inventoryOverview\")}</CardTitle>",
    ],
  ])(
    "keeps saved views, columns and table/grid controls in one desktop row on %s",
    async (_pageName, relativePath, marker) => {
      const source = await readSource(relativePath);
      const tableHeaderStart = source.indexOf(marker);
      const tableHeaderSource = source.slice(tableHeaderStart, tableHeaderStart + 1800);

      expect(tableHeaderSource).toContain("lg:flex-row");
      expect(tableHeaderSource).toContain("lg:flex-wrap");
      expect(tableHeaderSource).toContain("lg:items-center");
      expect(tableHeaderSource).toContain("shrink-0");
      expect(tableHeaderSource).not.toContain("sm:items-end");
    },
  );
});
