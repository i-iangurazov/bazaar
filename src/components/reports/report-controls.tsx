"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode, type ComponentProps } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { trpc } from "@/lib/trpc";
import { reportHref, reportUrlState } from "@/lib/reporting";
import { addBusinessDays, businessDateKey } from "@/lib/timezone";
import { translateError } from "@/lib/translateError";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table as BaseTable } from "@/components/ui/table";

export function ReportTable(props: ComponentProps<typeof BaseTable>) {
  const t = useTranslations("reporting");
  return (
    <div
      role="region"
      aria-label={t("tableScroll")}
      tabIndex={0}
      className="max-w-full overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
    >
      <BaseTable {...props} sortable={false} />
    </div>
  );
}

export const ReportSelect = ({
  label,
  value,
  onChange,
  children,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
}) => (
  <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted-foreground">
    {label}
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
    >
      {children}
    </select>
  </label>
);

export function useReportScope(mode: "sales" | "hub") {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const query = params.toString();
  const state = useMemo(() => reportUrlState(query, mode), [query, mode]);
  const { data: session, status } = useSession();
  const tErrors = useTranslations("errors");
  const allowed =
    status === "authenticated" && ["ADMIN", "MANAGER"].includes(session?.user.role ?? "");
  const stores = trpc.stores.list.useQuery(undefined, {
    enabled: allowed,
    staleTime: 0,
    cacheTime: 0,
    retry: false,
    refetchOnMount: "always",
  });
  const storesReady = stores.data !== undefined && !stores.isFetching && !stores.error;
  const error = !state.valid
    ? tErrors("invalidInput")
    : stores.error
      ? translateError(tErrors, stores.error)
      : storesReady && state.storeId && !stores.data?.some((store) => store.id === state.storeId)
        ? tErrors("storeAccessDenied")
        : null;
  const enabled = allowed && storesReady && !error;
  const [draft, setDraft] = useState({ query, value: state.search ?? "" });
  const search = draft.query === query ? draft.value : (state.search ?? "");
  const setSearch = (value: string) => setDraft({ query, value });
  const update = (patch: Record<string, string | number | undefined | null>) => {
    const values = { ...state, valid: undefined };
    router.replace(
      reportHref(pathname, { ...values, search: search || undefined, page: undefined, ...patch }),
      { scroll: false },
    );
  };
  const fingerprint = JSON.stringify([
    session?.user.id,
    session?.user.organizationId,
    session?.user.role,
    status,
    query,
    search,
    enabled,
  ]);
  const current = useRef(fingerprint);
  current.current = fingerprint;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return {
    state,
    search,
    setSearch,
    update,
    stores,
    storesReady,
    error,
    enabled,
    allowed,
    session,
    fingerprint,
    exportGuard: () => {
      const expected = current.current;
      return () => mounted.current && expected === current.current;
    },
  };
}
export type ReportScope = ReturnType<typeof useReportScope>;

export function ReportPeriodControls({
  scope,
  children,
  currentSnapshot = false,
}: {
  scope: ReportScope;
  children?: ReactNode;
  currentSnapshot?: boolean;
}) {
  const t = useTranslations("reporting");
  const a = useTranslations("analytics");
  const { state, update } = scope;
  const preset = (days: number) => {
    const dateTo = businessDateKey(new Date());
    update({ dateFrom: addBusinessDays(dateTo, -days + 1), dateTo });
  };
  return (
    <section
      aria-label={t("filters")}
      className="space-y-3 rounded-xl border border-border bg-card p-4"
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 [&>label:first-child]:col-span-2 [&>label:last-child]:col-span-2 sm:[&>label]:col-span-1">
        <ReportSelect
          label={a("filters.store")}
          value={state.storeId ?? "all"}
          onChange={(value) =>
            update({
              storeId: value === "all" ? undefined : value,
              registerId: undefined,
              cashierId: undefined,
            })
          }
        >
          <option value="all">{t("allStores")}</option>
          {scope.storesReady &&
            scope.stores.data?.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
        </ReportSelect>
        <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
          {a("filters.dateFrom")}
          <Input
            aria-label={a("filters.dateFrom")}
            type="date"
            value={state.dateFrom}
            disabled={currentSnapshot}
            onChange={(event) => update({ dateFrom: event.target.value })}
          />
        </label>
        <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
          {a("filters.dateTo")}
          <Input
            aria-label={a("filters.dateTo")}
            type="date"
            value={state.dateTo}
            disabled={currentSnapshot}
            onChange={(event) => update({ dateTo: event.target.value })}
          />
        </label>
        {children}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!currentSnapshot &&
          [1, 7, 30].map((days) => (
            <Button key={days} size="sm" variant="secondary" onClick={() => preset(days)}>
              {days === 1 ? t("today") : t("lastDays", { days })}
            </Button>
          ))}
        <span className="text-xs text-muted-foreground">
          {currentSnapshot ? t("currentSnapshot") : t("immediate")} · KGS · Asia/Bishkek
        </span>
      </div>
    </section>
  );
}

export function ReportPagination({
  page,
  total,
  pageSize,
  onPage,
}: {
  page: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
}) {
  const t = useTranslations("reporting");
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
      <p className="text-xs text-muted-foreground">{t("pagination", { page, pages, total })}</p>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          {t("previous")}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          {t("next")}
        </Button>
      </div>
    </div>
  );
}
