"use client";

import { useEffect, useMemo, useState } from "react";
import { CustomerSource } from "@prisma/client";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { ResponsiveDataList } from "@/components/responsive-data-list";
import { DownloadIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal, ModalFooter } from "@/components/ui/modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import {
  buildCustomerExportTable,
  CUSTOMER_EXPORT_COLUMN_KEYS,
  type CustomerExportColumnKey,
} from "@/lib/customerExport";
import { formatStoreMoney } from "@/lib/currencyDisplay";
import type { DownloadFormat } from "@/lib/fileExport";
import { formatDateTime } from "@/lib/i18nFormat";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { cn } from "@/lib/utils";

type CustomerFormState = {
  id?: string;
  name: string;
  email: string;
  phone: string;
  address: string;
};

const emptyForm: CustomerFormState = {
  name: "",
  email: "",
  phone: "",
  address: "",
};

const sourceValues = [
  CustomerSource.MANUAL,
  CustomerSource.IMPORT,
  CustomerSource.ORDER,
  CustomerSource.INTEGRATION,
];

const CustomerDatabasePage = () => {
  const t = useTranslations("customers");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [storeId, setStoreId] = useState("");
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<"ALL" | CustomerSource>("ALL");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<CustomerFormState>(emptyForm);
  const [detailCustomerId, setDetailCustomerId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<DownloadFormat>("xlsx");
  const [selectedExportColumns, setSelectedExportColumns] = useState<CustomerExportColumnKey[]>([
    ...CUSTOMER_EXPORT_COLUMN_KEYS,
  ]);

  const storesQuery = trpc.stores.list.useQuery();
  const stores = useMemo(() => storesQuery.data ?? [], [storesQuery.data]);

  useEffect(() => {
    if (!storeId && stores.length) {
      setStoreId(stores[0]?.id ?? "");
    }
  }, [storeId, stores]);

  useEffect(() => {
    if (searchParams.get("add") === "1") {
      setForm(emptyForm);
      setFormOpen(true);
    }
  }, [searchParams]);

  const customersQuery = trpc.customers.list.useQuery(
    {
      storeId: storeId || undefined,
      search: search || undefined,
      source,
      page,
      pageSize,
    },
    { enabled: Boolean(storeId) },
  );
  const exportQuery = trpc.customers.exportRows.useQuery(
    {
      storeId: storeId || undefined,
      search: search || undefined,
      source,
    },
    { enabled: false },
  );
  const customerDetailQuery = trpc.customers.detail.useQuery(
    { customerId: detailCustomerId ?? "" },
    { enabled: Boolean(detailCustomerId) },
  );

  const utils = trpc.useUtils();
  const invalidateCustomers = async () => {
    await utils.customers.list.invalidate();
  };

  const createMutation = trpc.customers.create.useMutation({
    onSuccess: async () => {
      setFormOpen(false);
      setForm(emptyForm);
      setPage(1);
      await invalidateCustomers();
      toast({ variant: "success", description: t("messages.created") });
    },
    onError: (error) => toast({ variant: "error", description: translateError(tErrors, error) }),
  });

  const updateMutation = trpc.customers.update.useMutation({
    onSuccess: async () => {
      setFormOpen(false);
      setForm(emptyForm);
      await invalidateCustomers();
      toast({ variant: "success", description: t("messages.updated") });
    },
    onError: (error) => toast({ variant: "error", description: translateError(tErrors, error) }),
  });

  const deleteMutation = trpc.customers.delete.useMutation({
    onSuccess: async () => {
      await invalidateCustomers();
      toast({ variant: "success", description: t("messages.deleted") });
    },
    onError: (error) => toast({ variant: "error", description: translateError(tErrors, error) }),
  });

  const selectedStore = stores.find((store) => store.id === storeId);
  const customers = customersQuery.data?.items ?? [];
  const customerDetail = customerDetailQuery.data ?? null;
  const exportColumns = useMemo(
    () =>
      CUSTOMER_EXPORT_COLUMN_KEYS.map((key) => ({
        key,
        label: t(`columns.${key}`),
      })),
    [t],
  );
  const selectedExportColumnSet = useMemo(
    () => new Set(selectedExportColumns),
    [selectedExportColumns],
  );
  const formErrors = useMemo(() => {
    const errors: string[] = [];
    if (!form.name.trim()) {
      errors.push(t("validation.nameRequired"));
    }
    if (!form.email.trim() && !form.phone.trim()) {
      errors.push(t("validation.contactRequired"));
    }
    return errors;
  }, [form.email, form.name, form.phone, t]);

  const openAdd = () => {
    setForm(emptyForm);
    setFormOpen(true);
  };

  const openEdit = (customer: (typeof customers)[number]) => {
    setForm({
      id: customer.id,
      name: customer.name ?? "",
      email: customer.email ?? "",
      phone: customer.phone ?? "",
      address: customer.address ?? "",
    });
    setFormOpen(true);
  };

  const handleSubmit = () => {
    if (!storeId || formErrors.length) {
      return;
    }
    if (form.id) {
      updateMutation.mutate({
        customerId: form.id,
        name: form.name,
        email: form.email || null,
        phone: form.phone || null,
        address: form.address || null,
      });
      return;
    }
    createMutation.mutate({
      storeId,
      name: form.name,
      email: form.email || null,
      phone: form.phone || null,
      address: form.address || null,
    });
  };

  const renderSource = (value: CustomerSource) => t(`sources.${value.toLowerCase()}`);

  const toggleExportColumn = (column: CustomerExportColumnKey) => {
    setSelectedExportColumns((current) =>
      current.includes(column)
        ? current.filter((key) => key !== column)
        : CUSTOMER_EXPORT_COLUMN_KEYS.filter((key) => key === column || current.includes(key)),
    );
  };

  const handleExport = async () => {
    if (!selectedExportColumns.length) {
      return;
    }

    const { data, error } = await exportQuery.refetch();
    if (error) {
      toast({ variant: "error", description: translateError(tErrors, error) });
      return;
    }
    if (!data?.length) {
      toast({ variant: "error", description: t("export.empty") });
      return;
    }

    const labels = Object.fromEntries(
      exportColumns.map((column) => [column.key, column.label]),
    ) as Record<CustomerExportColumnKey, string>;
    const table = buildCustomerExportTable({
      customers: data,
      selectedColumns: selectedExportColumns,
      labels,
      formatDate: (value) => formatDateTime(value, locale),
      formatSource: (value) => renderSource(value as CustomerSource),
    });
    const storeSlug = (selectedStore?.code || selectedStore?.name || "customers")
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase();
    const exportDate = new Date().toISOString().slice(0, 10);

    try {
      const { downloadTableFile } = await import("@/lib/fileExport");
      downloadTableFile({
        format: exportFormat,
        fileNameBase: `customers-${storeSlug || "export"}-${exportDate}`,
        ...table,
      });
    } catch {
      toast({ variant: "error", description: t("export.failed") });
      return;
    }
    setExportOpen(false);
    toast({ variant: "success", description: t("messages.exported", { count: data.length }) });
  };

  const viewCustomerSales = (customer: (typeof customers)[number]) => {
    setDetailCustomerId(customer.id);
  };

  const formatCustomerMoney = (value: number) => formatStoreMoney(value, locale, selectedStore);

  const emptyState = (
    <Card className="bazaar-admin-surface">
      <CardContent className="bazaar-admin-empty">
        {t("empty")}
      </CardContent>
    </Card>
  );

  return (
    <div>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          <div className="hidden gap-2 md:flex">
            <Button
              type="button"
              variant="outline"
              onClick={() => setExportOpen(true)}
              disabled={!storeId || customersQuery.isLoading || !customersQuery.data?.total}
            >
              <DownloadIcon className="h-4 w-4" aria-hidden />
              {t("actions.export")}
            </Button>
            <Button type="button" onClick={openAdd} disabled={!storeId}>
              {t("actions.add")}
            </Button>
          </div>
        }
        filters={
          <div className="hidden md:contents">
            <div className="w-full sm:w-64">
              <Label htmlFor="customer-store">{t("filters.store")}</Label>
              <Select
                value={storeId}
                onValueChange={(value) => {
                  setStoreId(value);
                  setPage(1);
                }}
              >
                <SelectTrigger id="customer-store">
                  <SelectValue placeholder={t("filters.storePlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {stores.map((store) => (
                    <SelectItem key={store.id} value={store.id}>
                      {store.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-full sm:w-72">
              <Label htmlFor="customer-search">{t("filters.search")}</Label>
              <Input
                id="customer-search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder={t("filters.searchPlaceholder")}
              />
            </div>
            <div className="w-full sm:w-56">
              <Label htmlFor="customer-source">{t("filters.source")}</Label>
              <Select
                value={source}
                onValueChange={(value) => {
                  setSource(value as "ALL" | CustomerSource);
                  setPage(1);
                }}
              >
                <SelectTrigger id="customer-source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">{t("filters.allSources")}</SelectItem>
                  {sourceValues.map((value) => (
                    <SelectItem key={value} value={value}>
                      {renderSource(value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        }
      />

      <section data-mobile-customers-toolbar className="mb-5 space-y-4 md:hidden">
        <div className="bazaar-admin-toolbar space-y-3">
          <Select
            value={storeId}
            onValueChange={(value) => {
              setStoreId(value);
              setPage(1);
            }}
          >
            <SelectTrigger className="min-h-11">
              <SelectValue placeholder={t("filters.storePlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {stores.map((store) => (
                <SelectItem key={store.id} value={store.id}>
                  {store.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            className="min-h-11"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder={t("filters.mobileSearchPlaceholder")}
          />
          <div
            className="scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
            role="group"
            aria-label={t("filters.source")}
          >
            <Button
              type="button"
              size="sm"
              variant={source === "ALL" ? "primary" : "secondary"}
              className="min-h-10 shrink-0"
              onClick={() => {
                setSource("ALL");
                setPage(1);
              }}
            >
              {t("filters.allSources")}
            </Button>
            {sourceValues.map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={source === value ? "primary" : "secondary"}
                className="min-h-10 shrink-0"
                onClick={() => {
                  setSource(value);
                  setPage(1);
                }}
              >
                {renderSource(value)}
              </Button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-12 w-full"
            onClick={() => setExportOpen(true)}
            disabled={!storeId || customersQuery.isLoading || !customersQuery.data?.total}
          >
            <DownloadIcon className="h-4 w-4" aria-hidden />
            {t("actions.export")}
          </Button>
          <Button type="button" className="min-h-12 w-full" onClick={openAdd} disabled={!storeId}>
            {t("actions.add")}
          </Button>
        </div>
      </section>

      {!storesQuery.isLoading && !stores.length ? (
        <Card className="bazaar-admin-surface">
          <CardContent className="bazaar-admin-empty">{t("noStores")}</CardContent>
        </Card>
      ) : null}

      {customersQuery.error ? (
        <Card className="bazaar-admin-surface">
          <CardContent className="bazaar-admin-error">
            {translateError(tErrors, customersQuery.error)}
          </CardContent>
        </Card>
      ) : null}

      <ResponsiveDataList
        items={customers}
        page={page}
        totalItems={customersQuery.data?.total ?? 0}
        defaultPageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(nextPageSize) => {
          setPageSize(nextPageSize);
          setPage(1);
        }}
        paginationKey="customers"
        mobileItemsClassName="space-y-3"
        empty={emptyState}
        getKey={(customer) => customer.id}
        renderDesktop={(items) => (
          <TableContainer className="bazaar-admin-table-shell">
            <Table className="min-w-[920px]">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columns.name")}</TableHead>
                  <TableHead>{t("columns.email")}</TableHead>
                  <TableHead>{t("columns.phone")}</TableHead>
                  <TableHead>{t("columns.address")}</TableHead>
                  <TableHead>{t("columns.source")}</TableHead>
                  <TableHead>{t("columns.createdAt")}</TableHead>
                  <TableHead className="text-right">{t("columns.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length ? (
                  items.map((customer) => (
                    <TableRow key={customer.id}>
                      <TableCell className="font-medium">{customer.name}</TableCell>
                      <TableCell>{customer.email ?? "-"}</TableCell>
                      <TableCell>{customer.phone ?? "-"}</TableCell>
                      <TableCell className="max-w-[260px] truncate">
                        {customer.address ?? "-"}
                      </TableCell>
                      <TableCell>{renderSource(customer.source)}</TableCell>
                      <TableCell>{formatDateTime(customer.createdAt, locale)}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => openEdit(customer)}
                          >
                            {tCommon("edit")}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={deleteMutation.isLoading}
                            onClick={() => {
                              if (window.confirm(t("deleteConfirm", { name: customer.name }))) {
                                deleteMutation.mutate({ customerId: customer.id });
                              }
                            }}
                          >
                            {tCommon("delete")}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-10 text-center text-sm text-muted-foreground"
                    >
                      {customersQuery.isLoading ? tCommon("loading") : t("empty")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        renderMobile={(customer) => (
          <Card className="bazaar-admin-surface overflow-hidden">
            <CardHeader className="space-y-1 pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="truncate text-base">{customer.name}</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {selectedStore?.name} · {renderSource(customer.source)}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-h-10 shrink-0"
                  onClick={() => viewCustomerSales(customer)}
                >
                  {t("actions.viewSales")}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid gap-2">
                <div>
                  <p className="text-xs text-muted-foreground">{t("columns.phone")}</p>
                  <p className="font-medium text-foreground">{customer.phone ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("columns.email")}</p>
                  <p className="font-medium text-foreground">{customer.email ?? "—"}</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bazaar-admin-info-tile">
                    <p className="text-xs text-muted-foreground">{t("columns.lastPurchase")}</p>
                    <p className="text-sm font-semibold text-foreground">
                      {customer.lastOrderAt
                        ? formatDateTime(customer.lastOrderAt, locale)
                        : tCommon("notAvailable")}
                    </p>
                  </div>
                  <div className="bazaar-admin-info-tile">
                    <p className="text-xs text-muted-foreground">{t("columns.totalPurchases")}</p>
                    <p className="text-sm font-semibold text-foreground">{customer.orderCount}</p>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {customer.phone ? (
                  <Button asChild variant="secondary" size="sm" className="min-h-10">
                    <a href={`tel:${customer.phone}`}>{t("actions.call")}</a>
                  </Button>
                ) : (
                  <Button type="button" variant="secondary" size="sm" className="min-h-10" disabled>
                    {t("actions.call")}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="min-h-10"
                  onClick={() => openEdit(customer)}
                >
                  {tCommon("edit")}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="min-h-10"
                  onClick={() => viewCustomerSales(customer)}
                >
                  {t("actions.viewSales")}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      />

      <Modal
        open={exportOpen}
        onOpenChange={setExportOpen}
        title={t("export.title")}
        subtitle={t("export.subtitle")}
        className="max-w-2xl"
        mobileSheet
      >
        <div className="space-y-6">
          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">{t("export.formatTitle")}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{t("export.formatHint")}</p>
            </div>
            <div
              className="grid gap-3 sm:grid-cols-2"
              role="radiogroup"
              aria-label={t("export.formatTitle")}
            >
              {(["csv", "xlsx"] as const).map((format) => {
                const selected = exportFormat === format;
                return (
                  <button
                    key={format}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={cn(
                      "button-focus-ring rounded-xl border p-4 text-left transition",
                      selected
                        ? "border-primary bg-primary/10 ring-1 ring-primary/20"
                        : "border-border bg-card hover:border-primary/45 hover:bg-muted/40",
                    )}
                    onClick={() => setExportFormat(format)}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="font-semibold text-foreground">
                        {t(`export.formats.${format}.title`)}
                      </span>
                      <span
                        className={cn(
                          "flex h-5 w-5 items-center justify-center rounded-full border",
                          selected ? "border-primary bg-primary" : "border-input bg-background",
                        )}
                        aria-hidden
                      >
                        {selected ? (
                          <span className="h-2 w-2 rounded-full bg-primary-foreground" />
                        ) : null}
                      </span>
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                      {t(`export.formats.${format}.description`)}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  {t("export.columnsTitle")}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("export.selectionSummary", {
                    selected: selectedExportColumns.length,
                    total: customersQuery.data?.total ?? 0,
                  })}
                </p>
              </div>
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedExportColumns([...CUSTOMER_EXPORT_COLUMN_KEYS])}
                >
                  {t("export.selectAll")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedExportColumns([])}
                >
                  {t("export.clear")}
                </Button>
              </div>
            </div>
            <div className="grid gap-2 rounded-xl border border-border bg-muted/20 p-3 sm:grid-cols-2">
              {exportColumns.map((column) => {
                const checked = selectedExportColumnSet.has(column.key);
                return (
                  <label
                    key={column.key}
                    className={cn(
                      "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition",
                      checked
                        ? "border-primary/45 bg-card text-foreground shadow-sm"
                        : "border-border bg-card/60 text-muted-foreground hover:bg-card",
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggleExportColumn(column.key)}
                      aria-label={column.label}
                    />
                    <span className="font-medium">{column.label}</span>
                  </label>
                );
              })}
            </div>
            {!selectedExportColumns.length ? (
              <p className="text-sm font-medium text-danger">{t("export.columnsRequired")}</p>
            ) : null}
          </section>

          <ModalFooter>
            <Button type="button" variant="secondary" onClick={() => setExportOpen(false)}>
              {tCommon("cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => void handleExport()}
              disabled={exportQuery.isFetching || !selectedExportColumns.length}
            >
              {exportQuery.isFetching ? (
                <Spinner className="h-4 w-4 text-primary-foreground" />
              ) : (
                <DownloadIcon className="h-4 w-4" aria-hidden />
              )}
              {exportQuery.isFetching ? t("export.preparing") : t("export.download")}
            </Button>
          </ModalFooter>
        </div>
      </Modal>

      <Modal
        open={Boolean(detailCustomerId)}
        onOpenChange={(open) => {
          if (!open) {
            setDetailCustomerId(null);
          }
        }}
        title={customerDetail?.customer.name ?? t("detail.title")}
        subtitle={t("detail.subtitle")}
        className="max-w-2xl"
        mobileSheet
      >
        {customerDetailQuery.isLoading ? (
          <div className="bazaar-admin-empty py-8">{tCommon("loading")}</div>
        ) : customerDetailQuery.error ? (
          <div className="bazaar-admin-error">
            {translateError(tErrors, customerDetailQuery.error)}
          </div>
        ) : customerDetail ? (
          <div className="space-y-5">
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">{t("detail.contactInfo")}</h3>
              <div className="grid gap-2 text-sm">
                <div className="bazaar-admin-modal-card">
                  <p className="text-xs text-muted-foreground">{t("columns.phone")}</p>
                  <p className="font-medium text-foreground">
                    {customerDetail.customer.phone ?? "—"}
                  </p>
                </div>
                <div className="bazaar-admin-modal-card">
                  <p className="text-xs text-muted-foreground">{t("columns.email")}</p>
                  <p className="font-medium text-foreground">
                    {customerDetail.customer.email ?? "—"}
                  </p>
                </div>
                <div className="bazaar-admin-modal-card">
                  <p className="text-xs text-muted-foreground">{t("columns.address")}</p>
                  <p className="font-medium text-foreground">
                    {customerDetail.customer.address ?? "—"}
                  </p>
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">{t("detail.summary")}</h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="bazaar-admin-modal-card">
                  <p className="text-xs text-muted-foreground">{t("columns.lastPurchase")}</p>
                  <p className="font-semibold text-foreground">
                    {customerDetail.customer.lastOrderAt
                      ? formatDateTime(customerDetail.customer.lastOrderAt, locale)
                      : tCommon("notAvailable")}
                  </p>
                </div>
                <div className="bazaar-admin-modal-card">
                  <p className="text-xs text-muted-foreground">{t("columns.totalPurchases")}</p>
                  <p className="font-semibold text-foreground">
                    {customerDetail.customer.orderCount}
                  </p>
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-foreground">
                  {t("detail.recentReceipts")}
                </h3>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setDetailCustomerId(null);
                    openEdit(customerDetail.customer);
                  }}
                >
                  {tCommon("edit")}
                </Button>
              </div>
              {customerDetail.recentOrders.length ? (
                <div className="space-y-2">
                  {customerDetail.recentOrders.map((order) => (
                    <div key={order.id} className="bazaar-admin-modal-card">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-foreground">{order.number}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatDateTime(order.completedAt ?? order.createdAt, locale)}
                          </p>
                        </div>
                        <p className="shrink-0 font-semibold text-foreground">
                          {formatCustomerMoney(order.totalKgs)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bazaar-admin-empty min-h-24 p-4">
                  {t("detail.noReceipts")}
                </div>
              )}
            </section>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={formOpen}
        onOpenChange={setFormOpen}
        title={form.id ? t("modal.editTitle") : t("modal.addTitle")}
        subtitle={t("modal.subtitle")}
        className="max-w-2xl"
        mobileSheet
      >
        <div className="grid gap-4">
          <div>
            <Label htmlFor="customer-name">{t("fields.name")}</Label>
            <Input
              id="customer-name"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="customer-email">{t("fields.email")}</Label>
              <Input
                id="customer-email"
                type="email"
                value={form.email}
                onChange={(event) =>
                  setForm((current) => ({ ...current, email: event.target.value }))
                }
              />
            </div>
            <div>
              <Label htmlFor="customer-phone">{t("fields.phone")}</Label>
              <Input
                id="customer-phone"
                value={form.phone}
                onChange={(event) =>
                  setForm((current) => ({ ...current, phone: event.target.value }))
                }
              />
            </div>
          </div>
          <div>
            <Label htmlFor="customer-address">{t("fields.address")}</Label>
            <Textarea
              id="customer-address"
              value={form.address}
              onChange={(event) =>
                setForm((current) => ({ ...current, address: event.target.value }))
              }
              rows={3}
            />
          </div>
          {formErrors.length ? (
            <div className="bazaar-admin-error">
              {formErrors.map((error) => (
                <p key={error}>{error}</p>
              ))}
            </div>
          ) : null}
          <ModalFooter>
            <Button type="button" variant="secondary" onClick={() => setFormOpen(false)}>
              {tCommon("cancel")}
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={
                !storeId ||
                formErrors.length > 0 ||
                createMutation.isLoading ||
                updateMutation.isLoading
              }
            >
              {createMutation.isLoading || updateMutation.isLoading
                ? tCommon("loading")
                : form.id
                  ? t("actions.save")
                  : t("actions.create")}
            </Button>
          </ModalFooter>
        </div>
      </Modal>
    </div>
  );
};

export default CustomerDatabasePage;
