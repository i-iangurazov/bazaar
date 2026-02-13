"use client";

import { useTranslations } from "next-intl";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const CashPage = () => {
  const t = useTranslations("quickActionsPages.cash");

  return (
    <div>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <Card>
        <CardHeader>
          <CardTitle>{t("cardTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">{t("description")}</CardContent>
      </Card>
    </div>
  );
};

export default CashPage;
