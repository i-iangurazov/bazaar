"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function ProductBarcodeConflict({
  match,
  selected,
  disabled,
  showSku,
  onToggle,
}: {
  match: {
    id: string;
    name: string;
    sku: string;
    barcode: string;
    isDeleted: boolean;
    canAccess: boolean;
    canTransfer: boolean;
    stores: Array<{ id: string; name: string }>;
  };
  selected: boolean;
  disabled: boolean;
  showSku: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations("products");
  const archiveParams = new URLSearchParams({
    list: "1",
    archived: "true",
    q: match.barcode,
    category: "",
    type: "all",
    readiness: "all",
    page: "1",
  });
  if (match.stores[0]) archiveParams.set("storeId", match.stores[0].id);
  return (
    <div
      className="space-y-2 rounded-md border border-warning/30 bg-warning/10 p-3"
      data-barcode-conflict={match.barcode}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="muted" className="break-all">
          {match.barcode}
        </Badge>
        <span className="min-w-0 max-w-full text-sm font-medium text-foreground [overflow-wrap:anywhere]">
          {match.name}
        </span>
        {showSku ? <span className="text-xs text-muted-foreground">{match.sku}</span> : null}
        {match.isDeleted ? <Badge variant="muted">{t("archived")}</Badge> : null}
      </div>
      {match.stores.length ? (
        <p className="text-xs text-muted-foreground">
          {match.stores.map((s) => s.name).join(", ")}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {t(
          match.isDeleted
            ? "barcodeArchivedHint"
            : match.canAccess
              ? "barcodeActiveHint"
              : "barcodeActiveAccessHint",
        )}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {match.canAccess && (!match.isDeleted || match.stores.length > 0) ? (
          <Link
            href={match.isDeleted ? `/products?${archiveParams}` : `/products/${match.id}`}
            target="_blank"
            className="text-xs text-primary underline-offset-4 hover:underline"
          >
            {t(match.isDeleted ? "barcodeShowArchived" : "duplicateOpenProduct")}
          </Link>
        ) : null}
        {match.canTransfer ? (
          <Button
            type="button"
            size="sm"
            variant={selected ? "secondary" : "outline"}
            aria-pressed={selected}
            disabled={disabled}
            onClick={onToggle}
          >
            {t(selected ? "barcodeCancelTransfer" : "barcodeTransfer")}
          </Button>
        ) : null}
      </div>
      {selected ? (
        <p className="text-xs font-medium text-foreground" role="status">
          {t("barcodeTransferHint")}
        </p>
      ) : null}
      {match.isDeleted && !match.canTransfer ? (
        <p className="text-xs text-muted-foreground">{t("barcodeTransferAccessHint")}</p>
      ) : null}
    </div>
  );
}
