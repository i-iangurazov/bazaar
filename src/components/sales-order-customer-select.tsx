"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { ChevronDownIcon } from "@/components/icons";
import { QueryErrorState } from "@/components/query-error-state";
import { SearchInput } from "@/components/search-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { trpc } from "@/lib/trpc";

export type SalesOrderCustomerOption = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
};

export function SalesOrderCustomerSelect({
  storeId,
  customerId,
  customerName,
  disabled = false,
  onSelect,
}: {
  storeId: string;
  customerId: string | null;
  customerName: string;
  disabled?: boolean;
  onSelect: (customer: SalesOrderCustomerOption | null) => void;
}) {
  const t = useTranslations("salesOrders");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setOpen(false);
    setSearch("");
    setDebouncedSearch("");
  }, [storeId]);

  const query = trpc.salesOrders.customerOptions.useQuery(
    { storeId, search: debouncedSearch || undefined, limit: 25 },
    { enabled: open && Boolean(storeId) && !disabled, keepPreviousData: false },
  );

  const choose = (customer: SalesOrderCustomerOption | null) => {
    onSelect(customer);
    setOpen(false);
    setSearch("");
    setDebouncedSearch("");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          className="w-full justify-between gap-2"
          disabled={disabled || !storeId}
          aria-label={t("selectCustomer")}
        >
          <span className="min-w-0 truncate">
            {customerId ? customerName || t("selectedCustomer") : t("selectCustomer")}
          </span>
          <ChevronDownIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{t("selectCustomer")}</DialogTitle>
          <DialogDescription>{t("customerSelectionHint")}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <SearchInput
            value={search}
            onValueChange={setSearch}
            maxLength={120}
            aria-label={t("customerSearch")}
            placeholder={t("customerSearch")}
          />
          {query.isLoading || search.trim() !== debouncedSearch ? (
            <div className="flex justify-center py-5" role="status" aria-label={tCommon("loading")}>
              <Spinner />
            </div>
          ) : query.error ? (
            <QueryErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : query.data?.length ? (
            <div className="space-y-1">
              {query.data.map((customer) => (
                <Button
                  key={customer.id}
                  type="button"
                  variant="ghost"
                  className="h-auto min-h-12 w-full justify-start px-3 py-3 text-left"
                  onClick={() => choose(customer)}
                >
                  <span className="min-w-0 space-y-1">
                    <span className="block truncate font-medium">{customer.name}</span>
                    {customer.phone || customer.email ? (
                      <span className="block truncate text-xs font-normal text-muted-foreground">
                        {customer.phone || customer.email}
                      </span>
                    ) : null}
                  </span>
                </Button>
              ))}
            </div>
          ) : (
            <p className="py-5 text-center text-sm text-muted-foreground">
              {t("noCustomerMatches")}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => choose(null)}>
            {t("withoutCustomerCard")}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            {tCommon("cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
