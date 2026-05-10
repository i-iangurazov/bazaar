"use client";

import { useEffect, useMemo, useState } from "react";
import { CustomerSource } from "@prisma/client";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { ResponsiveDataList } from "@/components/responsive-data-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { formatDateTime } from "@/lib/i18nFormat";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

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

  const utils = trpc.useUtils();
  const invalidateCustomers = async () => {
    await utils.customers.list.invalidate();
  };

  const createMutation = trpc.customers.create.useMutation({
    onSuccess: async () => {
      setFormOpen(false);
      setForm(emptyForm);
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

  const emptyState = (
    <Card>
      <CardContent className="py-10 text-center text-sm text-muted-foreground">
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
          <Button type="button" onClick={openAdd} disabled={!storeId}>
            {t("actions.add")}
          </Button>
        }
        filters={
          <>
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
          </>
        }
      />

      {!storesQuery.isLoading && !stores.length ? (
        <Card>
          <CardContent className="py-10 text-sm text-muted-foreground">
            {t("noStores")}
          </CardContent>
        </Card>
      ) : null}

      {customersQuery.error ? (
        <Card>
          <CardContent className="py-6 text-sm text-danger">
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
        empty={emptyState}
        getKey={(customer) => customer.id}
        renderDesktop={(items) => (
          <TableContainer>
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
                      <TableCell className="max-w-[260px] truncate">{customer.address ?? "-"}</TableCell>
                      <TableCell>{renderSource(customer.source)}</TableCell>
                      <TableCell>{formatDateTime(customer.createdAt, locale)}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Button type="button" variant="secondary" onClick={() => openEdit(customer)}>
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
                    <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                      {customersQuery.isLoading ? tCommon("loading") : t("empty")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        renderMobile={(customer) => (
          <Card>
            <CardHeader className="space-y-1">
              <CardTitle className="text-base">{customer.name}</CardTitle>
              <p className="text-xs text-muted-foreground">
                {selectedStore?.name} · {renderSource(customer.source)}
              </p>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid gap-2">
                <p>
                  <span className="text-muted-foreground">{t("columns.email")}: </span>
                  {customer.email ?? "-"}
                </p>
                <p>
                  <span className="text-muted-foreground">{t("columns.phone")}: </span>
                  {customer.phone ?? "-"}
                </p>
                <p>
                  <span className="text-muted-foreground">{t("columns.address")}: </span>
                  {customer.address ?? "-"}
                </p>
                <p>
                  <span className="text-muted-foreground">{t("columns.createdAt")}: </span>
                  {formatDateTime(customer.createdAt, locale)}
                </p>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={() => openEdit(customer)}>
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
            </CardContent>
          </Card>
        )}
      />

      <Modal
        open={formOpen}
        onOpenChange={setFormOpen}
        title={form.id ? t("modal.editTitle") : t("modal.addTitle")}
        subtitle={t("modal.subtitle")}
        className="max-w-2xl"
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
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="customer-phone">{t("fields.phone")}</Label>
              <Input
                id="customer-phone"
                value={form.phone}
                onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="customer-address">{t("fields.address")}</Label>
            <Textarea
              id="customer-address"
              value={form.address}
              onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))}
              rows={3}
            />
          </div>
          {formErrors.length ? (
            <div className="border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
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
