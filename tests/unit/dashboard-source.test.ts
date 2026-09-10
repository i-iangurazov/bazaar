import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

describe("dashboard source layout", () => {
  it("does not render a separate low-stock card because low stock is already in attention", async () => {
    const source = await readSource("src/app/(app)/dashboard/page.tsx");

    expect(source).toContain('key: "lowStock"');
    expect(source).toContain('label: t("lowStock")');
    expect(source).not.toContain('<CardTitle>{t("lowStock")}</CardTitle>');
    expect(source).toContain("workspace-dashboard-chart");
  });

  it("uses compact responsive cards, real zero-height bars and visible empty states", async () => {
    const dashboardSource = await readSource("src/app/(app)/dashboard/page.tsx");
    const mobileShellSource = await readSource("src/components/mobile-app-shell.tsx");
    const loadingSource = await readSource("src/components/page-loading.tsx");

    expect(dashboardSource).toContain(
      "const salesSeries = dashboardQuery.data?.summary.salesSeries ?? [];",
    );
    expect(dashboardSource).toContain(
      "const topProducts = dashboardQuery.data?.summary.topProducts ?? [];",
    );
    expect(dashboardSource).toContain("renderTrendBadge");
    expect(dashboardSource).not.toContain("const analyticsBars");
    expect(dashboardSource).not.toContain('className="h-2 w-8 rounded-full bg-current opacity-80"');
    expect(dashboardSource).toContain("data-dashboard-kpi={kpi.key}");
    expect(dashboardSource).toContain("workspace-kpi-grid grid grid-cols-2 gap-3");
    expect(dashboardSource).toContain(
      "height: maxSales > 0 ? `${(day.salesKgs / maxSales) * 75}%` : 0",
    );
    expect(dashboardSource).toContain("if (delta === null || delta === undefined) return null");
    expect(dashboardSource).toContain("<QuietState>");
    expect(mobileShellSource).toContain(
      '"flex min-h-14 items-center gap-3 rounded-xl border px-3 py-3 text-left no-underline shadow-sm transition hover:no-underline"',
    );
    expect(mobileShellSource).toContain(
      '"bazaar-mobile-card-surface block min-h-24 rounded-xl border border-border/80 p-3 text-left no-underline shadow-sm hover:no-underline"',
    );
    expect(loadingSource).toContain(
      'className="h-32 animate-pulse rounded-xl border border-border/70 bg-card shadow-sm"',
    );
  });

  it("uses real business aggregates for dashboard charts and product insights", async () => {
    const serviceSource = await readSource("src/server/services/dashboard/summary.ts");
    const dashboardSource = await readSource("src/app/(app)/dashboard/page.tsx");

    expect(serviceSource).toContain("yesterdayStart");
    expect(serviceSource).toContain("DashboardSalesSeriesRow");
    expect(serviceSource).toContain("DashboardTopProductRow");
    expect(serviceSource).toContain("AT TIME ZONE");
    expect(serviceSource).toContain("defaultTimeZone");
    expect(serviceSource).toContain('SUM(l."lineTotalKgs")');
    expect(serviceSource).toContain("hasCompleteCostData");
    expect(dashboardSource).toContain('t("notCalculated")');
    expect(dashboardSource).toContain('t("grossProfitMissingCostHint")');
    expect(dashboardSource).toContain('t("noSalesForPeriod")');
    expect(dashboardSource).toContain('t("topProducts")');
    expect(dashboardSource).toContain('t("lowStockProducts")');
    expect(dashboardSource).toContain('t("noAttentionTasks")');
  });
});
