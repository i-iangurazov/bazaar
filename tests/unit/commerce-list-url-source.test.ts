import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const routes = [
  "src/app/(app)/sales/orders/page.tsx",
  "src/app/(app)/customers/page.tsx",
  "src/app/(app)/purchase-orders/page.tsx",
];

describe("commerce list URL state", () => {
  it.each(routes)("keeps pagination and filters in the URL on %s", async (route) => {
    const source = await readFile(route, "utf8");

    expect(source).toContain("useSearchParams");
    expect(source).toContain('searchParams.get("page")');
    expect(source).toContain('searchParams.get("pageSize")');
    expect(source).toContain('searchParams.get("search")');
    expect(source).toContain('searchParams.get("storeId")');
    expect(source).toContain('searchParams.get("sortBy")');
    expect(source).toContain("router.replace(");
    expect(source).toContain("{ scroll: false }");
  });
});
