import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

describe("product movement journal source", () => {
  it("adds the movement journal under inventory navigation", async () => {
    const appShellSource = await readSource("src/components/app-shell.tsx");
    const breadcrumbsSource = await readSource("src/components/page-breadcrumbs.tsx");

    expect(appShellSource).toContain('key: "productMovements"');
    expect(appShellSource).toContain('href: "/inventory/movements"');
    expect(appShellSource).toContain("icon: ProductMovementIcon");
    expect(appShellSource).toContain("exact: true");
    expect(breadcrumbsSource).toContain('case "movements"');
    expect(breadcrumbsSource).toContain('tBreadcrumbs("productMovements")');
  });

  it("normalizes stock movements into server-side document rows", async () => {
    const serviceSource = await readSource("src/server/services/productMovements.ts");
    const routerSource = await readSource("src/server/trpc/routers/inventory.ts");

    expect(routerSource).toContain("productMovements: protectedProcedure");
    expect(routerSource).toContain("productMovementDocument: protectedProcedure");
    expect(routerSource).toContain("listProductMovementJournal(ctx.prisma, ctx.user");
    expect(routerSource).toContain("getProductMovementDocument(ctx.prisma, ctx.user");
    expect(serviceSource).toContain('FROM "StockMovement" m');
    expect(serviceSource).toContain("movement_grouped AS");
    expect(serviceSource).toContain("movement_enriched AS");
    expect(serviceSource).toContain('o."name" AS "organizationName"');
    expect(serviceSource).toContain("encodeProductMovementDocumentKey");
    expect(serviceSource).toContain("getProductMovementDetailUrl");
    expect(serviceSource).toContain("documentLabel: buildProductMovementDocumentLabel");
    expect(serviceSource).toContain("CustomerOrder");
    expect(serviceSource).toContain("SaleReturn");
    expect(serviceSource).toContain("PurchaseOrder");
    expect(serviceSource).toContain("StockCount");
    expect(serviceSource).toContain("paymentStatus");
    expect(serviceSource).toContain("LIMIT ${pageSize}");
  });

  it("renders a searchable, filterable, paginated movement page", async () => {
    const pageSource = await readSource("src/app/(app)/inventory/movements/page.tsx");

    expect(pageSource).toContain("trpc.inventory.productMovements.useQuery");
    expect(pageSource).toContain("ResponsiveDataList");
    expect(pageSource).toContain('paginationKey="product-movements"');
    expect(pageSource).toContain("renderDocument");
    expect(pageSource).toContain("href={movement.detailUrl}");
    expect(pageSource).toContain("additionalFiltersOpen");
    expect(pageSource).toContain('t("additionalFilters")');
    expect(pageSource).toContain("secondaryFilterCount");
    expect(pageSource).toContain('t("dateRange")');
    expect(pageSource).toContain("dateRangeSummary");
    expect(pageSource).not.toContain('t("dateFrom")');
    expect(pageSource).not.toContain('t("dateTo")');
    expect(pageSource).toContain('href="/reports/exports"');
    expect(pageSource).toContain("renderPaymentStatus");
    expect(pageSource).toContain("renderOptionalText");
    expect(pageSource).toContain("renderMoney");
    expect(pageSource).toContain("senderSearch");
    expect(pageSource).toContain("recipientSearch");
    expect(pageSource).toContain("authorSearch");
    expect(pageSource).toContain("paymentStatus");
    expect(pageSource).toContain("orderStatus");
    expect(pageSource).toContain("renderSortableHead");
    expect(pageSource).toContain("toggleTableSort");
    expect(pageSource).toContain("sortable={false}");
    expect(pageSource).toContain("renderDesktop");
    expect(pageSource).toContain("renderMobile");
  });

  it("provides a safe fallback document detail page for movement groups", async () => {
    const pageSource = await readSource("src/app/(app)/inventory/movements/[id]/page.tsx");

    expect(pageSource).toContain("trpc.inventory.productMovementDocument.useQuery");
    expect(pageSource).toContain("decodeURIComponent");
    expect(pageSource).toContain('href="/inventory/movements"');
    expect(pageSource).toContain("document.detailUrl");
    expect(pageSource).toContain("documentActions");
    expect(pageSource).toContain("printInvoice");
    expect(pageSource).toContain('target="_blank"');
    expect(pageSource).toContain('/print?auto=1');
    expect(pageSource).toContain("document.lines");
    expect(pageSource).toContain('paginationKey="product-movement-document-lines"');
    expect(pageSource).not.toContain("window.print()");
    expect(pageSource).not.toContain("movement-print-document");
  });

  it("uses a dedicated A4 print page for receiving and transfer movement documents", async () => {
    const printPageSource = await readSource("src/app/inventory/movements/[id]/print/page.tsx");
    const printDocumentSource = await readSource(
      "src/components/inventory/movement-print-document.tsx",
    );
    const printToolbarSource = await readSource(
      "src/components/inventory/movement-print-toolbar.tsx",
    );

    expect(printPageSource).toContain("getServerAuthToken");
    expect(printPageSource).toContain("getProductMovementDocument");
    expect(printPageSource).toContain('document.documentType !== "STOCK_RECEIVING"');
    expect(printPageSource).toContain('document.documentType !== "TRANSFER"');
    expect(printPageSource).toContain("MovementPrintDocument");
    expect(printPageSource).toContain("MovementPrintToolbar");
    expect(printDocumentSource).toContain("@page");
    expect(printDocumentSource).toContain("size: A4");
    expect(printDocumentSource).toContain("movement-print-table thead");
    expect(printDocumentSource).toContain("break-inside: avoid");
    expect(printDocumentSource).toContain("movement-print-signature-row");
    expect(printDocumentSource).toContain("getPrintableLines");
    expect(printDocumentSource).toContain('line.movementType === "TRANSFER_OUT"');
    expect(printDocumentSource).not.toContain("sort(");
    expect(printToolbarSource).toContain("window.print()");
    expect(printToolbarSource).toContain("movement-print-chrome");
  });
});
