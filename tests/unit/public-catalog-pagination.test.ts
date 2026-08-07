import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/public/catalog/[slug]/route";

describe("public catalog pagination", () => {
  it("rejects invalid page and oversized page values before a database read", async () => {
    const invalidPage = await GET(
      new Request("http://localhost/api/public/catalog/example-slug?page=0"),
      { params: { slug: "example-slug" } },
    );
    const oversizedPage = await GET(
      new Request("http://localhost/api/public/catalog/example-slug?pageSize=61"),
      { params: { slug: "example-slug" } },
    );

    expect(invalidPage.status).toBe(400);
    expect(await invalidPage.json()).toEqual({ message: "validationError" });
    expect(oversizedPage.status).toBe(400);
  });

  it("keeps cart products independently of the loaded page and refreshes them by id", async () => {
    const source = await readFile("src/components/catalog/public-catalog-page.tsx", "utf8");

    expect(source).toContain("knownProducts");
    expect(source).toContain("mergeKnownProducts(body.products)");
    expect(source).toContain('refreshParams.append("productId", productId)');
    expect(source).toContain("catalog.pagination.hasMore");
    expect(source).toContain("void loadMore()");
  });
});
