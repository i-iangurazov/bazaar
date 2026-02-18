"use client";

import { useTranslations } from "next-intl";

import { ReceiptRegistry } from "@/components/pos/receipt-registry";

const PosReceiptsPage = () => {
  const t = useTranslations("pos.receipts");
  return <ReceiptRegistry title={t("title")} subtitle={t("subtitle")} />;
};

export default PosReceiptsPage;
