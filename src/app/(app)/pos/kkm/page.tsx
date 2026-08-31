"use client";

import { useEffect, useRef, useState } from "react";
import { FiscalReceiptStatus } from "@prisma/client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";

import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { buildPosFilterHref, readPosEnumParam, readPosPageParam } from "@/lib/posUrlFilters";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

const kkmStatusValues = ["ALL", ...Object.values(FiscalReceiptStatus)] as const;
const kkmPageSize = 50;

const PosKkmPage = () => {
  const t = useTranslations("pos.kkm");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsString = searchParams.toString();
  const { data: session, status: sessionStatus } = useSession();
  const role = session?.user?.role;
  const canView = role === "ADMIN" || role === "MANAGER";
  const canEdit = role === "ADMIN";
  const { toast } = useToast();

  const kkmEntitlementsQuery = trpc.billing.features.useQuery(undefined, { enabled: canView });
  const kkmEnabled = kkmEntitlementsQuery.data?.featureFlags.kkm === true;
  const storesQuery = trpc.stores.list.useQuery(undefined, { enabled: canView && kkmEnabled });
  const [storeId, setStoreId] = useState(searchParams.get("store") ?? "");
  const [status, setStatus] = useState<FiscalReceiptStatus | "ALL">(
    readPosEnumParam(searchParams, "status", kkmStatusValues, "ALL"),
  );
  const [page, setPage] = useState(readPosPageParam(searchParams, "page"));
  const filterSignature = JSON.stringify([storeId, status]);
  const previousFilterSignatureRef = useRef(filterSignature);

  const receiptsQuery = trpc.pos.kkm.receipts.useQuery(
    {
      storeId: storeId || undefined,
      status: status === "ALL" ? undefined : status,
      page,
      pageSize: kkmPageSize,
    },
    { enabled: canView && kkmEnabled, refetchOnWindowFocus: true },
  );

  useEffect(() => {
    if (previousFilterSignatureRef.current === filterSignature) {
      return;
    }
    previousFilterSignatureRef.current = filterSignature;
    setPage(1);
  }, [filterSignature]);

  useEffect(() => {
    const href = buildPosFilterHref(pathname, searchParamsString, {
      store: storeId || null,
      status: status === "ALL" ? null : status,
      page: page === 1 ? null : page,
    });
    const currentHref = searchParamsString ? `${pathname}?${searchParamsString}` : pathname;
    if (href !== currentHref) router.replace(href, { scroll: false });
  }, [page, pathname, router, searchParamsString, status, storeId]);

  const total = receiptsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / kkmPageSize));

  useEffect(() => {
    if (receiptsQuery.data && page > totalPages) setPage(totalPages);
  }, [page, receiptsQuery.data, totalPages]);

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

  if (sessionStatus === "loading") {
    return (
      <div className="space-y-4">
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Spinner className="h-4 w-4" />
          {t("checkingAccess")}
        </div>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="space-y-4">
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <p className="text-sm text-danger">{tErrors("forbidden")}</p>
      </div>
    );
  }

  if (kkmEntitlementsQuery.isLoading) {
    return (
      <div className="space-y-4">
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Spinner className="h-4 w-4" />
          {t("checkingAccess")}
        </div>
      </div>
    );
  }

  if (kkmEntitlementsQuery.isError) {
    return (
      <div className="space-y-4">
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <Alert variant="destructive" role="alert" className="space-y-3">
          <div>
            <AlertTitle>{t("accessCheckFailedTitle")}</AlertTitle>
            <AlertDescription>{t("accessCheckFailedDescription")}</AlertDescription>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void kkmEntitlementsQuery.refetch()}
          >
            {tCommon("tryAgain")}
          </Button>
        </Alert>
      </div>
    );
  }

  if (!kkmEnabled) {
    return (
      <div className="space-y-4">
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <Alert variant="warning" role="status" className="space-y-3">
          <div>
            <AlertTitle>{t("planRequiredTitle")}</AlertTitle>
            <AlertDescription>
              {canEdit ? t("planRequiredAdminDescription") : t("planRequiredManagerDescription")}
            </AlertDescription>
          </div>
          {canEdit ? (
            <Button asChild variant="secondary" size="sm">
              <Link href="/billing">{t("viewPlans")}</Link>
            </Button>
          ) : null}
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {storesQuery.isError || receiptsQuery.isError ? (
        <Alert variant="destructive" role="alert" className="space-y-3">
          <div>
            <AlertTitle>
              {storesQuery.isError ? t("storesLoadFailedTitle") : t("queueLoadFailedTitle")}
            </AlertTitle>
            <AlertDescription>
              {storesQuery.isError
                ? t("storesLoadFailedDescription")
                : t("queueLoadFailedDescription")}
            </AlertDescription>
            <p className="mt-2 text-xs text-danger">
              {translateError(tErrors, storesQuery.error ?? receiptsQuery.error)}
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              if (storesQuery.isError) void storesQuery.refetch();
              if (receiptsQuery.isError) void receiptsQuery.refetch();
            }}
          >
            {tCommon("tryAgain")}
          </Button>
        </Alert>
      ) : null}

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
            <Select
              value={status}
              onValueChange={(value) => setStatus(value as FiscalReceiptStatus | "ALL")}
            >
              <SelectTrigger aria-label={t("status")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t("statusAll")}</SelectItem>
                <SelectItem value={FiscalReceiptStatus.QUEUED}>{t("statusQueued")}</SelectItem>
                <SelectItem value={FiscalReceiptStatus.PROCESSING}>
                  {t("statusProcessing")}
                </SelectItem>
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
              data-kkm-receipt
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

          {!receiptsQuery.isLoading &&
          !receiptsQuery.isError &&
          !(receiptsQuery.data?.items ?? []).length ? (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          ) : null}

          {totalPages > 1 ? (
            <div className="flex items-center justify-between gap-3 border-t border-border pt-3 text-sm text-muted-foreground">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1 || receiptsQuery.isFetching}
              >
                {tCommon("back")}
              </Button>
              <span>
                {page} / {totalPages} · {total}
              </span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={page >= totalPages || receiptsQuery.isFetching}
              >
                {tCommon("pagination.next")}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
};

export default PosKkmPage;
