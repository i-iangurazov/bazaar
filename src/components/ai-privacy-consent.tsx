"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";

export function AiPrivacyConsent({ children, showStatus = false }: {
  children?: ReactNode; showStatus?: boolean;
}) {
  const t = useTranslations("accountPrivacy");
  const errors = useTranslations("errors");
  const common = useTranslations("common");
  const [declined, setDeclined] = useState(false);
  const utils = trpc.useUtils();
  const query = trpc.userSettings.aiConsent.useQuery(undefined, {
    staleTime: 0, retry: false, refetchOnWindowFocus: true,
  });
  const update = trpc.userSettings.updateAiConsent.useMutation({
    onSuccess: async (result) => {
      utils.userSettings.aiConsent.setData(undefined, result);
      setDeclined(!result.granted);
      await utils.userSettings.getMyProfile.invalidate();
    },
  });

  if (query.isLoading) return <p className="flex items-center gap-2 p-4 text-sm" role="status"><Spinner className="h-4 w-4" />{common("loading")}</p>;
  if (query.error) return <div className="space-y-2 p-4" role="alert">
    <p className="text-sm text-destructive">{translateError(errors, query.error)}</p>
    <Button variant="outline" onClick={() => void query.refetch()}>{common("tryAgain")}</Button>
  </div>;
  if (query.data?.granted && !showStatus) return <>{children}</>;

  return <section className="space-y-3 rounded-lg border border-border bg-muted/20 p-4" aria-label={t("aiTitle")}>
    <h3 className="font-semibold">{t("aiTitle")}</h3>
    <p className="text-sm leading-6 text-muted-foreground">{t("aiSharing")}</p>
    <p className="text-sm leading-6 text-muted-foreground">{t("aiChoice")}</p>
    <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
      <Link href="/privacy" target="_blank" rel="noopener noreferrer" className="min-h-8 text-primary underline">{t("privacyPolicy")}</Link>
      <a href="https://openai.com/policies/privacy-policy/" target="_blank" rel="noopener noreferrer" className="min-h-8 text-primary underline">{t("providers.openai")}</a>
      <a href="https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html" target="_blank" rel="noopener noreferrer" className="min-h-8 text-primary underline">{t("providers.deepseek")}</a>
    </div>
    {update.error ? <p role="alert" className="text-sm text-destructive">{translateError(errors, update.error)}</p> : null}
    {query.data?.granted ? <div className="flex flex-wrap items-center gap-3">
      <p role="status" className="text-sm">{t("aiGranted")}</p>
      <Button variant="outline" disabled={update.isLoading} onClick={() => update.mutate({ granted: false, version: query.data!.version })}>
        {update.isLoading ? <Spinner className="h-4 w-4" /> : null}{t("aiRevoke")}
      </Button>
    </div> : declined ? <div className="space-y-2">
      <p className="text-sm" role="status">{t("aiDeclined")}</p>
      <Button variant="outline" onClick={() => setDeclined(false)}>{t("aiReview")}</Button>
    </div> : <div className="flex flex-wrap gap-2">
      <Button disabled={update.isLoading} onClick={() => update.mutate({ granted: true, version: query.data!.version })}>
        {update.isLoading ? <Spinner className="h-4 w-4" /> : null}{t("aiAllow")}
      </Button>
      <Button variant="outline" disabled={update.isLoading} onClick={() => update.mutate({ granted: false, version: query.data!.version })}>{t("aiDecline")}</Button>
    </div>}
  </section>;
}
