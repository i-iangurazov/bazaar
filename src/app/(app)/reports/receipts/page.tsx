"use client";

import { useTranslations } from "next-intl";

import { ReceiptRegistry } from "@/components/pos/receipt-registry";

const ReportsReceiptsPage = () => {
  const t = useTranslations("reports.receipts");
  return <ReceiptRegistry title={t("title")} subtitle={t("subtitle")} compact />;
};

export default ReportsReceiptsPage;
