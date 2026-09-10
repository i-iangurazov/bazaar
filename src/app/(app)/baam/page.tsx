"use client";

import { useLocale, useTranslations } from "next-intl";
import { BaamAssistant } from "@/components/baam-assistant";
import { baamCopy } from "@/lib/baam/copy";
import { PageHeader } from "@/components/page-header";

export default function BaamPage() {
  const t = useTranslations("baam");
  const locale = useLocale();
  return <div className="mx-auto min-w-0 max-w-4xl space-y-5" data-testid="baam-page" data-baam-workspace tabIndex={-1}>
    <PageHeader title={t("title")} subtitle={baamCopy(locale, "subtitle")} />
    <div className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
      <BaamAssistant />
    </div>
  </div>;
}
