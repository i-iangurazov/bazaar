"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { currencySourceWithFallback, formatKgsMoney } from "@/lib/currencyDisplay";
import { formatDateTime } from "@/lib/i18nFormat";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { useSse } from "@/lib/useSse";

const selectedRegisterKey = "pos:selected-register";
const pageSize = 30;

const createIdempotencyKey = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `pos-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const PosDebtsPage = () => {
  const t = useTranslations("pos");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const [registerId, setRegisterId] = useState(searchParams.get("registerId") ?? "");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const normalizedSearch = deferredSearch.trim().replace(/\s+/g, " ");

  const registersQuery = trpc.pos.registers.list.useQuery();
  const selectedRegister = useMemo(
    () => (registersQuery.data ?? []).find((item) => item.id === registerId) ?? null,
    [registerId, registersQuery.data],
  );
  const registerExists = (registersQuery.data ?? []).some((item) => item.id === registerId);
  const canLoadRegisterScopedData = Boolean(registerId) && registerExists;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (registerId) {
      window.localStorage.setItem(selectedRegisterKey, registerId);
      return;
    }
    const saved = window.localStorage.getItem(selectedRegisterKey);
    if (saved) {
      setRegisterId(saved);
    }
  }, [registerId]);

  useEffect(() => {
    if (registerId || !registersQuery.data?.[0]) {
      return;
    }
    setRegisterId(registersQuery.data[0].id);
  }, [registerId, registersQuery.data]);

  useEffect(() => {
    if (!registerId || !registersQuery.data?.length) {
      return;
    }
    if (registerExists) {
      return;
    }
    setRegisterId("");
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(selectedRegisterKey);
    }
  }, [registerExists, registerId, registersQuery.data]);

  useEffect(() => {
    setPage(1);
  }, [normalizedSearch, selectedRegister?.store.id]);

  const currentShiftQuery = trpc.pos.shifts.current.useQuery(
    { registerId },
    { enabled: canLoadRegisterScopedData, refetchOnWindowFocus: true },
  );

  const debtsQuery = trpc.pos.debts.list.useQuery(
    {
      storeId: selectedRegister?.store.id,
      search: normalizedSearch || undefined,
      page,
      pageSize,
    },
    {
      enabled: Boolean(selectedRegister?.store.id),
      keepPreviousData: true,
      refetchOnWindowFocus: true,
    },
  );

  const settleDebtMutation = trpc.pos.debts.settle.useMutation({
    onSuccess: async () => {
      toast({ variant: "success", description: t("debts.settleSuccess") });
      await Promise.all([debtsQuery.refetch(), currentShiftQuery.refetch()]);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  useSse({
    "sale.completed": () => {
      void debtsQuery.refetch();
    },
    "debt.settled": () => {
      void Promise.all([debtsQuery.refetch(), currentShiftQuery.refetch()]);
    },
    "shift.opened": () => {
      void currentShiftQuery.refetch();
    },
    "shift.closed": () => {
      void currentShiftQuery.refetch();
    },
  });

  const currentShift = currentShiftQuery.data;
  const debts = debtsQuery.data?.items ?? [];
  const total = debtsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const selectedRegisterCurrencySource = selectedRegister?.store ?? null;

  const handleSettleDebt = async (saleId: string) => {
    if (!registerId || !currentShift) {
      toast({ variant: "error", description: t("debts.openShiftRequired") });
      return;
    }
    await settleDebtMutation.mutateAsync({
      saleId,
      registerId,
      idempotencyKey: createIdempotencyKey(),
    });
  };

  const formatDebtMoney = (debt: (typeof debts)[number]) =>
    formatKgsMoney(
      debt.totalKgs,
      locale,
      currencySourceWithFallback(debt, debt.store ?? selectedRegisterCurrencySource),
    );

  const summarizeDebtLines = (debt: (typeof debts)[number]) => {
    const lineSummary = debt.lines
      .slice(0, 3)
      .map((line) => `${line.product.name} × ${line.qty}`)
      .join(", ");
    const extraCount = Math.max(0, debt.lines.length - 3);
    return `${lineSummary}${extraCount > 0 ? `, ${t("debts.moreItems", { count: extraCount })}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t("debts.title")} subtitle={t("debts.subtitle")} />

      <Card>
        <CardHeader>
          <CardTitle>{t("entry.register")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <Select value={registerId} onValueChange={setRegisterId}>
              <SelectTrigger className="w-full md:max-w-md" aria-label={t("entry.register")}>
                <SelectValue placeholder={t("entry.selectRegister")} />
              </SelectTrigger>
              <SelectContent>
                {(registersQuery.data ?? []).map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.store.name} · {item.name} ({item.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="secondary" asChild>
                <Link href={`/pos?registerId=${registerId}`}>{t("title")}</Link>
              </Button>
              <Button variant="secondary" asChild>
                <Link href={`/pos/history?registerId=${registerId}`}>{t("entry.history")}</Link>
              </Button>
              <Button asChild>
                <Link href={`/pos/sell?registerId=${registerId}`}>{t("entry.sell")}</Link>
              </Button>
            </div>
          </div>
          {!currentShift && canLoadRegisterScopedData ? (
            <p className="text-sm text-muted-foreground">{t("debts.openShiftRequired")}</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>{t("debts.tableTitle")}</CardTitle>
            {debtsQuery.isFetching ? <Spinner className="h-4 w-4" /> : null}
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 max-w-md">
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("debts.searchPlaceholder")}
              aria-label={t("debts.searchPlaceholder")}
            />
          </div>

          {!debtsQuery.isLoading && debts.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("debts.empty")}</p>
          ) : null}

          {debts.length > 0 ? (
            <div className="overflow-x-auto border border-border">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-3 text-left font-medium">{t("debts.customer")}</th>
                    <th className="px-3 py-3 text-left font-medium">{t("debts.sale")}</th>
                    <th className="px-3 py-3 text-left font-medium">{t("debts.items")}</th>
                    <th className="px-3 py-3 text-left font-medium">{t("debts.store")}</th>
                    <th className="px-3 py-3 text-right font-medium">{t("debts.amount")}</th>
                    <th className="px-3 py-3 text-right font-medium">{t("debts.action")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-card">
                  {debts.map((debt) => (
                    <tr key={debt.id} className="align-top">
                      <td className="px-3 py-3">
                        <p className="font-medium text-foreground">
                          {debt.debtCustomerName ??
                            debt.customerName ??
                            t("debts.unknownCustomer")}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <p className="font-medium text-foreground">{debt.number}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDateTime(debt.completedAt ?? debt.createdAt, locale)}
                        </p>
                      </td>
                      <td className="max-w-[360px] px-3 py-3 text-muted-foreground">
                        {summarizeDebtLines(debt)}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        <p>{debt.store.name}</p>
                        <p className="text-xs">
                          {debt.register
                            ? `${debt.register.name} (${debt.register.code})`
                            : tCommon("notAvailable")}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-semibold text-foreground">
                        {formatDebtMoney(debt)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => void handleSettleDebt(debt.id)}
                          disabled={!currentShift || settleDebtMutation.isLoading}
                        >
                          {settleDebtMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                          {t("debts.returnedDebt")}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {total > pageSize ? (
            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {t("debts.pagination", { page, totalPages, total })}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                  disabled={page <= 1}
                >
                  {tCommon("pagination.previous")}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                  disabled={page >= totalPages}
                >
                  {tCommon("pagination.next")}
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
};

export default PosDebtsPage;
