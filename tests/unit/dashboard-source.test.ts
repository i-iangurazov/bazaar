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

    expect(dashboardSource).toContain(
      'className="rounded-md border border-border bg-card p-4 shadow-sm"',
    );
    expect(dashboardSource).toContain(
      'className="flex min-h-14 items-center gap-2 rounded-md border border-border bg-card px-3 py-3 text-sm text-muted-foreground"',
    );
    expect(dashboardSource).toContain('className="rounded-md border border-border/80 bg-card p-3"');
    expect(dashboardSource).toContain(
      'className="flex items-center justify-between gap-3 rounded-md border border-border/80 bg-secondary/20 px-3 py-2 text-sm transition hover:bg-secondary/40"',
    );
    expect(mobileShellSource).toContain(
      '"flex min-h-14 items-center gap-3 rounded-md border px-3 py-3 text-left no-underline shadow-sm transition hover:no-underline"',
    );
    expect(mobileShellSource).toContain(
      '"block min-h-24 rounded-md border border-border bg-card p-3 text-left no-underline shadow-sm hover:no-underline"',
    );
    expect(loadingSource).toContain(
      'className="h-20 animate-pulse rounded-md border border-border bg-card shadow-sm"',
    );
  });
});
