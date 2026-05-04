"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { EmptyIcon, PrintIcon, StoresIcon } from "@/components/icons";
import { trpc } from "@/lib/trpc";

const PrintingSettingsPage = () => {
  const t = useTranslations("printingSettings");
  const tCommon = useTranslations("common");
  const storesQuery = trpc.stores.list.useQuery();

  return (
    <div>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <Card>
        <CardHeader>
          <CardTitle>{t("storesTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {storesQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : storesQuery.data?.length ? (
            <div className="divide-y divide-border border border-border">
              {storesQuery.data.map((store) => (
                <div
                  key={store.id}
                  className="flex flex-col gap-3 bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-border bg-muted/40">
                      <StoresIcon className="h-4 w-4 text-muted-foreground" aria-hidden />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {store.name}
                      </p>
                      <p className="text-xs text-muted-foreground">{t("storeHint")}</p>
                    </div>
                  </div>
                  <Button asChild className="w-full sm:w-auto">
                    <Link href={`/stores/${store.id}/hardware`}>
                      <PrintIcon className="h-4 w-4" aria-hidden />
                      {t("openStoreSettings")}
                    </Link>
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <EmptyIcon className="h-4 w-4" aria-hidden />
              {t("empty")}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default PrintingSettingsPage;
