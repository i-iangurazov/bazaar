import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

describe("final visual review fixes", () => {
  it("never presents unknown sales cost as zero", async () => {
    const source = await readSource("src/app/(app)/sales/orders/metrics/page.tsx");

    expect(source).toContain("salesOrderMetricsProfitability");
    expect(source).toContain("formatSalesOrderMargin");
    expect(source).toContain('t("metricsCostIncomplete"');
    expect(source).toContain("formatDate(row.date, locale)");
    expect(source).toContain('row.costKgs === null ? "—"');
    expect(source).toContain('row.profitKgs === null ? "—"');
  });

  it("adds visible scroll hints and horizontal focus follow-through", async () => {
    const detail = await readSource("src/app/(app)/sales/orders/[id]/page.tsx");
    const reportTable = await readSource("src/components/reports/report-controls.tsx");
    const table = await readSource("src/components/ui/table.tsx");

    expect(detail).toContain("scrollChildIntoHorizontalView(event.currentTarget, event.target)");
    expect(detail).toContain('{t("horizontalScrollHint")}');
    expect(reportTable).toContain('t("tableScrollHint")');
    expect(reportTable).toContain("container.scrollWidth > container.clientWidth");
    expect(reportTable).toContain("scrollChildIntoHorizontalView(event.currentTarget, event.target)");
    expect(table).toContain("onFocusCapture");
    expect(table).toContain("scrollChildIntoHorizontalView(event.currentTarget, event.target)");
  });

  it("keeps customer validation errors attached to their fields", async () => {
    const source = await readSource("src/app/(app)/customers/page.tsx");

    for (const id of [
      "customer-name-error",
      "customer-contact-error",
      "customer-phone-error",
    ]) {
      expect(source).toContain(`id: "${id}"`);
      expect(source).toContain(`id={error.id}`);
    }
    expect(source).toContain('aria-describedby={emailDescribedBy}');
    expect(source).toContain('aria-describedby={phoneDescribedBy}');
    expect(source).toContain('shownErrorIds.has("customer-name-error") ? "customer-name-error"');
  });

  it("widens the addition quantity column and labels the extra-filter count", async () => {
    const correction = await readSource("src/app/(app)/sales/orders/[id]/correction/page.tsx");
    const toolbar = await readSource("src/components/list-toolbar.tsx");

    expect(correction).toContain(
      "md:grid-cols-[minmax(0,1fr)_7rem_7rem_2.5rem]",
    );
    expect(toolbar).toContain('t("moreFiltersWithCount", { count: extraCount })');
    expect(toolbar).toContain("<span aria-hidden className=");
  });

  it("formats report comparison dates through the locale formatter", async () => {
    for (const file of [
      "src/app/(app)/reports/analytics/page.tsx",
      "src/components/reports/online-sales-report.tsx",
    ]) {
      const source = await readSource(file);
      expect(source).toContain("formatDate(data.period.previousDateFrom, locale)");
      expect(source).toContain("formatDate(data.period.previousDateTo, locale)");
    }
  });
});
