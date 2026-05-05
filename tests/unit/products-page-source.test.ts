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

  it("chunks inventory bulk on-hand updates instead of sending huge selections in one request", async () => {
    const source = await readSource("src/app/(app)/inventory/page.tsx");
    const handlerStart = source.indexOf("const handleBulkOnHandSubmit");
    const handlerSource = source.slice(handlerStart, handlerStart + 2200);

    expect(source).toContain("const BULK_ON_HAND_CHUNK_SIZE = 5_000");
    expect(handlerSource).toContain("index += BULK_ON_HAND_CHUNK_SIZE");
    expect(handlerSource).toContain("snapshotIds.slice(index, index + BULK_ON_HAND_CHUNK_SIZE)");
    expect(handlerSource).toContain("bulkOnHandMutation.mutateAsync");
    expect(handlerSource).toContain("setBulkOnHandProgress");
  });
});
