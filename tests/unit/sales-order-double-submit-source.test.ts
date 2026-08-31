import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("sales-order create submission guard", () => {
  it("sets a synchronous in-flight guard around the create mutation", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/(app)/sales/orders/new/page.tsx"),
      "utf8",
    );
    expect(source).toContain("const createInFlightRef = useRef(false)");
    expect(source).toContain("if (createInFlightRef.current)");
    expect(source).toContain("createInFlightRef.current = true");
    expect(source).toContain("createInFlightRef.current = false");
  });

  it("rejects empty and non-positive draft lines before the create mutation", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/(app)/sales/orders/new/page.tsx"),
      "utf8",
    );
    expect(source).toContain("if (!draftLines.length)");
    expect(source).toContain(
      "if (draftLines.some((line) => line.qty < 1 || !Number.isFinite(line.qty)))",
    );
    expect(source).toContain('toast({ variant: "error", description: t("qtyPositive") })');
  });

  it("scopes persisted mobile order items away from the co-rendered desktop table", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "tests/e2e/authenticated/authenticated-acceptance-sales-orders.spec.ts",
      ),
      "utf8",
    );
    expect(source).toContain("const mobileOrderItemCard");
    expect(source).toContain('.locator(".md\\\\:hidden > .border-border")');
    expect(source).toContain("const persistedProductCard = mobileOrderItemCard");
  });
});
