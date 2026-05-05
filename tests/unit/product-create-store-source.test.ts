import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

describe("product create store selection source", () => {
  it("requires an explicit target store before creating a product", async () => {
    const source = await readSource("src/app/(app)/products/new/page.tsx");

    expect(source).toContain("createStoreTitle");
    expect(source).toContain("selectedStoreId");
    expect(source).toContain("onValueChange={setSelectedStoreId}");
    expect(source).toContain("storeId: selectedStore.id");
    expect(source).not.toContain("storeId: defaultCurrencyStore?.id");
  });
});
