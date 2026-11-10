"use client";

import { useLocale, useTranslations } from "next-intl";
import { trpc } from "@/lib/trpc";
import { formatDateTime, formatNumber } from "@/lib/i18nFormat";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { QueryErrorState } from "@/components/query-error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const visible = ["ai", "images", "marketingEmails", "externalApi"] as const;
export function SubscriptionUsage({ trial = false }: { trial?: boolean }) {
  const t = useTranslations("billing.usage");
  const common = useTranslations("common");
  const locale = useLocale();
  const query = trpc.billing.usage.useQuery(undefined, { staleTime: 30_000, retry: false });
  if (query.data?.every((row) => row.limit === null)) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <p aria-live="polite">{common("loading")}</p>
        ) : query.isError ? (
          <QueryErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <>
            <p className="mb-4 text-sm text-muted-foreground">
              {t(trial ? "trialDescription" : "description")}
            </p>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("resource")}</TableHead>
                    <TableHead>{t("used")}</TableHead>
                    <TableHead>{t("reserved")}</TableHead>
                    <TableHead>{t("remaining")}</TableHead>
                    <TableHead>{t("resets")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((resource) => {
                    const row = query.data?.find((item) => item.resource === resource);
                    if (!row || row.limit === null) return null;
                    return (
                      <TableRow key={resource}>
                        <TableCell>{t(resource)}</TableCell>
                        <TableCell>
                          {row.limit === 0 ? (
                            <Badge variant="muted">{t("notIncluded")}</Badge>
                          ) : (
                            `${formatNumber(row.used, locale)} / ${formatNumber(row.limit, locale)}`
                          )}
                        </TableCell>
                        <TableCell>{formatNumber(row.reserved, locale)}</TableCell>
                        <TableCell>{formatNumber(row.remaining ?? 0, locale)}</TableCell>
                        <TableCell>
                          {row.limit === 0 || !row.resetsAt
                            ? "—"
                            : new Date(row.resetsAt).getTime() <= Date.now()
                              ? t("periodEnded")
                              : formatDateTime(row.resetsAt, locale)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {query.data?.some(
              (row) => visible.some((resource) => resource === row.resource) && row.limit === 0,
            ) ? (
              <div className="mt-4">
                <Button asChild variant="secondary">
                  <a href="#plans">{t("viewPlans")}</a>
                </Button>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
