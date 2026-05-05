import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

describe("import store selection source", () => {
  it("keeps product imports targeted to an explicit store", async () => {
    const pageSource = await readSource("src/app/(app)/settings/import/page.tsx");
    const schemaSource = await readSource("src/server/trpc/routers/products.schemas.ts");
    const routerSource = await readSource("src/server/trpc/routers/products.ts");

    expect(pageSource).toContain("targetStoreId");
    expect(pageSource).toContain("storeId: targetStoreId");
    expect(pageSource).toContain("!targetStoreId");
    expect(pageSource).not.toContain('value={targetStoreId || "none"}');
    expect(schemaSource).toContain("storeId: z.string().min(1)");
    expect(routerSource).toContain("assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId)");
  });
});
