"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { BaamAssistant } from "@/components/baam-assistant";
import { baamCopy } from "@/lib/baam/copy";
import { PageHeader } from "@/components/page-header";
import { BackIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { baamWorkspaceReturnHref } from "@/lib/baam/workspaceNavigation";
import { isIOS } from "@/lib/native/platform";

export default function BaamPage() {
  const t = useTranslations("baam");
  const common = useTranslations("common");
  const locale = useLocale();
  const search = useSearchParams();
  const [nativeIOS, setNativeIOS] = useState(false);
  useEffect(() => setNativeIOS(isIOS()), []);
  return <div className="mx-auto min-w-0 max-w-4xl space-y-5" data-testid="baam-page" data-baam-workspace tabIndex={-1}>
    <PageHeader title={t("title")} subtitle={baamCopy(locale, "subtitle")} actionClassName={nativeIOS ? "w-auto" : undefined} action={nativeIOS ? (
      <Button asChild variant="secondary" size="icon" aria-label={common("back")} title={common("back")}>
        <Link href={baamWorkspaceReturnHref(search.get("returnTo"))} replace prefetch={false}>
          <BackIcon aria-hidden />
        </Link>
      </Button>
    ) : undefined} />
    <div className="overflow-hidden rounded-lg border border-border/80 bg-card shadow-sm">
      <BaamAssistant />
    </div>
  </div>;
}
