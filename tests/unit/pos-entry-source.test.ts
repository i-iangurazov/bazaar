import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

describe("pos entry navigation", () => {
  it("does not auto-redirect away from the POS hub when a shift is already open", async () => {
    const source = await readSource("src/app/(app)/pos/page.tsx");

    expect(source).toContain("router.push(`/pos/sell?registerId=${shift.registerId}`)");
    expect(source).not.toContain("router.replace(`/pos/sell?registerId=${selectedRegister.id}`)");
    expect(source).not.toContain("router.replace(`/pos/sell?registerId=");
    expect(source).toContain('t("entry.readyToSell")');
  });

  it("shows a scoped close-shift path from the open-shift POS hub", async () => {
    const source = await readSource("src/app/(app)/pos/page.tsx");

    expect(source).toContain("const activeRegisterId =");
    expect(source).toContain("href={`/pos/shifts?registerId=${activeRegisterId}`}");
    expect(source).toContain('t("shifts.closeShift")');
    expect(source).toContain("{!openShift ? (");
  });

  it("requires a closing note in the shift UI when counted cash does not match expected cash", async () => {
    const source = await readSource("src/app/(app)/pos/shifts/page.tsx");

    expect(source).toContain("const closeNoteRequired =");
    expect(source).toContain("Math.abs(cashDifference) > 0.009");
    expect(source).toContain('t("shifts.differenceNoteRequired")');
    expect(source).toContain("!closeNoteValid");
  });

  it("keeps the cashier POS screen on theme tokens for dark mode support", async () => {
    const source = await readSource("src/app/(app)/pos/sell/page.tsx");

    expect(source).toContain("bg-card");
    expect(source).toContain("bg-muted/40");
    expect(source).toContain("text-success-foreground");
    expect(source).toContain("dark:hover:bg-accent/40");
    expect(source).not.toContain("bg-white");
    expect(source).not.toContain("bg-slate-50");
    expect(source).not.toContain("border-slate-200");
    expect(source).not.toContain("bg-[#fffdf4]");
    expect(source).not.toContain("bg-emerald-");
    expect(source).not.toContain("text-emerald-");
  });

  it("does not block adding out-of-stock products to a POS sale", async () => {
    const source = await readSource("src/app/(app)/pos/sell/page.tsx");

    expect(source).toContain("const productBlocked = priceMissing;");
    expect(source).not.toContain("stockBlocked");
    expect(source).not.toContain('t("sell.insufficientStock")');
  });

  it("lets cashiers edit POS sale line unit prices inline", async () => {
    const pageSource = await readSource("src/app/(app)/pos/sell/page.tsx");
    const routerSource = await readSource("src/server/trpc/routers/pos.ts");
    const serviceSource = await readSource("src/server/services/pos.ts");

    expect(pageSource).toContain("handleUpdateLinePrice");
    expect(pageSource).toContain("formatSaleMoneyDraft(line.unitPriceKgs)");
    expect(pageSource).toContain("await updateLineMutation.mutateAsync({ lineId, unitPriceKgs })");
    expect(routerSource).toContain("unitPriceKgs: z.number().min(0).optional()");
    expect(serviceSource).toContain("unitPriceKgs: nextUnitPriceKgs");
    expect(serviceSource).toContain("lineTotalKgs: roundMoney(nextUnitPriceKgs * nextQty)");
  });
});
