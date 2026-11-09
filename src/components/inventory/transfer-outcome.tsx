"use client";
import { useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useTransferLineContext } from "./use-transfer-line-context";
import { TransferAssortmentDialog } from "./transfer-assortment-dialog";
import { ProductStockCandidates } from "./product-stock-candidates";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QueryErrorState } from "@/components/query-error-state";
import { ResponsiveDataList } from "@/components/responsive-data-list";
import { formatNumber } from "@/lib/i18nFormat";
import { useSse } from "@/lib/useSse";
import { transferAssortmentLines } from "@/lib/transferAssortmentPreparation";

export function TransferOutcome(props: {
  fromStoreId: string;
  toStoreId: string;
  recipientName: string | null;
  lines: Array<{ productId: string; variantId: string | null }>;
}) {
  const { data: session } = useSession(),
    locale = useLocale(),
    t = useTranslations("inventory.transferSafety");
  const [connect, setConnect] = useState<string[] | null>(null);
  const manager = session?.user?.role === "ADMIN" || session?.user?.role === "MANAGER";
  const canConfigure = session?.user?.role === "ADMIN" || session?.user?.isOrgOwner;
  const lines = useMemo(() => transferAssortmentLines(props.lines).slice(0, 500), [props.lines]);
  const q = useTransferLineContext(
    { fromStoreId: props.fromStoreId, toStoreId: props.toStoreId, lines },
    Boolean(manager && lines.length),
  );
  useSse({
    "inventory.updated": q.refetch,
    "assortment.updated": q.refetch,
    "products.updated": q.refetch,
  });
  if (!manager) return null;
  const rows = q.data ?? [],
    restricted = [
      ...new Set(
        rows
          .filter((r) => r.available && r.destinationRequiresAssortment)
          .map((r) => (r.available ? r.productId : "")),
      ),
    ];
  const render = (items: typeof rows) => (
    <div className="divide-y divide-border">
      {items.map((r) => (
        <div key={r.key} className="space-y-2 py-3">
          {!r.available ? (
            <p className="text-sm text-muted-foreground">{t("historicalUnavailable")}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    className="break-words text-sm font-medium text-primary hover:underline"
                    href={`/inventory?${new URLSearchParams({ storeId: props.toStoreId, q: r.sku, stockFilter: r.destinationInAssortment ? "all" : "notInAssortment" })}`}
                  >
                    {r.productName}
                    {r.variantName ? ` · ${r.variantName}` : ""}
                  </Link>
                  <p className="text-xs text-muted-foreground">{r.sku}</p>
                </div>
                <p className="text-sm font-semibold">{formatNumber(r.destinationStock, locale)}</p>
              </div>
              <Badge variant={r.destinationInAssortment ? "success" : "warning"}>
                {t(r.destinationInAssortment ? "available" : "unavailable")}
              </Badge>
              <ProductStockCandidates
                storeId={props.toStoreId}
                candidates={r.destinationCandidates}
              />
            </>
          )}
        </div>
      ))}
    </div>
  );
  return (
    <Card data-transfer-outcome>
      <CardHeader>
        <CardTitle>{t("outcomeTitle", { store: props.recipientName ?? "" })}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{t("outcomeHint")}</p>
        {q.isError ? (
          <QueryErrorState onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <p role="status" className="text-sm">
            {t("checkingCandidates")}
          </p>
        ) : (
          <>
            {restricted.length ? (
              <div className="space-y-2 rounded-md border border-warning/30 p-3 text-sm">
                <p>
                  {t("outcomeRestricted", {
                    count: restricted.length,
                    store: props.recipientName ?? "",
                  })}
                </p>
                {canConfigure ? (
                  <Button variant="secondary" onClick={() => setConnect([...restricted])}>
                    {t("connectTitle")}
                  </Button>
                ) : (
                  <p className="text-xs">{t("adminRequired")}</p>
                )}
              </div>
            ) : null}
            <ResponsiveDataList
              items={rows}
              getKey={(r) => r.key}
              paginationKey="transfer-outcome"
              renderDesktop={render}
              renderMobile={(row) => render([row])}
            />
          </>
        )}
        {connect ? (
          <TransferAssortmentDialog
            open
            posted
            onOpenChange={(open) => {
              if (!open) setConnect(null);
            }}
            storeId={props.toStoreId}
            fromStoreId={props.fromStoreId}
            lines={props.lines.filter((line) => connect.includes(line.productId))}
            productIds={connect}
            onApplied={() => q.refetch()}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}
