import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

describe("mobile sales and receipts source", () => {
  it("adds a mobile-only POS sales card/detail flow without removing desktop receipt actions", async () => {
    const source = await readSource("src/app/(app)/pos/history/page.tsx");

    expect(source).toContain('className="space-y-4 md:hidden"');
    expect(source).toContain('className="hidden space-y-6 md:block"');
    expect(source).toContain("visibleSales.map((sale)");
    expect(source).toContain("setDetailSaleId(sale.id)");
    expect(source).toContain("mobileSaleDetailQuery");
    expect(source).toContain("handleShareReceiptPdf");
    expect(source).toContain('t("history.shareReceipt")');
    expect(source).toContain('void handleReceiptPdf(sale.id, "print", "precheck")');
    expect(source).toContain('void handleReceiptPdf(sale.id, "download", "precheck")');
    expect(source).toContain('void handleReceiptPdf(sale.id, "download", "fiscal")');
  });

  it("keeps receipt registry desktop table and adds mobile share receipt action", async () => {
    const source = await readSource("src/components/pos/receipt-registry.tsx");

    expect(source).toContain("renderDesktop={(items) => (");
    expect(source).toContain('<Table className="min-w-[1120px]" sortable={false}>');
    expect(source).toContain('className="sticky right-0 z-10 w-[340px]');
    expect(source).toContain("renderMobile={(item) => (");
    expect(source).toContain('t("previewShort")');
    expect(source).toContain("handleShareReceiptPdf");
    expect(source).toContain('t("shareShort")');
    expect(source).toContain('tPos("history.shareReceipt")');
  });

  it("keeps sales orders desktop table while using mobile filters and cards", async () => {
    const source = await readSource("src/app/(app)/sales/orders/page.tsx");

    expect(source).toContain('className="bazaar-admin-toolbar space-y-3 md:hidden"');
    expect(source).toContain(
      'className="bazaar-admin-toolbar hidden grid-cols-1 gap-3 md:grid md:grid-cols-4"',
    );
    expect(source).toContain("setMobileFiltersOpen(true)");
    expect(source).toContain("renderMobile={(order) => (");
    expect(source).toContain('<Table className="min-w-[980px]" data-tour="sales-orders-table">');
    expect(source).toContain('<TableHead>{t("customerAddress")}</TableHead>');
  });
});
