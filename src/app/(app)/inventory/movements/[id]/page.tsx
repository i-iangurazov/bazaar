"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { PageHeader } from "@/components/page-header";
import { ResponsiveDataList } from "@/components/responsive-data-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BackIcon, ChevronDownIcon, EmptyIcon, PrintIcon, ViewIcon } from "@/components/icons";
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
  const formatDocumentLabel = () => {
    if (!document) {
      return t("documentDetails");
    }
    return `${documentTypeLabel(document.documentType)} #${documentNumber}`;
  };
  const formatMoney = (value?: number | null) =>
    typeof value === "number" ? formatCurrencyKGS(value, locale) : tCommon("notAvailable");
  const currentDetailUrl = document
    ? `/inventory/movements/${encodeURIComponent(document.id)}`
    : "";
  const printUrl = document
    ? `/inventory/movements/${encodeURIComponent(document.id)}/print?auto=1`
    : "";

  return (
    <div>
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
            {document ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button">
                    {t("documentActions")}
                    <ChevronDownIcon className="h-4 w-4" aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[240px]">
                  <DropdownMenuLabel>{t("documentActions")}</DropdownMenuLabel>
                  <DropdownMenuItem asChild>
                    <Link href={currentDetailUrl}>
                      <ViewIcon className="h-4 w-4" aria-hidden />
                      {t("viewDetails")}
                    </Link>
                  </DropdownMenuItem>
                  {document.detailUrl && document.detailUrl !== currentDetailUrl ? (
                    <DropdownMenuItem asChild>
                      <Link href={document.detailUrl}>
                        <ViewIcon className="h-4 w-4" aria-hidden />
                        {t("openSourceDocument")}
                      </Link>
                    </DropdownMenuItem>
                  ) : null}
                  {isPrintableDocument ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem asChild>
                        <Link href={printUrl} target="_blank" rel="noreferrer">
                          <PrintIcon className="h-4 w-4" aria-hidden />
                          {t("printInvoice")}
                        </Link>
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
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
