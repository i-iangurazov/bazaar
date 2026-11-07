"use client";

import { useLocale, useTranslations } from "next-intl";
import { trpc } from "@/lib/trpc";
import { formatDateTime, formatNumber } from "@/lib/i18nFormat";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { QueryErrorState } from "@/components/query-error-state";

const visible = ["ai", "images", "marketingEmails", "externalApi"] as const;
export function SubscriptionUsage() {
  const t = useTranslations("billing.usage");
  const common = useTranslations("common");
  const locale = useLocale();
  const query = trpc.billing.usage.useQuery(undefined, { staleTime: 30_000, retry: false });
  if (query.data?.every(row => row.limit === null)) return null;
  return <Card><CardHeader><CardTitle>{t("title")}</CardTitle></CardHeader><CardContent>
    {query.isLoading ? <p aria-live="polite">{common("loading")}</p> : query.isError
      ? <QueryErrorState error={query.error} onRetry={() => void query.refetch()} />
      : <><p className="mb-4 text-sm text-muted-foreground">{t("description")}</p>
        <Table><TableHeader><TableRow>
          <TableHead>{t("resource")}</TableHead><TableHead>{t("used")}</TableHead>
          <TableHead>{t("reserved")}</TableHead><TableHead>{t("remaining")}</TableHead><TableHead>{t("resets")}</TableHead>
        </TableRow></TableHeader><TableBody>{visible.map(resource => {
          const row = query.data?.find(item => item.resource === resource);
          if (!row || !row.limit) return null;
          return <TableRow key={resource}><TableCell>{t(resource)}</TableCell>
            <TableCell>{formatNumber(row.used, locale)} / {formatNumber(row.limit, locale)}</TableCell>
            <TableCell>{formatNumber(row.reserved, locale)}</TableCell>
            <TableCell>{formatNumber(row.remaining ?? 0, locale)}</TableCell>
            <TableCell>{row.resetsAt ? formatDateTime(row.resetsAt, locale) : "—"}</TableCell>
          </TableRow>;
        })}</TableBody></Table>
      </>}
  </CardContent></Card>;
}
