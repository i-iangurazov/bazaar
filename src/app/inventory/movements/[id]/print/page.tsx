import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import {
  getMovementPrintDocumentNumber,
  MovementPrintDocument,
  type MovementPrintDocumentLabels,
} from "@/components/inventory/movement-print-document";
import { MovementPrintToolbar } from "@/components/inventory/movement-print-toolbar";
import { prisma } from "@/server/db/prisma";
import { getServerAuthToken } from "@/server/auth/token";
import { getProductMovementDocument } from "@/server/services/productMovements";

type PageProps = {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
};

const safeDecodeURIComponent = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const getSearchParam = (searchParams: PageProps["searchParams"], key: string) => {
  const value = searchParams?.[key];
  return Array.isArray(value) ? value[0] : value;
};

const MovementPrintPage = async ({ params, searchParams }: PageProps) => {
  const token = await getServerAuthToken();
  if (!token?.sub || !token.organizationId) {
    redirect("/login");
  }

  const documentKey = safeDecodeURIComponent(params.id);
  const document = await getProductMovementDocument(
    prisma,
    {
      id: token.sub,
      organizationId: String(token.organizationId),
      role: String(token.role ?? "STAFF"),
      isOrgOwner: Boolean((token as { isOrgOwner?: boolean | null }).isOrgOwner),
      isPlatformOwner: Boolean((token as { isPlatformOwner?: boolean | null }).isPlatformOwner),
    },
    documentKey,
  );

  if (
    !document ||
    (document.documentType !== "STOCK_RECEIVING" &&
      document.documentType !== "RECEIVE" &&
      document.documentType !== "TRANSFER" &&
      document.documentType !== "WRITE_OFF")
  ) {
    notFound();
  }

  const [locale, t, tCommon] = await Promise.all([
    getLocale(),
    getTranslations("inventory.movementJournal"),
    getTranslations("common"),
  ]);
  const title =
    document.documentType === "TRANSFER"
      ? t("printTransferTitle")
      : document.documentType === "WRITE_OFF"
        ? t("printWriteOffTitle")
        : t("printReceivingTitle");
  const labels: MovementPrintDocumentLabels = {
    companyFallback: "Bazaar",
    documentNumber: t("printDocumentNumber", {
      number: getMovementPrintDocumentNumber(document),
    }),
    date: t("date"),
    status: t("statusLabel"),
    sourceStore: t("printSourceStore"),
    destinationStore: t("printDestinationStore"),
    receivingStore: t("printReceivingStore"),
    writeOffStore: t("printWriteOffStore"),
    sender: t("sender"),
    author: t("author"),
    reason: t("reason"),
    comment: t("comment"),
    product: tCommon("product"),
    skuBarcode: t("printSkuBarcode"),
    unit: t("printUnit"),
    quantity: t("quantity"),
    unitCost: t("printUnitCost"),
    lineTotal: t("printLineTotal"),
    positions: t("positions"),
    amount: t("amount"),
    technicalReference: t("printTechnicalReference"),
    costNotSpecified: t("printCostNotSpecified"),
    shippedBy: t("printShippedBy"),
    releasedBy: t("printReleasedBy"),
    writtenOffBy: t("printWrittenOffBy"),
    receivedBy: t("printReceivedBy"),
    checkedBy: t("printCheckedBy"),
    responsible: t("printResponsible"),
    signatureDate: t("printSignatureDate"),
    notAvailable: tCommon("notAvailable"),
    statusLabel: document.status ? t(`status.${document.status}`) : tCommon("notAvailable"),
    title,
  };
  const detailHref = `/inventory/movements/${encodeURIComponent(document.id)}`;

  return (
    <main className="movement-print-page min-h-screen bg-slate-100 py-1 print:bg-white">
      <MovementPrintToolbar
        autoPrint={getSearchParam(searchParams, "auto") === "1"}
        backHref={detailHref}
        labels={{
          backToDetails: t("backToDetails"),
          printDocument: t("printInvoice"),
          printHint: t("printPageHint"),
        }}
      />
      <MovementPrintDocument document={document} labels={labels} locale={locale} />
    </main>
  );
};

export default MovementPrintPage;
