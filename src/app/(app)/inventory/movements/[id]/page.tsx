"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { PageHeader } from "@/components/page-header";
import { ResponsiveDataList } from "@/components/responsive-data-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BackIcon, EmptyIcon, PrintIcon, ViewIcon } from "@/components/icons";
import { formatCurrencyKGS, formatDateTime, formatNumber } from "@/lib/i18nFormat";
import { getStockMovementLabel } from "@/lib/i18n/status";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

const ProductMovementDocumentPage = () => {
  const params = useParams<{ id?: string }>();
  const documentKey = typeof params?.id === "string" ? decodeURIComponent(params.id) : "";
  const t = useTranslations("inventory.movementJournal");
  const tInventory = useTranslations("inventory");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();

  const documentQuery = trpc.inventory.productMovementDocument.useQuery(
    { documentKey },
    { enabled: Boolean(documentKey) },
  );
  const document = documentQuery.data ?? null;

  const documentTypeLabel = (value: string) => t(`type.${value}`);
  const documentNumber = document?.documentNumber || document?.documentId || "";
  const isPrintableDocument =
    document?.documentType === "STOCK_RECEIVING" || document?.documentType === "TRANSFER";
  const printLines = useMemo(() => {
    if (!document) {
      return [];
    }
    if (document.documentType !== "TRANSFER") {
      return document.lines;
    }
    const outgoing = document.lines.filter((line) => line.movementType === "TRANSFER_OUT");
    return outgoing.length
      ? outgoing
      : document.lines.filter((line) => line.movementType === "TRANSFER_IN");
  }, [document]);
  const printTotals = useMemo(
    () => ({
      positions: printLines.length,
      quantity: printLines.reduce((sum, line) => sum + Math.abs(line.qtyDelta), 0),
      amount: printLines.reduce(
        (sum, line) => (typeof line.lineTotalKgs === "number" ? sum + line.lineTotalKgs : sum),
        0,
      ),
      hasAmount: printLines.some((line) => typeof line.lineTotalKgs === "number"),
    }),
    [printLines],
  );
  const formatDocumentLabel = () => {
    if (!document) {
      return t("documentDetails");
    }
    return `${documentTypeLabel(document.documentType)} #${documentNumber}`;
  };
  const formatMoney = (value?: number | null) =>
    typeof value === "number" ? formatCurrencyKGS(value, locale) : tCommon("notAvailable");
  const printTitle = document
    ? document.documentType === "TRANSFER"
      ? t("printTransferTitle")
      : document.documentType === "STOCK_RECEIVING"
        ? t("printReceivingTitle")
        : t("printDefaultTitle")
    : t("printDefaultTitle");
  const handlePrint = () => window.print();

  return (
    <div>
      <style>{`
        .movement-print-document {
          display: none;
        }

        @media print {
          @page {
            size: A4;
            margin: 12mm;
          }

          html,
          body {
            background: #fff !important;
          }

          body * {
            visibility: hidden !important;
          }

          #movement-print-document,
          #movement-print-document * {
            visibility: visible !important;
          }

          #movement-print-document {
            display: block !important;
            position: absolute;
            inset: 0 auto auto 0;
            width: 100%;
            color: #111827;
            background: #fff;
            font-family: Arial, sans-serif;
            font-size: 11px;
            line-height: 1.35;
          }

          .movement-print-document h1 {
            margin: 0;
            font-size: 20px;
            line-height: 1.2;
          }

          .movement-print-document table {
            width: 100%;
            border-collapse: collapse;
            page-break-inside: auto;
          }

          .movement-print-document thead {
            display: table-header-group;
          }

          .movement-print-document tr {
            break-inside: avoid;
            page-break-inside: avoid;
          }

          .movement-print-document th,
          .movement-print-document td {
            border: 1px solid #d1d5db;
            padding: 5px 6px;
            vertical-align: top;
          }

          .movement-print-document th {
            background: #f3f4f6;
            font-weight: 700;
            text-align: left;
          }

          .movement-print-signatures {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 18px;
            margin-top: 28px;
          }

          .movement-print-signature-line {
            border-bottom: 1px solid #111827;
            height: 28px;
            margin-bottom: 4px;
          }
        }
      `}</style>
      <PageHeader
        title={formatDocumentLabel()}
        subtitle={document ? document.comment || document.description || t("documentDetails") : undefined}
        action={
          <>
            <Button asChild variant="secondary">
              <Link href="/inventory/movements">
                <BackIcon className="h-4 w-4" aria-hidden />
                {t("backToJournal")}
              </Link>
            </Button>
            {document?.detailUrl && document.detailUrl !== `/inventory/movements/${encodeURIComponent(document.id)}` ? (
              <Button asChild>
                <Link href={document.detailUrl}>
                  <ViewIcon className="h-4 w-4" aria-hidden />
                  {t("openSourceDocument")}
                </Link>
              </Button>
            ) : null}
            {document && isPrintableDocument ? (
              <Button type="button" onClick={handlePrint}>
                <PrintIcon className="h-4 w-4" aria-hidden />
                {t("printDocument")}
              </Button>
            ) : null}
          </>
        }
      />

      {documentQuery.error ? (
        <div className="mb-4 border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {translateError(tErrors, documentQuery.error)}
        </div>
      ) : null}

      {documentQuery.isLoading ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">{tCommon("loading")}</CardContent>
        </Card>
      ) : !document ? (
        <Card>
          <CardContent className="flex min-h-[14rem] flex-col items-center justify-center p-6 text-center text-sm text-muted-foreground">
            <EmptyIcon className="mb-3 h-8 w-8" aria-hidden />
            {t("documentNotFound")}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {isPrintableDocument ? (
            <section id="movement-print-document" className="movement-print-document">
              <div className="mb-5 flex items-start justify-between gap-6">
                <div>
                  <h1>{printTitle}</h1>
                  <p className="mt-1 text-[12px] text-slate-600">
                    {t("printDocumentNumber", { number: documentNumber })}
                  </p>
                </div>
                <div className="text-right text-[11px]">
                  <p>{formatDateTime(document.createdAt, locale)}</p>
                  <p>{t("statusLabel")}: {document.status ? t(`status.${document.status}`) : tCommon("notAvailable")}</p>
                </div>
              </div>

              <div className="mb-5 grid grid-cols-2 gap-x-8 gap-y-2">
                <div>
                  <strong>{document.documentType === "TRANSFER" ? t("printSourceStore") : t("sender")}:</strong>{" "}
                  {document.senderName || tCommon("notAvailable")}
                </div>
                <div>
                  <strong>{document.documentType === "TRANSFER" ? t("printDestinationStore") : t("printReceivingStore")}:</strong>{" "}
                  {document.recipientName || document.storeName || tCommon("notAvailable")}
                </div>
                <div>
                  <strong>{t("author")}:</strong>{" "}
                  {document.authorName || document.authorEmail || tCommon("notAvailable")}
                </div>
                <div>
                  <strong>{t("comment")}:</strong> {document.comment || tCommon("notAvailable")}
                </div>
              </div>

              <table>
                <thead>
                  <tr>
                    <th className="w-8">#</th>
                    <th>{tCommon("product")}</th>
                    <th>{t("printSkuBarcode")}</th>
                    <th>{t("quantity")}</th>
                    <th>{t("printUnit")}</th>
                    <th>{t("printUnitCost")}</th>
                    <th>{t("printLineTotal")}</th>
                  </tr>
                </thead>
                <tbody>
                  {printLines.map((line, index) => (
                    <tr key={line.id}>
                      <td>{index + 1}</td>
                      <td>
                        <div>{line.productName}</div>
                        {line.variantName ? (
                          <div className="text-[10px] text-slate-600">{line.variantName}</div>
                        ) : null}
                      </td>
                      <td>
                        <div>{line.sku || tCommon("notAvailable")}</div>
                        {line.barcode ? (
                          <div className="text-[10px] text-slate-600">{line.barcode}</div>
                        ) : null}
                      </td>
                      <td className="text-right">{formatNumber(Math.abs(line.qtyDelta), locale)}</td>
                      <td>{line.unit || tCommon("notAvailable")}</td>
                      <td className="text-right">{formatMoney(line.unitCostKgs)}</td>
                      <td className="text-right">{formatMoney(line.lineTotalKgs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="mt-5 ml-auto w-[280px] space-y-1 text-[12px]">
                <div className="flex justify-between gap-4">
                  <span>{t("positions")}</span>
                  <strong>{formatNumber(printTotals.positions, locale)}</strong>
                </div>
                <div className="flex justify-between gap-4">
                  <span>{t("quantity")}</span>
                  <strong>{formatNumber(printTotals.quantity, locale)}</strong>
                </div>
                <div className="flex justify-between gap-4 border-t border-slate-300 pt-1">
                  <span>{t("amount")}</span>
                  <strong>
                    {printTotals.hasAmount ? formatMoney(printTotals.amount) : formatMoney(document.totalAmount)}
                  </strong>
                </div>
              </div>

              <div className="movement-print-signatures">
                <div>
                  <div className="movement-print-signature-line" />
                  <p>{document.documentType === "TRANSFER" ? t("printReleasedBy") : t("printShippedBy")}</p>
                </div>
                <div>
                  <div className="movement-print-signature-line" />
                  <p>{t("printReceivedBy")}</p>
                </div>
                <div>
                  <div className="movement-print-signature-line" />
                  <p>{t("printResponsible")}</p>
                </div>
              </div>
            </section>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>{t("documentSummary")}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">{t("document")}</dt>
                  <dd className="font-medium text-foreground">{formatDocumentLabel()}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("date")}</dt>
                  <dd className="font-medium text-foreground">
                    {formatDateTime(document.createdAt, locale)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("store")}</dt>
                  <dd className="font-medium text-foreground">
                    {document.storeName || tCommon("notAvailable")}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("author")}</dt>
                  <dd className="font-medium text-foreground">
                    {document.authorName || document.authorEmail || tCommon("notAvailable")}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("sender")}</dt>
                  <dd className="font-medium text-foreground">
                    {document.senderName || tCommon("notAvailable")}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("recipient")}</dt>
                  <dd className="font-medium text-foreground">
                    {document.recipientName || tCommon("notAvailable")}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("positions")}</dt>
                  <dd className="font-medium text-foreground">
                    {formatNumber(document.positionsCount, locale)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("quantity")}</dt>
                  <dd className="font-medium text-foreground">
                    {formatNumber(document.totalQuantity, locale)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("amount")}</dt>
                  <dd className="font-medium text-foreground">{formatMoney(document.totalAmount)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("paidAmount")}</dt>
                  <dd className="font-medium text-foreground">{formatMoney(document.paidAmount)}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("documentLines")}</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveDataList
                items={document.lines}
                getKey={(line) => line.id}
                paginationKey="product-movement-document-lines"
                renderDesktop={(visibleItems) => (
                  <div className="overflow-x-auto">
                    <Table className="min-w-[900px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>{tCommon("product")}</TableHead>
                          <TableHead>{t("store")}</TableHead>
                          <TableHead>{t("documentMovementType")}</TableHead>
                          <TableHead className="text-right">{t("quantity")}</TableHead>
                          <TableHead>{t("date")}</TableHead>
                          <TableHead>{t("author")}</TableHead>
                          <TableHead>{t("comment")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {visibleItems.map((line) => (
                          <TableRow key={line.id}>
                            <TableCell>
                              <div className="min-w-0">
                                <Link
                                  href={line.productDetailUrl}
                                  className="font-medium text-foreground underline-offset-2 hover:underline"
                                >
                                  {line.productName}
                                </Link>
                                {line.variantName ? (
                                  <p className="text-xs text-muted-foreground">{line.variantName}</p>
                                ) : null}
                              </div>
                            </TableCell>
                            <TableCell>{line.storeName}</TableCell>
                            <TableCell>
                              <Badge variant="default">
                                {getStockMovementLabel(tInventory, line.movementType)}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              {formatNumber(line.qtyDelta, locale)}
                            </TableCell>
                            <TableCell>{formatDateTime(line.createdAt, locale)}</TableCell>
                            <TableCell>
                              {line.authorName || line.authorEmail || tCommon("notAvailable")}
                            </TableCell>
                            <TableCell className="max-w-[18rem] truncate">
                              {line.note || tCommon("notAvailable")}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                renderMobile={(line) => (
                  <div className="rounded-md border border-border bg-card p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Link
                          href={line.productDetailUrl}
                          className="text-sm font-medium text-foreground underline-offset-2 hover:underline"
                        >
                          {line.productName}
                        </Link>
                        {line.variantName ? (
                          <p className="text-xs text-muted-foreground">{line.variantName}</p>
                        ) : null}
                      </div>
                      <Badge variant="default">
                        {getStockMovementLabel(tInventory, line.movementType)}
                      </Badge>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                      <div>
                        <p>{t("store")}</p>
                        <p className="font-medium text-foreground">{line.storeName}</p>
                      </div>
                      <div>
                        <p>{t("quantity")}</p>
                        <p className="font-medium text-foreground">
                          {formatNumber(line.qtyDelta, locale)}
                        </p>
                      </div>
                      <div>
                        <p>{t("date")}</p>
                        <p className="font-medium text-foreground">
                          {formatDateTime(line.createdAt, locale)}
                        </p>
                      </div>
                      <div>
                        <p>{t("author")}</p>
                        <p className="font-medium text-foreground">
                          {line.authorName || line.authorEmail || tCommon("notAvailable")}
                        </p>
                      </div>
                    </div>
                    {line.note ? (
                      <p className="mt-3 text-xs text-muted-foreground">{line.note}</p>
                    ) : null}
                  </div>
                )}
              />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default ProductMovementDocumentPage;
