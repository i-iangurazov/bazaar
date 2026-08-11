import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const appShellSource = readSource("src/components/app-shell.tsx");
const mobileShellSource = readSource("src/components/mobile-app-shell.tsx");
const inventorySource = readSource("src/app/(app)/inventory/page.tsx");
const movementsSource = readSource("src/app/(app)/inventory/movements/page.tsx");
const countsSource = readSource("src/app/(app)/inventory/counts/page.tsx");

const prefetchDisabledCount = (source: string) =>
  source.match(/prefetch=\{false\}/g)?.length ?? 0;

describe("authenticated inventory navigation prefetch policy", () => {
  it("does not eagerly fetch every persistent desktop or mobile navigation destination", () => {
    expect(prefetchDisabledCount(appShellSource)).toBeGreaterThanOrEqual(4);
    expect(prefetchDisabledCount(mobileShellSource)).toBeGreaterThanOrEqual(5);
  });

  it("does not eagerly fetch inventory action destinations", () => {
    expect(inventorySource).toContain(
      '<Link href="/inventory/receiving" prefetch={false}>',
    );
    expect(inventorySource).toContain('<Link href="/inventory/counts" prefetch={false}>');
  });

  it("does not fan out record-level movement and count route fetches", () => {
    expect(movementsSource).toContain(
      "<Link href={withJournalReturn(movement.detailUrl)} prefetch={false}>",
    );
    expect(movementsSource).toContain("<Link href={editTarget.href} prefetch={false}>");
    expect(countsSource).toContain(
      '<Link href={`/inventory/counts/${count.id}`} prefetch={false}>',
    );
  });
});
