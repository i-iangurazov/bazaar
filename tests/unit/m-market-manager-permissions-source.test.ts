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
    expect(pageSource).toContain("shortDescriptionTargetIds.length <= 0");
    expect(pageSource).toContain("baseDescriptionGenerationDisabledReason");
    expect(pageSource).toContain("startDescriptionGenerationJobMutation.mutate({");
    expect(pageSource).toContain("const handleGenerateDescriptionsForSelected = async () =>");
    expect(pageSource).toContain("const handleGenerateDescriptionsForCurrentFilter = async () =>");
    expect(pageSource).toContain("trpcUtils.mMarket.listIds.fetch({");
    expect(pageSource).toContain("onClick={() => void handleGenerateDescriptionsForSelected()}");
    expect(pageSource).toContain("onClick={() => void handleGenerateDescriptionsForCurrentFilter()}");
    expect(pageSource).toContain(
      "const aiDescriptionGenerationFlagDisabled = !isAiDescriptionGenerationEnabled();",
    );
    expect(pageSource).toContain("trpc.products.descriptionGenerationAvailability.useQuery");
    expect(pageSource).toContain("const currentFilterDescriptionDisabledReason =");
    expect(pageSource).toContain("const selectedDescriptionDisabledReason =");
    expect(pageSource).toContain("const shortDescriptionDisabledReason =");
    expect(pageSource).toContain("disabled={Boolean(currentFilterDescriptionDisabledReason)}");
    expect(pageSource).toContain("disabled={Boolean(selectedDescriptionDisabledReason)}");
    expect(pageSource).toContain("disabled={Boolean(shortDescriptionDisabledReason)}");
    expect(pageSource).not.toContain(
      "aiFeaturesVisuallyDisabled ||\n                  descriptionGenerationRunning",
    );
    const shortDescriptionButtonStart = pageSource.indexOf(
      "onClick={() => void handleGenerateShortDescriptions()}",
    );
    const shortDescriptionButtonEnd = pageSource.indexOf("</Button>", shortDescriptionButtonStart);
    const shortDescriptionButtonSource = pageSource.slice(
      shortDescriptionButtonStart,
      shortDescriptionButtonEnd,
    );
    expect(shortDescriptionButtonSource).not.toContain('tProducts("aiUnavailableBadge")');
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
