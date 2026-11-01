"use client";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { formatNumber } from "@/lib/i18nFormat";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";

export function ProductStockCandidates({
  candidates,
  storeId,
}: {
  storeId: string;
  candidates: Array<{
    id: string;
    sku: string;
    unit: string;
    onHand: number;
    inAssortment: boolean;
  }>;
}) {
  const t = useTranslations("inventory.transferSafety"),
    locale = useLocale();
  if (!candidates.length) return null;
  return (
    <div className="min-w-0 space-y-1 text-xs text-warning" data-stock-identity-warning>
      <p>{t("candidatesHint")}</p>
      <ul className="space-y-1">
        {candidates.map((c) => (
          <li key={c.id} className="break-words">
            <Link
              target="_blank"
              className="underline underline-offset-2"
              href={`/inventory?${new URLSearchParams({ storeId, q: c.sku, stockFilter: c.inAssortment ? "all" : "notInAssortment" })}`}
            >
              {c.sku} · {formatNumber(c.onHand, locale)} {c.unit}
            </Link>
            {!c.inAssortment ? ` · ${t("unavailable")}` : null}
          </li>
        ))}
      </ul>
      <p>{t("candidatesNoMerge")}</p>
    </div>
  );
}

/** Loaded only while a stock cell is edited. Advice never changes the absolute correction contract. */
export function StockIdentityNotice({
  storeId,
  productId,
}: {
  storeId: string;
  productId: string;
}) {
  const t = useTranslations("inventory.transferSafety");
  const q = trpc.inventory.productStockIdentity.useQuery(
    { storeId, productId },
    { staleTime: 0, retry: 1 },
  );
  if (q.isLoading)
    return (
      <p role="status" className="text-xs text-muted-foreground">
        {t("checkingCandidates")}
      </p>
    );
  if (q.isError)
    return (
      <div className="text-xs text-warning">
        {t("candidatesCheckFailed")}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void q.refetch()}
        >
          {t("check")}
        </Button>
      </div>
    );
  return (
    <ProductStockCandidates
      storeId={storeId}
      candidates={(q.data ?? []).filter((c) => c.onHand !== 0)}
    />
  );
}
