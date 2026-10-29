"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/search-input";
import { Spinner } from "@/components/ui/spinner";
import { ReportPagination } from "@/components/reports/report-controls";
import { trpc } from "@/lib/trpc";
import { QueryErrorState } from "@/components/query-error-state";

export function CustomerReportFilter(props: {
  enabled: boolean;
  storeId?: string;
  customerId?: string;
  customerName?: string;
  onChange: (customerId?: string) => void;
}) {
  const t = useTranslations("customerPurchases");
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState(""),
    [page, setPage] = useState(1);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const query = trpc.reports.customerOptions.useQuery(
    { storeId: props.storeId, search: debounced || undefined, page },
    { enabled: props.enabled && open, keepPreviousData: false },
  );
  const data = props.enabled && !query.error ? query.data : undefined;
  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {props.customerId ? (props.customerName ?? t("selected")) : t("allCustomers")}
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={!props.enabled} aria-expanded={open} onClick={() => setOpen(!open)}>
            {t("select")}
          </Button>
          {props.customerId ? (
            <Button variant="ghost" onClick={() => props.onChange(undefined)}>
              {t("clear")}
            </Button>
          ) : null}
        </div>
      </div>
      {open ? (
        <div className="space-y-3">
          <SearchInput
            aria-label={t("search")}
            placeholder={t("search")}
            value={search}
            onValueChange={setSearch}
          />
          {props.enabled && query.isLoading ? <Spinner /> : null}
          {props.enabled && query.error ? (
            <QueryErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : null}
          {data?.total === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noCustomers")}</p>
          ) : null}
          <ul className="divide-y">
            {data?.items.map((customer) => (
              <li key={customer.id}>
                <button
                  type="button"
                  className="w-full rounded-md px-2 py-3 text-left text-sm hover:bg-muted focus-visible:outline focus-visible:outline-2"
                  onClick={() => {
                    props.onChange(customer.id);
                    setOpen(false);
                  }}
                >
                  <strong>{customer.name}</strong>
                  <span className="ml-2 text-muted-foreground">
                    {customer.email ?? customer.phone}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <ReportPagination
            page={page}
            pageSize={25}
            total={data?.total ?? 0}
            onPage={setPage}
          />
        </div>
      ) : null}
    </div>
  );
}
