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
    expect(source).toContain("xl:col-span-8");
  });

  it("keeps dashboard cards and state surfaces softly rounded", async () => {
    const dashboardSource = await readSource("src/app/(app)/dashboard/page.tsx");
    const mobileShellSource = await readSource("src/components/mobile-app-shell.tsx");
    const loadingSource = await readSource("src/components/page-loading.tsx");

    expect(dashboardSource).toContain("const salesSeries = dashboardQuery.data?.summary.salesSeries ?? [];");
    expect(dashboardSource).toContain("const topProducts = dashboardQuery.data?.summary.topProducts ?? [];");
    expect(dashboardSource).toContain("renderTrendBadge");
    expect(dashboardSource).not.toContain("const analyticsBars");
    expect(dashboardSource).not.toContain('className="h-2 w-8 rounded-full bg-current opacity-80"');
    expect(dashboardSource).toContain("min-h-36 border-border/70 bg-card/95 shadow-sm transition");
    expect(dashboardSource).toContain('style={{ height: `${Math.max(height, 4)}%` }}');
    expect(dashboardSource).toContain(
      'className="flex min-h-16 items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/35 px-4 py-3 text-sm transition hover:border-primary/35 hover:bg-primary/5"',
    );
    expect(dashboardSource).toContain('className="flex min-h-24 items-center justify-center gap-2 rounded-xl bg-muted/35 text-sm text-muted-foreground"');
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
    expect(serviceSource).toContain("SUM(l.\"lineTotalKgs\")");
    expect(serviceSource).toContain("hasCompleteCostData");
    expect(dashboardSource).toContain('t("notCalculated")');
    expect(dashboardSource).toContain('t("grossProfitMissingCostHint")');
    expect(dashboardSource).toContain('t("noSalesForPeriod")');
    expect(dashboardSource).toContain('t("topProducts")');
    expect(dashboardSource).toContain('t("lowStockProducts")');
    expect(dashboardSource).toContain('t("noAttentionTasks")');
  });
});
