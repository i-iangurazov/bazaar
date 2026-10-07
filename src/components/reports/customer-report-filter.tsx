"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/search-input";
import { Spinner } from "@/components/ui/spinner";
import { ReportPagination } from "@/components/reports/report-controls";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

export function CustomerReportFilter(props: {
  enabled: boolean;
  storeId?: string;
  customerId?: string;
  customerName?: string;
  onChange: (customerId?: string) => void;
}) {
  const t = useTranslations("customerPurchases"),
    errors = useTranslations("errors");
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
  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {props.customerId ? (props.customerName ?? t("selected")) : t("allCustomers")}
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" aria-expanded={open} onClick={() => setOpen(!open)}>
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
          {query.isLoading ? <Spinner /> : null}
          {query.error ? <p role="alert">{translateError(errors, query.error)}</p> : null}
          {query.data?.total === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noCustomers")}</p>
          ) : null}
          <ul className="divide-y">
            {query.data?.items.map((customer) => (
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
            total={query.data?.total ?? 0}
            onPage={setPage}
          />
        </div>
      ) : null}
    </div>
  );
}
