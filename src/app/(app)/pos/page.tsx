"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { formatCurrencyKGS, formatDateTime } from "@/lib/i18nFormat";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

const selectedRegisterKey = "pos:selected-register";

const createIdempotencyKey = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `pos-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const PosEntryPage = () => {
  const t = useTranslations("pos");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const { toast } = useToast();

  const [registerId, setRegisterId] = useState<string>(searchParams.get("registerId") ?? "");

  const entryQuery = trpc.pos.entry.useQuery(
    { registerId: registerId || undefined },
    { refetchOnWindowFocus: true },
  );

  const openShiftMutation = trpc.pos.shifts.open.useMutation({
    onSuccess: () => {
      toast({ variant: "success", description: t("openShiftSuccess") });
      entryQuery.refetch();
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

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
    if (registerId || !entryQuery.data?.selectedRegister?.id) {
      return;
    }
    setRegisterId(entryQuery.data.selectedRegister.id);
  }, [registerId, entryQuery.data?.selectedRegister?.id]);

  const role = session?.user?.role;
  const canManageRegisters = role === "ADMIN" || role === "MANAGER";
  const selectedRegister = useMemo(() => {
    if (!entryQuery.data?.registers?.length) {
      return null;
    }
    return entryQuery.data.registers.find((item) => item.id === registerId) ?? entryQuery.data.registers[0] ?? null;
  }, [entryQuery.data?.registers, registerId]);

  const openShift = entryQuery.data?.currentShift;

  const handleOpenShift = async () => {
    if (!selectedRegister) {
      return;
    }
    await openShiftMutation.mutateAsync({
      registerId: selectedRegister.id,
      openingCashKgs: 0,
      notes: null,
      idempotencyKey: createIdempotencyKey(),
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <Card>
        <CardHeader>
          <CardTitle>{t("entry.registerTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-foreground">{t("entry.register")}</p>
            <Select value={registerId} onValueChange={setRegisterId}>
              <SelectTrigger aria-label={t("entry.register")}>
                <SelectValue placeholder={t("entry.selectRegister")} />
              </SelectTrigger>
              <SelectContent>
                {(entryQuery.data?.registers ?? []).map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.store.name} · {item.name} ({item.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!entryQuery.isLoading && !(entryQuery.data?.registers?.length ?? 0) ? (
            <div className="rounded-md border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
              {t("entry.noRegisters")}
            </div>
          ) : null}

          {entryQuery.isLoading ? (
            <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" />
              {t("loading")}
            </div>
          ) : null}

          {selectedRegister ? (
            <div className="rounded-md border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {selectedRegister.name} ({selectedRegister.code})
                  </p>
                  <p className="text-xs text-muted-foreground">{selectedRegister.store.name}</p>
                </div>
                <Badge variant={openShift ? "success" : "warning"}>
                  {openShift ? t("entry.shiftOpen") : t("entry.shiftClosed")}
                </Badge>
              </div>

              {openShift ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-md border border-border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">{t("entry.shiftOpenedAt")}</p>
                    <p className="text-sm font-medium text-foreground">
                      {formatDateTime(openShift.openedAt, locale)}
                    </p>
                  </div>
                  <div className="rounded-md border border-border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">{t("entry.openingCash")}</p>
                    <p className="text-sm font-medium text-foreground">
                      {formatCurrencyKGS(openShift.openingCashKgs, locale)}
                    </p>
                  </div>
                  <div className="rounded-md border border-border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">{t("entry.openedBy")}</p>
                    <p className="text-sm font-medium text-foreground">{openShift.openedBy.name}</p>
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button onClick={handleOpenShift} disabled={openShiftMutation.isLoading}>
                    {openShiftMutation.isLoading ? (
                      <Spinner className="h-4 w-4" />
                    ) : null}
                    {t("entry.openShift")}
                  </Button>
                </div>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("entry.quickActionsTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Button asChild disabled={!openShift}>
            <Link href={`/pos/sell?registerId=${registerId}`}>{t("entry.sell")}</Link>
          </Button>
          <Button variant="secondary" asChild>
            <Link href={`/pos/history?registerId=${registerId}`}>{t("entry.history")}</Link>
          </Button>
          <Button variant="secondary" asChild>
            <Link href={`/pos/shifts?registerId=${registerId}`}>{t("entry.shifts")}</Link>
          </Button>
          {canManageRegisters ? (
            <Button variant="secondary" asChild>
              <Link href="/pos/registers">{t("entry.registers")}</Link>
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
};

export default PosEntryPage;
