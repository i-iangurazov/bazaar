"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal, ModalFooter } from "@/components/ui/modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import {
  currencySourceWithFallback,
  displayMoneyToKgs,
  formatKgsMoney,
} from "@/lib/currencyDisplay";
import { formatDateTime } from "@/lib/i18nFormat";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { useSse } from "@/lib/useSse";

const selectedRegisterKey = "pos:selected-register";

const createIdempotencyKey = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `pos-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const PosEntryPage = () => {
  const t = useTranslations("pos");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const { toast } = useToast();

  const [registerId, setRegisterId] = useState<string>(searchParams.get("registerId") ?? "");
  const [openShiftDialogOpen, setOpenShiftDialogOpen] = useState(false);
  const [openingCash, setOpeningCash] = useState("");
  const [openingNote, setOpeningNote] = useState("");

  const entryQuery = trpc.pos.entry.useQuery(
    { registerId: registerId || undefined },
    { refetchOnWindowFocus: true },
  );

  const openShiftMutation = trpc.pos.shifts.open.useMutation({
    onSuccess: (shift) => {
      setOpenShiftDialogOpen(false);
      setOpeningCash("");
      setOpeningNote("");
      toast({ variant: "success", description: t("openShiftSuccess") });
      void entryQuery.refetch();
      router.push(`/pos/sell?registerId=${shift.registerId}`);
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
    return (
      entryQuery.data.registers.find((item) => item.id === registerId) ??
      entryQuery.data.registers[0] ??
      null
    );
  }, [entryQuery.data?.registers, registerId]);

  const openShift = entryQuery.data?.currentShift;
  const previousClosedShift = entryQuery.data?.previousClosedShift ?? null;
  const activeRegisterId = openShift?.registerId ?? selectedRegister?.id ?? registerId;
  const formatStoreMoney = (amountKgs: number | string) =>
    formatKgsMoney(
      Number(amountKgs),
      locale,
      currencySourceWithFallback(openShift, selectedRegister?.store ?? null),
    );
  const formatPreviousShiftMoney = (amountKgs: number | string) =>
    formatKgsMoney(
      Number(amountKgs),
      locale,
      currencySourceWithFallback(
        previousClosedShift?.store ?? null,
        selectedRegister?.store ?? null,
      ),
    );

  useSse({
    "shift.opened": () => {
      void entryQuery.refetch();
    },
    "shift.closed": () => {
      void entryQuery.refetch();
    },
    "debt.settled": () => {
      void entryQuery.refetch();
    },
  });

  const handleOpenShift = async () => {
    if (!selectedRegister) {
      return;
    }
    const amount = Number(openingCash || "0");
    const amountKgs = displayMoneyToKgs(amount, selectedRegister.store);
    if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(amountKgs)) {
      toast({ variant: "error", description: t("entry.openingCashInvalid") });
      return;
    }
    await openShiftMutation.mutateAsync({
      registerId: selectedRegister.id,
      openingCashKgs: amountKgs,
      notes: openingNote.trim() || null,
      idempotencyKey: createIdempotencyKey(),
    });
  };

  return (
    <div className="space-y-6">
      <div className="hidden md:block">
        <PageHeader title={t("title")} subtitle={t("cashierSubtitle")} />
      </div>

      <section className="space-y-4 md:hidden">
        <div className="rounded-md border border-border bg-card p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Badge variant={openShift ? "success" : "warning"}>
                {openShift ? t("entry.shiftOpen") : t("entry.shiftClosed")}
              </Badge>
              <h2 className="mt-3 text-xl font-semibold text-foreground">
                {openShift ? t("entry.readyToSell") : t("entry.openShiftTitle")}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {selectedRegister
                  ? `${selectedRegister.store.name} · ${selectedRegister.name} (${selectedRegister.code})`
                  : t("entry.selectRegister")}
              </p>
            </div>
            {entryQuery.isLoading ? <Spinner className="mt-1 h-5 w-5 text-muted-foreground" /> : null}
          </div>

          {(entryQuery.data?.registers?.length ?? 0) > 1 ? (
            <div className="mt-4">
              <Select value={registerId} onValueChange={setRegisterId}>
                <SelectTrigger aria-label={t("entry.register")} className="h-12">
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
          ) : null}

          {!entryQuery.isLoading && !(entryQuery.data?.registers?.length ?? 0) ? (
            <div className="mt-4 border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              {t("entry.noRegisters")}
              {canManageRegisters ? (
                <Button className="mt-3 h-11 w-full" size="sm" asChild>
                  <Link href="/pos/registers">{t("registers.create")}</Link>
                </Button>
              ) : null}
            </div>
          ) : null}

          {openShift ? (
            <div className="mt-4 space-y-3">
              <Button className="h-14 w-full text-base" asChild>
                <Link href={`/pos/sell?registerId=${activeRegisterId}`}>{t("entry.sell")}</Link>
              </Button>
              <Button variant="secondary" className="h-11 w-full" asChild>
                <Link href={`/pos/shifts?registerId=${activeRegisterId}`}>
                  {t("shifts.closeShift")}
                </Link>
              </Button>
            </div>
          ) : selectedRegister ? (
            <Button
              className="mt-4 h-14 w-full text-base"
              onClick={() => setOpenShiftDialogOpen(true)}
              disabled={entryQuery.isLoading || openShiftMutation.isLoading}
            >
              {openShiftMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
              {t("entry.openShift")}
            </Button>
          ) : null}
        </div>

        {openShift ? (
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md border border-border bg-card p-3">
              <p className="text-xs text-muted-foreground">{t("entry.shiftOpenedAt")}</p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {formatDateTime(openShift.openedAt, locale)}
              </p>
            </div>
            <div className="rounded-md border border-border bg-card p-3">
              <p className="text-xs text-muted-foreground">{t("entry.openingCash")}</p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {formatStoreMoney(openShift.openingCashKgs)}
              </p>
            </div>
          </div>
        ) : null}

        {previousClosedShift ? (
          <div className="rounded-md border border-border bg-card p-4 text-sm">
            <p className="font-semibold text-foreground">{t("entry.previousClosedShiftTitle")}</p>
            <p className="mt-1 text-muted-foreground">
              {formatDateTime(previousClosedShift.closedAt ?? previousClosedShift.openedAt, locale)}
              {" · "}
              {previousClosedShift.register.name} ({previousClosedShift.register.code})
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div>
                <p className="text-xs text-muted-foreground">
                  {t("entry.previousClosedShiftCounted")}
                </p>
                <p className="font-semibold text-foreground">
                  {previousClosedShift.closingCashCountedKgs === null
                    ? tCommon("notAvailable")
                    : formatPreviousShiftMoney(previousClosedShift.closingCashCountedKgs)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  {t("entry.previousClosedShiftExpected")}
                </p>
                <p className="font-semibold text-foreground">
                  {previousClosedShift.expectedCashKgs === null
                    ? tCommon("notAvailable")
                    : formatPreviousShiftMoney(previousClosedShift.expectedCashKgs)}
                </p>
              </div>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" className="h-12" asChild>
            <Link href={`/pos/history?registerId=${activeRegisterId}`}>{t("entry.history")}</Link>
          </Button>
          <Button variant="secondary" className="h-12" asChild>
            <Link href={`/pos/shifts?registerId=${activeRegisterId}`}>{t("entry.shifts")}</Link>
          </Button>
          {canManageRegisters ? (
            <Button variant="secondary" className="h-12" asChild>
              <Link href="/pos/registers">{t("entry.registers")}</Link>
            </Button>
          ) : null}
          <Button
            variant="secondary"
            className="h-12 border-danger/20 bg-danger/10 text-danger hover:bg-danger/15 hover:text-danger"
            asChild
          >
            <Link href={`/pos/debts?registerId=${activeRegisterId}`}>{t("debts.title")}</Link>
          </Button>
        </div>
      </section>

      <div className="hidden gap-4 md:grid lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardContent className="space-y-5 p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2">
                <Badge variant={openShift ? "success" : "warning"}>
                  {openShift ? t("entry.shiftOpen") : t("entry.shiftClosed")}
                </Badge>
                <h3 className="text-2xl font-semibold text-foreground">
                  {openShift ? t("entry.readyToSell") : t("entry.openShiftTitle")}
                </h3>
                <p className="max-w-xl text-sm text-muted-foreground">
                  {selectedRegister
                    ? `${selectedRegister.store.name} · ${selectedRegister.name} (${selectedRegister.code})`
                    : t("entry.selectRegister")}
                </p>
              </div>
              {(entryQuery.data?.registers?.length ?? 0) > 1 ? (
                <div className="w-full sm:max-w-xs">
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
              ) : null}
            </div>

            {!entryQuery.isLoading && !(entryQuery.data?.registers?.length ?? 0) ? (
              <div className="border border-border bg-muted/40 p-4">
                <p className="text-sm text-muted-foreground">{t("entry.noRegisters")}</p>
                {canManageRegisters ? (
                  <Button className="mt-3" size="sm" asChild>
                    <Link href="/pos/registers">{t("registers.create")}</Link>
                  </Button>
                ) : null}
              </div>
            ) : null}

            {entryQuery.isLoading ? (
              <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner className="h-4 w-4" />
                {t("loading")}
              </div>
            ) : null}

            {selectedRegister ? (
              <div className="border border-border bg-muted/20 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {t("entry.previousClosedShiftTitle")}
                    </p>
                    {previousClosedShift ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatDateTime(
                          previousClosedShift.closedAt ?? previousClosedShift.openedAt,
                          locale,
                        )}
                        {" · "}
                        {previousClosedShift.register.name} ({previousClosedShift.register.code})
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("entry.previousClosedShiftEmpty")}
                      </p>
                    )}
                  </div>
                  {previousClosedShift ? (
                    <div className="grid gap-2 text-sm sm:grid-cols-3 sm:text-right">
                      <div>
                        <p className="text-xs text-muted-foreground">
                          {t("entry.previousClosedShiftCounted")}
                        </p>
                        <p className="font-semibold text-foreground">
                          {previousClosedShift.closingCashCountedKgs === null
                            ? tCommon("notAvailable")
                            : formatPreviousShiftMoney(previousClosedShift.closingCashCountedKgs)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">
                          {t("entry.previousClosedShiftExpected")}
                        </p>
                        <p className="font-semibold text-foreground">
                          {previousClosedShift.expectedCashKgs === null
                            ? tCommon("notAvailable")
                            : formatPreviousShiftMoney(previousClosedShift.expectedCashKgs)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">
                          {t("entry.previousClosedShiftClosedBy")}
                        </p>
                        <p className="font-semibold text-foreground">
                          {previousClosedShift.closedBy?.name ?? tCommon("notAvailable")}
                        </p>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {selectedRegister && !openShift ? (
              <Button
                className="h-12 w-full text-base sm:w-auto"
                onClick={() => setOpenShiftDialogOpen(true)}
              >
                {t("entry.openShift")}
              </Button>
            ) : null}

            {openShift ? (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="border border-border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">{t("entry.shiftOpenedAt")}</p>
                    <p className="text-sm font-medium text-foreground">
                      {formatDateTime(openShift.openedAt, locale)}
                    </p>
                  </div>
                  <div className="border border-border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">{t("entry.openingCash")}</p>
                    <p className="text-sm font-medium text-foreground">
                      {formatStoreMoney(openShift.openingCashKgs)}
                    </p>
                  </div>
                  <div className="border border-border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">{t("entry.openedBy")}</p>
                    <p className="text-sm font-medium text-foreground">{openShift.openedBy.name}</p>
                  </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button className="h-11 w-full sm:w-auto" asChild>
                    <Link href={`/pos/sell?registerId=${activeRegisterId}`}>{t("entry.sell")}</Link>
                  </Button>
                  <Button variant="secondary" className="h-11 w-full sm:w-auto" asChild>
                    <Link href={`/pos/shifts?registerId=${activeRegisterId}`}>
                      {t("shifts.closeShift")}
                    </Link>
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("entry.quickActionsTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {!openShift ? (
              <Button asChild disabled>
                <Link href={`/pos/sell?registerId=${activeRegisterId}`}>{t("entry.sell")}</Link>
              </Button>
            ) : null}
            <Button variant="secondary" asChild>
              <Link href={`/pos/history?registerId=${activeRegisterId}`}>{t("entry.history")}</Link>
            </Button>
            <Button variant="secondary" asChild>
              <Link href={`/pos/shifts?registerId=${activeRegisterId}`}>{t("entry.shifts")}</Link>
            </Button>
            {canManageRegisters ? (
              <Button variant="secondary" asChild>
                <Link href="/pos/registers">{t("entry.registers")}</Link>
              </Button>
            ) : null}
            <Button
              variant="secondary"
              className="border-danger/20 bg-danger/10 text-danger hover:bg-danger/15 hover:text-danger"
              asChild
            >
              <Link href={`/pos/debts?registerId=${activeRegisterId}`}>{t("debts.title")}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Modal
        open={openShiftDialogOpen}
        onOpenChange={(open) => {
          if (!open && !openShiftMutation.isLoading) {
            setOpenShiftDialogOpen(false);
          }
        }}
        title={t("entry.openShiftTitle")}
        subtitle={
          selectedRegister ? `${selectedRegister.store.name} · ${selectedRegister.name}` : undefined
        }
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void handleOpenShift();
          }}
        >
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">{t("entry.openingCash")}</label>
            <Input
              value={openingCash}
              onChange={(event) => setOpeningCash(event.target.value)}
              placeholder={t("entry.openingCashPlaceholder")}
              inputMode="decimal"
              autoFocus
            />
          </div>
          <div className="border border-border bg-muted/20 p-3 text-sm">
            <p className="font-medium text-foreground">{t("entry.previousClosedShiftTitle")}</p>
            {previousClosedShift ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <p className="text-muted-foreground">
                  {t("entry.previousClosedShiftClosedAt")}:{" "}
                  <span className="text-foreground">
                    {formatDateTime(
                      previousClosedShift.closedAt ?? previousClosedShift.openedAt,
                      locale,
                    )}
                  </span>
                </p>
                <p className="text-muted-foreground">
                  {t("entry.previousClosedShiftCounted")}:{" "}
                  <span className="text-foreground">
                    {previousClosedShift.closingCashCountedKgs === null
                      ? tCommon("notAvailable")
                      : formatPreviousShiftMoney(previousClosedShift.closingCashCountedKgs)}
                  </span>
                </p>
                <p className="text-muted-foreground">
                  {t("entry.previousClosedShiftExpected")}:{" "}
                  <span className="text-foreground">
                    {previousClosedShift.expectedCashKgs === null
                      ? tCommon("notAvailable")
                      : formatPreviousShiftMoney(previousClosedShift.expectedCashKgs)}
                  </span>
                </p>
                <p className="text-muted-foreground">
                  {t("entry.previousClosedShiftClosedBy")}:{" "}
                  <span className="text-foreground">
                    {previousClosedShift.closedBy?.name ?? tCommon("notAvailable")}
                  </span>
                </p>
              </div>
            ) : (
              <p className="mt-1 text-muted-foreground">{t("entry.previousClosedShiftEmpty")}</p>
            )}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">{t("entry.openingNote")}</label>
            <Textarea
              value={openingNote}
              onChange={(event) => setOpeningNote(event.target.value)}
              placeholder={t("entry.openingNotePlaceholder")}
              rows={3}
            />
          </div>
          <ModalFooter>
            <Button
              type="button"
              variant="secondary"
              className="w-full sm:w-auto"
              onClick={() => setOpenShiftDialogOpen(false)}
              disabled={openShiftMutation.isLoading}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              type="submit"
              className="w-full sm:w-auto"
              disabled={openShiftMutation.isLoading}
            >
              {openShiftMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
              {t("entry.openShift")}
            </Button>
          </ModalFooter>
        </form>
      </Modal>
    </div>
  );
};

export default PosEntryPage;
