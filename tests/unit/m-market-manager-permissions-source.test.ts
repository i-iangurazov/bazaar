import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

describe("m-market manager product tools source", () => {
  it("allows managers to run product autofill and category bulk tools", async () => {
    const routerSource = await readSource("src/server/trpc/routers/mMarket.ts");
    const pageSource = await readSource("src/app/(app)/operations/integrations/m-market/page.tsx");

    expect(routerSource).toContain("bulkGenerateDescriptions: managerProcedure");
    expect(routerSource).toContain("startDescriptionGenerationJob: managerProcedure");
    expect(routerSource).toContain("bulkAutofillSpecs: managerProcedure");
    expect(routerSource).toContain("bulkCreateBaseTemplates: managerProcedure");
    expect(routerSource).toContain("assignMissingCategory: managerProcedure");
    expect(routerSource).not.toContain("adminProcedure");

    expect(pageSource).toContain('const canEdit = role === "ADMIN" || role === "MANAGER";');
    expect(pageSource).toContain("shortDescriptionTargetIds.length <= 0 ||");
    expect(pageSource).toContain("startDescriptionGenerationJobMutation.mutate({");
    expect(pageSource).toContain("!activeStoreId ||\n      actionableMissingSpecsTargetIds.length <= 0");
    expect(pageSource).toContain(
      "if (!canEdit || !activeStoreId || actionableMissingSpecsCount <= 0)",
    );
    expect(pageSource).toContain(
      "if (!canEdit || !activeStoreId || missingCategoryCount <= 0)",
    );
    expect(pageSource).not.toContain("const isAdmin = role ===");
  });
});
