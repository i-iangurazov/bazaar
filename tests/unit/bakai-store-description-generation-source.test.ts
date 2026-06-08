import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

describe("bakai store AI description generation source", () => {
  it("uses description-specific availability and explicit disabled reasons", async () => {
    const pageSource = await readSource(
      "src/app/(app)/operations/integrations/bakai-store/page.tsx",
    );
    const routerSource = await readSource("src/server/trpc/routers/bakaiStore.ts");

    expect(routerSource).toContain("startDescriptionGenerationJob: managerProcedure");
    expect(pageSource).toContain(
      "const aiDescriptionGenerationFlagDisabled = !isAiDescriptionGenerationEnabled();",
    );
    expect(pageSource).not.toContain("isAiFeaturesEnabled");
    expect(pageSource).not.toContain("aiFeaturesVisuallyDisabled");
    expect(pageSource).toContain("trpc.products.descriptionGenerationAvailability.useQuery");
    expect(pageSource).toContain("const currentFilterDescriptionDisabledReason =");
    expect(pageSource).toContain("const selectedDescriptionDisabledReason =");
    expect(pageSource).toContain("disabled={Boolean(currentFilterDescriptionDisabledReason)}");
    expect(pageSource).toContain("disabled={Boolean(selectedDescriptionDisabledReason)}");
    expect(pageSource).toContain("title={currentFilterDescriptionDisabledReason ?? undefined}");
    expect(pageSource).toContain("title={selectedDescriptionDisabledReason ?? undefined}");
  });
});
