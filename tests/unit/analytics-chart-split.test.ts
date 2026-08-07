import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("analytics chart bundle split", () => {
  it("keeps Recharts out of the initial analytics page module", () => {
    const pageSource = readSource("src/app/(app)/reports/analytics/page.tsx");
    const chartSource = readSource("src/components/reports/sales-overview-chart.tsx");

    expect(pageSource).not.toContain('from "recharts"');
    expect(pageSource).toContain('import("@/components/reports/sales-overview-chart")');
    expect(pageSource).toContain("ssr: false");
    expect(pageSource).toContain("onSelectDate={setSelectedDay}");
    expect(chartSource).toContain('from "recharts"');
    expect(chartSource).toContain("onSelectDate(payload.payload.date)");
  });
});
