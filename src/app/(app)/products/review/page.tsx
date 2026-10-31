"use client";
import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { trpc } from "@/lib/trpc";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { formatDateTime } from "@/lib/i18nFormat";
import { PageHeader } from "@/components/page-header";
import { SearchInput } from "@/components/search-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { QueryErrorState } from "@/components/query-error-state";
import { BackIcon } from "@/components/icons";

export default function ProductReviewPage() {
  const t = useTranslations("productReview"),
    common = useTranslations("common"),
    locale = useLocale();
  const [page, setPage] = useState(1),
    [search, setSearch] = useState("");
  const query = useDebouncedValue(search, 250);
  const result = trpc.products.duplicateReview.useQuery({ page, search: query || undefined });
  return (
    <div className="space-y-5">
      <PageHeader
        title={t("title")}
        subtitle={t("hint")}
        action={
          <Button asChild variant="secondary">
            <Link href="/products">
              <BackIcon className="h-4 w-4" aria-hidden />
              {common("back")}
            </Link>
          </Button>
        }
      />
      <p className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">{t("safety")}</p>
      <SearchInput
        value={search}
        onValueChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        placeholder={t("search")}
        aria-label={t("search")}
      />
      {result.isLoading ? (
        <div role="status" className="flex gap-2">
          <Spinner />
          {common("loading")}
        </div>
      ) : result.error ? (
        <QueryErrorState onRetry={() => void result.refetch()} />
      ) : !result.data?.groups.length ? (
        <p>{t("empty")}</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {t("total", { count: result.data.total })}
          </p>
          {result.data.groups.map((group) => (
            <Card key={group.normalized}>
              <CardHeader>
                <CardTitle>
                  {group.products[0]?.name ?? group.normalized}{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    · {t("cards", { count: group.cards })}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                {group.products.map((p) => (
                  <div key={p.id} className="space-y-2 rounded-md border border-border p-3 text-sm">
                    <Link
                      href={`/products/${encodeURIComponent(p.id)}`}
                      target="_blank"
                      className="font-medium text-primary underline"
                    >
                      {p.name} · {p.sku}
                    </Link>
                    <p>
                      {t("unit")}: {p.unit} · {t("variants", { count: p._count.variants })}
                    </p>
                    <p className="break-all">
                      {t("barcodes")}:{" "}
                      {p.barcodes.map((b) => b.value).join(", ") || common("notAvailable")}
                    </p>
                    <p>
                      {t("ownStores")}:{" "}
                      {p.storeProducts
                        .filter((a) => a.isDirect)
                        .map((a) => a.store.name)
                        .join(", ") || common("notAvailable")}
                    </p>
                    <p>
                      {t("visibleStores")}:{" "}
                      {p.storeProducts
                        .filter((a) => a.isActive && !a.isHidden)
                        .map((a) => a.store.name)
                        .join(", ") || common("notAvailable")}
                    </p>
                    <p>
                      {t("stockStores")}: {p.stockStores.join(", ") || common("notAvailable")}
                    </p>
                    <p>
                      {t("history", {
                        movements: p._count.stockMovements,
                        purchases: p._count.purchaseOrderLines,
                        orders: p._count.customerOrderLines,
                      })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(p.createdAt, locale)}
                    </p>
                  </div>
                ))}
                {group.products.length < group.cards ? (
                  <p className="text-sm text-warning">{t("limited")}</p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="secondary"
          disabled={page === 1 || result.isFetching}
          onClick={() => setPage(page - 1)}
        >
          {t("previous")}
        </Button>
        <span className="text-sm">{page}</span>
        <Button
          variant="secondary"
          disabled={result.isFetching || !result.data || page * 10 >= result.data.total}
          onClick={() => setPage(page + 1)}
        >
          {t("next")}
        </Button>
      </div>
    </div>
  );
}
