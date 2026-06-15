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
    expect(appShellSource).toContain('key: "stockTransfer"');
    expect(appShellSource).toContain('href: "/inventory/transfers"');
    expect(appShellSource).toContain("icon: TransferIcon");
    expect(appShellSource).toContain('key: "stockWriteOff"');
    expect(appShellSource).toContain('href: "/inventory/write-offs"');
    expect(appShellSource).toContain("exact: true");
    expect(breadcrumbsSource).toContain('case "movements"');
    expect(breadcrumbsSource).toContain('tBreadcrumbs("productMovements")');
    expect(breadcrumbsSource).toContain('case "write-offs"');
    expect(breadcrumbsSource).toContain('tBreadcrumbs("writeOffs")');
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
    expect(serviceSource).toContain('m."storeId"');
    expect(serviceSource).toContain("encodeURIComponent(line.storeId)");
    expect(serviceSource).toContain("documentLabel: buildProductMovementDocumentLabel");
    expect(serviceSource).toContain("CustomerOrder");
    expect(serviceSource).toContain("SaleReturn");
    expect(serviceSource).toContain("PurchaseOrder");
    expect(serviceSource).toContain("StockCount");
    expect(serviceSource).toContain("WRITE_OFF");
    expect(serviceSource).toContain("parseWriteOffMovementNote");
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
    expect(pageSource).toContain('"WRITE_OFF"');
    expect(pageSource).toContain('href="/inventory/write-offs"');
    expect(pageSource).toContain('t("createWriteOff")');
    expect(pageSource).toContain("senderSearch");
    expect(pageSource).toContain("recipientSearch");
    expect(pageSource).toContain("authorSearch");
    expect(pageSource).toContain("paymentStatus");
    expect(pageSource).toContain("orderStatus");
    expect(pageSource).toContain("DataTable");
    expect(pageSource).toContain("movementColumns");
    expect(pageSource).toContain("handleMovementSortingChange");
    expect(pageSource).toContain("manualSorting");
    expect(pageSource).not.toContain("renderSortableHead");
    expect(pageSource).not.toContain("toggleTableSort");
    expect(pageSource).toContain("renderDesktop");
    expect(pageSource).toContain("renderMobile");
  });

  it("uses the Phase 1 shadcn-style dialog and data table for document editing", async () => {
    const pageSource = await readSource("src/app/(app)/inventory/movements/page.tsx");

    expect(pageSource).toContain("DialogContent");
    expect(pageSource).toContain("DialogBody");
    expect(pageSource).toContain("DialogFooter");
    expect(pageSource).toContain("SheetContent");
    expect(pageSource).toContain("SheetBody");
    expect(pageSource).toContain("SheetFooter");
    expect(pageSource).toContain("useEditSheet");
    expect(pageSource).toContain("editLineColumns");
    expect(pageSource).toContain('rowTestId="movement-edit-line"');
    expect(pageSource).toContain('data-testid="movement-edit-save"');
    expect(pageSource).not.toContain("<Modal");
    expect(pageSource).not.toContain("ModalFooter");
  });

  it("keeps Bazaar blue mapped into the shadcn-style sidebar foundation", async () => {
    const globalsSource = await readSource("src/app/globals.css");
    const tailwindSource = await readSource("tailwind.config.ts");
    const sidebarSource = await readSource("src/components/ui/sidebar.tsx");
    const appShellSource = await readSource("src/components/app-shell.tsx");
    const mobileShellSource = await readSource("src/components/mobile-app-shell.tsx");

    expect(globalsSource).toContain("--primary: 221 83% 45%");
    expect(globalsSource).toContain("--sidebar-primary: 221 83% 45%");
    expect(globalsSource).toContain("--sidebar-ring: 221 83% 45%");
    expect(tailwindSource).toContain("sidebar:");
    expect(tailwindSource).toContain('"primary-foreground"');
    expect(sidebarSource).toContain("data-[active=true]:bg-sidebar-primary/10");
    expect(sidebarSource).toContain("data-[active=true]:text-sidebar-primary");
    expect(appShellSource).toContain("<SidebarProvider");
    expect(appShellSource).toContain("<SidebarHeader");
    expect(appShellSource).toContain("<SidebarMenuButton");
    expect(appShellSource).toContain("<SidebarTrigger");
    expect(mobileShellSource).toContain("rounded-[1.65rem]");
    expect(mobileShellSource).toContain("bg-primary text-primary-foreground");
    expect(mobileShellSource).toContain("env(safe-area-inset-bottom)");
  });

  it("provides a safe fallback document detail page for movement groups", async () => {
    const pageSource = await readSource("src/app/(app)/inventory/movements/[id]/page.tsx");

    expect(pageSource).toContain("trpc.inventory.productMovementDocument.useQuery");
    expect(pageSource).toContain("decodeURIComponent");
    expect(pageSource).toContain('href="/inventory/movements"');
    expect(pageSource).toContain("document.detailUrl");
    expect(pageSource).toContain("documentActions");
    expect(pageSource).toContain("printInvoice");
    expect(pageSource).toContain('document?.documentType === "WRITE_OFF"');
    expect(pageSource).toContain("formatMovementNote");
    expect(pageSource).toContain('target="_blank"');
    expect(pageSource).toContain("/print?auto=1");
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
    expect(printPageSource).toContain('document.documentType !== "WRITE_OFF"');
    expect(printPageSource).toContain("printWriteOffTitle");
    expect(printPageSource).toContain("MovementPrintDocument");
    expect(printPageSource).toContain("MovementPrintToolbar");
    expect(printDocumentSource).toContain("@page");
    expect(printDocumentSource).toContain("size: A4");
    expect(printDocumentSource).toContain("movement-print-table thead");
    expect(printDocumentSource).toContain("break-inside: avoid");
    expect(printDocumentSource).toContain("movement-print-signature-row");
    expect(printDocumentSource).toContain("getPrintableLines");
    expect(printDocumentSource).toContain('line.movementType === "TRANSFER_OUT"');
    expect(printDocumentSource).toContain('"WOF"');
    expect(printDocumentSource).toContain("labels.writtenOffBy");
    expect(printDocumentSource).not.toContain("sort(");
    expect(printToolbarSource).toContain("window.print()");
    expect(printToolbarSource).toContain("movement-print-chrome");
  });
});
