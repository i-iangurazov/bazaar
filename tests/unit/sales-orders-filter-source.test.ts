import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

describe("sales orders filter layout source", () => {
  it("keeps both creation dates in one labelled period group in the main filters", async () => {
    const source = await readSource("src/app/(app)/sales/orders/page.tsx");
    const mainFiltersStart = source.indexOf("<ListSearch");
    const toolbarEnd = source.indexOf("</ListToolbar>", mainFiltersStart);
    const mainFilters = source.slice(mainFiltersStart, toolbarEnd);

    expect(mainFiltersStart).toBeGreaterThan(-1);
    expect(toolbarEnd).toBeGreaterThan(mainFiltersStart);
    expect(mainFilters).toContain('data-testid="sales-order-period-group"');
    expect(mainFilters).toContain("<fieldset");
    expect(mainFilters).toContain('{t("createdPeriod")}');
    expect(mainFilters).toContain('id="sales-order-created-from"');
    expect(mainFilters).toContain('id="sales-order-created-to"');
    expect(mainFilters).toContain('{t("createdFrom")}');
    expect(mainFilters).toContain('{t("createdTo")}');
    expect(mainFilters).toContain('id="sales-order-store"');
    expect(mainFilters).toContain('id="sales-order-employee"');
    expect(mainFilters).not.toContain('id="sales-order-statusLabel"');
    expect(mainFilters).not.toContain('id="sales-order-sortLabel"');
  });

  it("keeps status and sort in the collapsible extra filters with an active count", async () => {
    const source = await readSource("src/app/(app)/sales/orders/page.tsx");
    const extraFiltersStart = source.indexOf('data-testid="sales-order-extra-filters"');
    const toolbarEnd = source.indexOf("</ListToolbar>", extraFiltersStart);
    const extraFilters = source.slice(extraFiltersStart, toolbarEnd);

    expect(extraFiltersStart).toBeGreaterThan(-1);
    expect(toolbarEnd).toBeGreaterThan(extraFiltersStart);
    expect(source).toContain("extraCount={activeExtraFilterCount}");
    expect(source).toContain("const activeExtraFilterCount =");
    expect(extraFilters).toContain('id="sales-order-statusLabel"');
    expect(extraFilters).toContain('id="sales-order-sortLabel"');
    expect(extraFilters).toContain('setFilter("status"');
    expect(extraFilters).toContain("updateListParams({");
    expect(extraFilters).toContain("sortBy:");
    expect(extraFilters).toContain("sortDirection:");
  });

  it("keeps active status and non-default sort visible and resettable through chips", async () => {
    const source = await readSource("src/app/(app)/sales/orders/page.tsx");

    expect(source).toContain('key: "status"');
    expect(source).toContain('key: "sort"');
    expect(source).toContain("currentSortLabel");
    expect(source).toContain("sortBy: null");
    expect(source).toContain("sortDirection: null");
  });
});
