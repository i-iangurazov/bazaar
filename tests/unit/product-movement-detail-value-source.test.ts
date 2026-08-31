import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("product movement detail value source", () => {
  it("renders reconciled summary and responsive line cost/value fields", async () => {
    const source = await readFile(
      path.join(process.cwd(), "src/app/(app)/inventory/movements/[id]/page.tsx"),
      "utf8",
    );

    expect(source).toContain("getMovementDocumentAmountKgs");
    expect(source).toContain("getMovementDocumentLineValueKgs");
    expect(source).toContain("hasMovementDocumentLineValues");
    expect(source).toContain("formatMoney(reconciledDocumentAmount)");
    expect(source).toContain('t("unitCost")');
    expect(source).toContain('t("lineValue")');
    expect(source.match(/data-movement-unit-cost/g)).toHaveLength(2);
    expect(source.match(/data-movement-line-value/g)).toHaveLength(2);
    expect(source).toContain('showMoneyColumns ? "min-w-[1120px]" : "min-w-[900px]"');
  });
});
