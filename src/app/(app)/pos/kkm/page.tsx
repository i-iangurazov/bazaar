"use client";

import { useState } from "react";
import { FiscalReceiptStatus } from "@prisma/client";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/i18nFormat";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

const PosKkmPage = () => {
  const t = useTranslations("pos.kkm");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { data: session } = useSession();
  const role = session?.user?.role;
  const canView = role === "ADMIN" || role === "MANAGER";
  const canEdit = role === "ADMIN";
  const { toast } = useToast();

  const storesQuery = trpc.stores.list.useQuery(undefined, { enabled: canView });
  const [storeId, setStoreId] = useState("");
  const [status, setStatus] = useState<FiscalReceiptStatus | "ALL">("ALL");

  const receiptsQuery = trpc.pos.kkm.receipts.useQuery(
    {
      storeId: storeId || undefined,
      status: status === "ALL" ? undefined : status,
      page: 1,
      pageSize: 50,
    },
    { enabled: canView, refetchOnWindowFocus: true },
  );

  const statusLabel = (value: FiscalReceiptStatus) => {
    switch (value) {
      case FiscalReceiptStatus.QUEUED:
        return t("statusQueued");
      case FiscalReceiptStatus.PROCESSING:
        return t("statusProcessing");
      case FiscalReceiptStatus.SENT:
        return t("statusSent");
      case FiscalReceiptStatus.FAILED:
        return t("statusFailed");
      default:
        return value;
    }
  };

  const pairMutation = trpc.pos.kkm.createPairingCode.useMutation({
    onSuccess: async (result) => {
      try {
        await navigator.clipboard.writeText(result.code);
      } catch {
        // ignore
      }
      toast({
        variant: "success",
        description: t("pairCodeCreated", { code: result.code }),
      });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const retryMutation = trpc.pos.kkm.retryReceipt.useMutation({
    onSuccess: async () => {
      toast({ variant: "success", description: t("retryQueued") });
      await receiptsQuery.refetch();
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  if (!canView) {
    return (
      <div className="space-y-4">
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <p className="text-sm text-danger">{tErrors("forbidden")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <Card>
        <CardHeader>
          <CardTitle>{t("connectorTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Select value={storeId} onValueChange={setStoreId}>
            <SelectTrigger aria-label={t("store")}>
              <SelectValue placeholder={tCommon("selectStore")} />
            </SelectTrigger>
            <SelectContent>
              {(storesQuery.data ?? []).map((store) => (
                <SelectItem key={store.id} value={store.id}>
                  {store.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            type="button"
            onClick={() => storeId && pairMutation.mutate({ storeId })}
            disabled={!canEdit || !storeId || pairMutation.isLoading}
          >
            {pairMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
            {t("generatePairCode")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("queueTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select value={status} onValueChange={(value) => setStatus(value as FiscalReceiptStatus | "ALL")}>
              <SelectTrigger aria-label={t("status")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t("statusAll")}</SelectItem>
                <SelectItem value={FiscalReceiptStatus.QUEUED}>{t("statusQueued")}</SelectItem>
                <SelectItem value={FiscalReceiptStatus.PROCESSING}>{t("statusProcessing")}</SelectItem>
                <SelectItem value={FiscalReceiptStatus.SENT}>{t("statusSent")}</SelectItem>
                <SelectItem value={FiscalReceiptStatus.FAILED}>{t("statusFailed")}</SelectItem>
              </SelectContent>
            </Select>
            <Input value={storeId} readOnly placeholder={t("storeFilterHint")} />
          </div>

          {receiptsQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : null}

          {(receiptsQuery.data?.items ?? []).map((receipt) => (
            <div
              key={receipt.id}
              className="flex flex-col gap-3 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">
                  {receipt.customerOrder.number} · {receipt.store.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(receipt.createdAt, locale)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("status")}: {statusLabel(receipt.status)}
                </p>
                {receipt.lastError ? (
                  <p className="text-xs text-danger">{receipt.lastError}</p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {receipt.status === FiscalReceiptStatus.FAILED ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => retryMutation.mutate({ receiptId: receipt.id })}
                    disabled={retryMutation.isLoading}
                  >
                    {retryMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                    {t("retry")}
                  </Button>
                ) : null}
              </div>
            </div>
          ))}

          {!receiptsQuery.isLoading && !(receiptsQuery.data?.items ?? []).length ? (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
};

export default PosKkmPage;
