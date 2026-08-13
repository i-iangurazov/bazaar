import { readFile } from "node:fs/promises";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

let pageSource = "";

beforeAll(async () => {
  pageSource = await readFile(path.join(process.cwd(), "src/app/(app)/pos/sell/page.tsx"), "utf8");
});

const sourceBetween = (start: string, end: string) => {
  const startIndex = pageSource.indexOf(start);
  const endIndex = pageSource.indexOf(end, startIndex);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return pageSource.slice(startIndex, endIndex);
};

describe("POS cart quantity and price control order", () => {
  it("renders the phone quantity stepper before the editable price control", () => {
    const lineEditor = sourceBetween(
      "const renderLineItemSheet = () =>",
      'data-testid="pos-line-remove"',
    );

    expect(lineEditor).toContain("grid-cols-[minmax(132px,0.95fr)_minmax(0,1.05fr)]");
    expect(lineEditor.indexOf('data-pos-control="quantity"')).toBeLessThan(
      lineEditor.indexOf('data-pos-control="price"'),
    );
    expect(lineEditor).toContain(
      "handleUpdateQty(activeLine.id, String(Math.max(1, activeLine.qty - 1)))",
    );
    expect(lineEditor).toContain("handleUpdateQty(activeLine.id, String(activeLine.qty + 1))");
    expect(lineEditor).toContain('data-testid="pos-line-qty"');
    expect(lineEditor).toContain('data-testid="pos-line-price"');
  });

  it("keeps both phone stepper sides at a 44px touch width", () => {
    const lineEditor = sourceBetween(
      "const renderLineItemSheet = () =>",
      'data-testid="pos-line-remove"',
    );

    expect(lineEditor.match(/min-h-\[50px\] w-11 shrink-0/g)).toHaveLength(2);
    expect(lineEditor).toContain("inline-flex min-w-[132px]");
  });

  it("places quantity first in compact checkout while preserving desktop order", () => {
    const desktopCheckout = sourceBetween(
      "const DesktopPosSaleView = () =>",
      "const MobileCustomerSheet = () =>",
    );

    expect(desktopCheckout).toContain(
      'className="order-1 inline-flex min-w-[108px] items-center overflow-hidden rounded-md border border-border bg-background lg:order-2"',
    );
    expect(desktopCheckout).toContain(
      'className="order-2 flex min-w-0 items-center gap-1.5 lg:order-1"',
    );
  });

  it("keeps the mobile fallback row quantity-first without changing handlers", () => {
    const fallback = sourceBetween(
      "const cartSheetOpen = mobileCheckoutOpen || showCompletedSale",
      "if (isPhoneScreen === null)",
    );

    expect(fallback).toContain("grid-cols-[132px_minmax(0,1fr)]");
    expect(fallback).toContain('className="order-1 inline-flex h-11 w-[132px]');
    expect(fallback).toContain('className="order-2 h-11 min-w-0 text-right"');
    expect(fallback).toContain("handleUpdateLinePrice(line.id, event.currentTarget.value)");
    expect(fallback).toContain("handleUpdateQty(line.id, event.currentTarget.value)");
  });
});
