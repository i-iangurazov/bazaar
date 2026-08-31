"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Modal } from "@/components/ui/modal";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { FormActions, FormGrid } from "@/components/form-layout";
import { AddIcon, DeleteIcon, EditIcon, EmptyIcon, StatusSuccessIcon } from "@/components/icons";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { SelectionToolbar } from "@/components/selection-toolbar";
import { ResponsiveDataList } from "@/components/responsive-data-list";
import { RowActions } from "@/components/row-actions";
import { InlineEditableCell, InlineEditTableProvider } from "@/components/table/InlineEditableCell";
import { useToast } from "@/components/ui/toast";
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { isInlineEditingEnabled } from "@/lib/inlineEdit/featureFlag";
import { inlineEditRegistry, type InlineMutationOperation } from "@/lib/inlineEdit/registry";
import {
  normalizeSupplierMutationInput,
  SUPPLIER_EMAIL_MAX_LENGTH,
  SUPPLIER_NAME_MAX_LENGTH,
  SUPPLIER_NOTES_MAX_LENGTH,
  SUPPLIER_PHONE_MAX_LENGTH,
} from "@/lib/supplierForm";

const SuppliersPage = () => {
  const t = useTranslations("suppliers");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const { data: session } = useSession();
  const role = session?.user?.role;
  const canManage = role === "ADMIN" || role === "MANAGER";
  const router = useRouter();
  const pathname = usePathname() ?? "/suppliers";
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();
  const trpcUtils = trpc.useUtils();
  const requestedPage = Number(searchParams.get("page"));
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const requestedPageSize = Number(searchParams.get("pageSize"));
  const pageSize = [10, 25, 50, 100].includes(requestedPageSize) ? requestedPageSize : 25;
  const directoryQuery = searchParams.get("q")?.trim() ?? "";
  const [directorySearch, setDirectorySearch] = useState(directoryQuery);
  const listInput = useMemo(
    () => ({ search: directoryQuery || undefined, page, pageSize }),
    [directoryQuery, page, pageSize],
  );
  const suppliersQuery = trpc.suppliers.listPage.useQuery(listInput, {
    keepPreviousData: true,
  });
  const inlineEditingEnabled = isInlineEditingEnabled();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const submissionInFlightRef = useRef(false);
  const schema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .trim()
          .min(2, t("nameMinLength"))
          .max(SUPPLIER_NAME_MAX_LENGTH, t("nameTooLong")),
        email: z
          .string()
          .trim()
          .max(SUPPLIER_EMAIL_MAX_LENGTH, t("emailTooLong"))
          .email(t("emailInvalid"))
          .optional()
          .or(z.string().trim().length(0)),
        phone: z.string().max(SUPPLIER_PHONE_MAX_LENGTH, t("phoneTooLong")).optional(),
        notes: z.string().max(SUPPLIER_NOTES_MAX_LENGTH, t("notesTooLong")).optional(),
      }),
    [t],
  );

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      notes: "",
    },
  });
  const formIsDirty = formOpen && form.formState.isDirty;

  useEffect(() => {
    if (!formIsDirty) {
      return;
    }
    const preventUnsavedRefresh = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventUnsavedRefresh);
    return () => window.removeEventListener("beforeunload", preventUnsavedRefresh);
  }, [formIsDirty]);

  const closeSupplierForm = useCallback(() => {
    if (formIsDirty && !window.confirm(tCommon("unsavedChangesConfirm"))) {
      return false;
    }
    setEditingId(null);
    form.reset();
    setFormOpen(false);
    return true;
  }, [form, formIsDirty, tCommon]);

  const createMutation = trpc.suppliers.create.useMutation({
    onSuccess: () => {
      suppliersQuery.refetch();
      form.reset();
      setFormOpen(false);
      toast({ variant: "success", description: t("createSuccess") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
    onSettled: () => {
      submissionInFlightRef.current = false;
    },
  });

  const updateMutation = trpc.suppliers.update.useMutation({
    onSuccess: () => {
      suppliersQuery.refetch();
      setEditingId(null);
      form.reset();
      setFormOpen(false);
      toast({ variant: "success", description: t("updateSuccess") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
    onSettled: () => {
      submissionInFlightRef.current = false;
    },
  });
  const inlineUpdateMutation = trpc.suppliers.update.useMutation();
  const executeInlineSupplierMutation = useCallback(
    async (operation: InlineMutationOperation) => {
      if (operation.route !== "suppliers.update") {
        throw new Error(`Unsupported inline operation: ${operation.route}`);
      }

      const previous = trpcUtils.suppliers.listPage.getData(listInput);
      trpcUtils.suppliers.listPage.setData(listInput, (current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          items: current.items.map((supplier) =>
            supplier.id === operation.input.supplierId
              ? {
                  ...supplier,
                  name: operation.input.name,
                  email: operation.input.email ?? null,
                  phone: operation.input.phone ?? null,
                  notes: operation.input.notes ?? null,
                }
              : supplier,
          ),
        };
      });
      try {
        await inlineUpdateMutation.mutateAsync(operation.input);
      } catch (error) {
        trpcUtils.suppliers.listPage.setData(listInput, previous);
        throw error;
      }
      await trpcUtils.suppliers.listPage.invalidate();
    },
    [inlineUpdateMutation, listInput, trpcUtils.suppliers.listPage],
  );
  const deleteMutation = trpc.suppliers.delete.useMutation({
    onMutate: (variables) => {
      setDeletingId(variables.supplierId);
    },
    onSuccess: () => {
      suppliersQuery.refetch();
      toast({ variant: "success", description: t("deleteSuccess") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
    onSettled: () => {
      setDeletingId(null);
    },
  });
  const bulkDeleteMutation = trpc.suppliers.bulkDelete.useMutation();

  const replaceDirectoryParams = useCallback(
    (updates: Record<string, string | number | null>) => {
      const nextParams = new URLSearchParams(searchParams.toString());
      Object.entries(updates).forEach(([key, value]) => {
        if (value === null || value === "") {
          nextParams.delete(key);
        } else {
          nextParams.set(key, String(value));
        }
      });
      const nextQuery = nextParams.toString();
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    setDirectorySearch(directoryQuery);
  }, [directoryQuery]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const normalized = directorySearch.trim();
      if (normalized !== directoryQuery) {
        replaceDirectoryParams({ q: normalized || null, page: null });
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [directoryQuery, directorySearch, replaceDirectoryParams]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [directoryQuery, page, pageSize]);

  useEffect(() => {
    if (searchParams.get("create") !== "1") {
      return;
    }

    if (canManage) {
      setEditingId(null);
      form.reset({
        name: "",
        email: "",
        phone: "",
        notes: "",
      });
      setFormOpen(true);
    }

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("create");
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }, [canManage, form, pathname, router, searchParams]);

  const handleSubmit = (values: z.infer<typeof schema>) => {
    if (submissionInFlightRef.current) {
      return;
    }
    submissionInFlightRef.current = true;
    const input = normalizeSupplierMutationInput(values);
    if (editingId) {
      updateMutation.mutate({
        supplierId: editingId,
        ...input,
      });
      return;
    }
    createMutation.mutate(input);
  };

  const selectedSuppliers = useMemo(
    () => (suppliersQuery.data?.items ?? []).filter((supplier) => selectedIds.has(supplier.id)),
    [suppliersQuery.data, selectedIds],
  );
  const allSelected =
    Boolean(suppliersQuery.data?.items.length) &&
    selectedIds.size === (suppliersQuery.data?.items.length ?? 0);

  const toggleSelectAll = () => {
    if (!suppliersQuery.data?.items.length) {
      return;
    }
    setSelectedIds(() => {
      if (allSelected) {
        return new Set();
      }
      return new Set(suppliersQuery.data.items.map((supplier) => supplier.id));
    });
  };

  const toggleSelect = (supplierId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(supplierId)) {
        next.delete(supplierId);
      } else {
        next.add(supplierId);
      }
      return next;
    });
  };

  const handleBulkDelete = async () => {
    if (!selectedSuppliers.length) {
      return;
    }
    if (
      !(await confirm({
        description: t("confirmBulkDelete", { count: selectedSuppliers.length }),
        confirmVariant: "danger",
      }))
    ) {
      return;
    }
    try {
      await bulkDeleteMutation.mutateAsync({
        supplierIds: selectedSuppliers.map((supplier) => supplier.id),
      });
      await suppliersQuery.refetch();
      setSelectedIds(new Set());
      toast({
        variant: "success",
        description: t("bulkDeleteSuccess", { count: selectedSuppliers.length }),
      });
    } catch (error) {
      toast({
        variant: "error",
        description: translateError(tErrors, error as Parameters<typeof translateError>[1]),
      });
    }
  };

  return (
    <div>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          canManage ? (
            <Button
              className="w-full sm:w-auto"
              onClick={() => {
                setEditingId(null);
                form.reset({
                  name: "",
                  email: "",
                  phone: "",
                  notes: "",
                });
                setFormOpen(true);
              }}
            >
              <AddIcon className="h-4 w-4" aria-hidden />
              {t("addSupplier")}
            </Button>
          ) : null
        }
      />

      {canManage ? (
        <Modal
          open={formOpen}
          onOpenChange={(open) => {
            if (open) {
              setFormOpen(true);
              return;
            }
            closeSupplierForm();
          }}
          title={editingId ? t("editSupplier") : t("newSupplier")}
          className="rounded-xl"
          bodyClassName="p-4 sm:p-6"
        >
          <Form {...form}>
            <form className="space-y-4" noValidate onSubmit={form.handleSubmit(handleSubmit)}>
              <FormGrid>
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("name")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          maxLength={SUPPLIER_NAME_MAX_LENGTH}
                          placeholder={t("namePlaceholder")}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("email")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="email"
                          maxLength={SUPPLIER_EMAIL_MAX_LENGTH}
                          placeholder={t("emailPlaceholder")}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("phone")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          maxLength={SUPPLIER_PHONE_MAX_LENGTH}
                          placeholder={t("phonePlaceholder")}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>{t("notes")}</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          rows={3}
                          maxLength={SUPPLIER_NOTES_MAX_LENGTH}
                          placeholder={t("notesPlaceholder")}
                        />
                      </FormControl>
                      <FormDescription>{t("notesHint")}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </FormGrid>
              <FormActions>
                <Button
                  className="w-full sm:w-auto"
                  type="submit"
                  disabled={createMutation.isLoading || updateMutation.isLoading}
                >
                  {createMutation.isLoading || updateMutation.isLoading ? (
                    <Spinner className="h-4 w-4" />
                  ) : editingId ? (
                    <StatusSuccessIcon className="h-4 w-4" aria-hidden />
                  ) : (
                    <AddIcon className="h-4 w-4" aria-hidden />
                  )}
                  {createMutation.isLoading || updateMutation.isLoading
                    ? tCommon("loading")
                    : editingId
                      ? t("saveSupplier")
                      : t("createSupplier")}
                </Button>
                <Button
                  variant="ghost"
                  className="w-full sm:w-auto"
                  type="button"
                  onClick={closeSupplierForm}
                >
                  {tCommon("cancel")}
                </Button>
              </FormActions>
              {createMutation.error || updateMutation.error ? (
                <p className="text-sm text-danger">
                  {translateError(tErrors, createMutation.error ?? updateMutation.error)}
                </p>
              ) : null}
            </form>
          </Form>
        </Modal>
      ) : null}

      <Card className="bazaar-admin-surface overflow-hidden">
        <CardHeader>
          <CardTitle>{t("directory")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 max-w-xl">
            <Input
              type="search"
              value={directorySearch}
              onChange={(event) => setDirectorySearch(event.target.value)}
              placeholder={tCommon("search")}
              aria-label={tCommon("search")}
            />
          </div>
          {canManage && (suppliersQuery.data?.items.length ?? 0) > 0 ? (
            <div className="mb-3 sm:hidden">
              <div className="flex flex-wrap items-center gap-2">
                {!allSelected ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    onClick={toggleSelectAll}
                  >
                    {t("selectAll")}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
          {canManage && selectedSuppliers.length ? (
            <div className="mb-3">
              <TooltipProvider>
                <SelectionToolbar
                  count={selectedSuppliers.length}
                  label={tCommon("selectedCount", { count: selectedSuppliers.length })}
                  clearLabel={tCommon("clearSelection")}
                  onClear={() => setSelectedIds(new Set())}
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-danger shadow-none hover:text-danger"
                        aria-label={t("bulkDelete")}
                        onClick={handleBulkDelete}
                        disabled={bulkDeleteMutation.isLoading}
                      >
                        {bulkDeleteMutation.isLoading ? (
                          <Spinner className="h-4 w-4" />
                        ) : (
                          <DeleteIcon className="h-4 w-4" aria-hidden />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("bulkDelete")}</TooltipContent>
                  </Tooltip>
                </SelectionToolbar>
              </TooltipProvider>
            </div>
          ) : null}
          <ResponsiveDataList
            key={`suppliers-${pageSize}`}
            items={suppliersQuery.data?.items ?? []}
            getKey={(supplier) => supplier.id}
            page={page}
            totalItems={suppliersQuery.data?.total ?? 0}
            defaultPageSize={pageSize}
            onPageChange={(nextPage) =>
              replaceDirectoryParams({ page: nextPage > 1 ? nextPage : null })
            }
            onPageSizeChange={(nextPageSize) =>
              replaceDirectoryParams({
                pageSize: nextPageSize === 25 ? null : nextPageSize,
                page: null,
              })
            }
            scrollToTopOnPageChange
            renderDesktop={(visibleItems) => (
              <div className="bazaar-admin-table-shell bazaar-admin-table-scroll">
                <TooltipProvider>
                  <InlineEditTableProvider>
                    <Table className="min-w-[560px]">
                      <TableHeader>
                        <TableRow>
                          {canManage ? (
                            <TableHead className="w-10">
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-border bg-background text-primary accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                                checked={allSelected}
                                onChange={toggleSelectAll}
                                aria-label={t("selectAll")}
                              />
                            </TableHead>
                          ) : null}
                          <TableHead>{t("name")}</TableHead>
                          <TableHead className="hidden sm:table-cell">{t("email")}</TableHead>
                          <TableHead className="hidden sm:table-cell">{t("phone")}</TableHead>
                          <TableHead className="hidden md:table-cell">{t("notes")}</TableHead>
                          {canManage ? <TableHead>{t("actions")}</TableHead> : null}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {visibleItems.map((supplier) => (
                          <TableRow key={supplier.id}>
                            {canManage ? (
                              <TableCell>
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded border-border bg-background text-primary accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                                  checked={selectedIds.has(supplier.id)}
                                  onChange={() => toggleSelect(supplier.id)}
                                  aria-label={t("selectSupplier", { name: supplier.name })}
                                />
                              </TableCell>
                            ) : null}
                            <TableCell className="font-medium">
                              <InlineEditableCell
                                rowId={supplier.id}
                                row={supplier}
                                value={supplier.name}
                                definition={inlineEditRegistry.suppliers.name}
                                context={{}}
                                role={role}
                                locale={locale}
                                columnLabel={t("name")}
                                tTable={t}
                                tCommon={tCommon}
                                enabled={inlineEditingEnabled}
                                executeMutation={executeInlineSupplierMutation}
                              />
                            </TableCell>
                            <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                              <InlineEditableCell
                                rowId={supplier.id}
                                row={supplier}
                                value={supplier.email}
                                definition={inlineEditRegistry.suppliers.email}
                                context={{}}
                                role={role}
                                locale={locale}
                                columnLabel={t("email")}
                                tTable={t}
                                tCommon={tCommon}
                                enabled={inlineEditingEnabled}
                                executeMutation={executeInlineSupplierMutation}
                              />
                            </TableCell>
                            <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                              <InlineEditableCell
                                rowId={supplier.id}
                                row={supplier}
                                value={supplier.phone}
                                definition={inlineEditRegistry.suppliers.phone}
                                context={{}}
                                role={role}
                                locale={locale}
                                columnLabel={t("phone")}
                                tTable={t}
                                tCommon={tCommon}
                                enabled={inlineEditingEnabled}
                                executeMutation={executeInlineSupplierMutation}
                              />
                            </TableCell>
                            <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                              <InlineEditableCell
                                rowId={supplier.id}
                                row={supplier}
                                value={supplier.notes}
                                definition={inlineEditRegistry.suppliers.notes}
                                context={{}}
                                role={role}
                                locale={locale}
                                columnLabel={t("notes")}
                                tTable={t}
                                tCommon={tCommon}
                                enabled={inlineEditingEnabled}
                                executeMutation={executeInlineSupplierMutation}
                              />
                            </TableCell>
                            {canManage ? (
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="shadow-none"
                                        aria-label={tCommon("edit")}
                                        onClick={() => {
                                          setEditingId(supplier.id);
                                          form.reset({
                                            name: supplier.name,
                                            email: supplier.email ?? "",
                                            phone: supplier.phone ?? "",
                                            notes: supplier.notes ?? "",
                                          });
                                          setFormOpen(true);
                                        }}
                                      >
                                        <EditIcon className="h-4 w-4" aria-hidden />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>{tCommon("edit")}</TooltipContent>
                                  </Tooltip>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="text-danger shadow-none hover:text-danger"
                                        aria-label={tCommon("delete")}
                                        onClick={async () => {
                                          if (
                                            !(await confirm({
                                              description: t("confirmDelete"),
                                              confirmVariant: "danger",
                                            }))
                                          ) {
                                            return;
                                          }
                                          deleteMutation.mutate({ supplierId: supplier.id });
                                        }}
                                        disabled={deletingId === supplier.id}
                                      >
                                        {deletingId === supplier.id ? (
                                          <Spinner className="h-4 w-4" />
                                        ) : (
                                          <DeleteIcon className="h-4 w-4" aria-hidden />
                                        )}
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>{tCommon("delete")}</TooltipContent>
                                  </Tooltip>
                                </div>
                              </TableCell>
                            ) : null}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </InlineEditTableProvider>
                </TooltipProvider>
              </div>
            )}
            renderMobile={(supplier) => {
              const actions = canManage
                ? [
                    {
                      key: "edit",
                      label: tCommon("edit"),
                      icon: EditIcon,
                      onSelect: () => {
                        setEditingId(supplier.id);
                        form.reset({
                          name: supplier.name,
                          email: supplier.email ?? "",
                          phone: supplier.phone ?? "",
                          notes: supplier.notes ?? "",
                        });
                        setFormOpen(true);
                      },
                    },
                    {
                      key: "delete",
                      label: tCommon("delete"),
                      icon: DeleteIcon,
                      variant: "danger",
                      disabled: deletingId === supplier.id,
                      onSelect: async () => {
                        if (
                          !(await confirm({
                            description: t("confirmDelete"),
                            confirmVariant: "danger",
                          }))
                        ) {
                          return;
                        }
                        deleteMutation.mutate({ supplierId: supplier.id });
                      },
                    },
                  ]
                : [];

              return (
                <div className="bazaar-admin-mobile-card">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-2">
                      {canManage ? (
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 rounded border-border bg-background text-primary accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                          checked={selectedIds.has(supplier.id)}
                          onChange={() => toggleSelect(supplier.id)}
                          aria-label={t("selectSupplier", { name: supplier.name })}
                        />
                      ) : null}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {supplier.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {supplier.email ?? tCommon("notAvailable")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {supplier.phone ?? tCommon("notAvailable")}
                        </p>
                      </div>
                    </div>
                    {canManage ? (
                      <RowActions
                        actions={actions}
                        maxInline={1}
                        moreLabel={tCommon("tooltips.moreActions")}
                      />
                    ) : null}
                  </div>
                  {supplier.notes ? (
                    <p className="mt-2 text-xs text-muted-foreground">{supplier.notes}</p>
                  ) : null}
                </div>
              );
            }}
          />
          {suppliersQuery.isLoading ? (
            <div className="bazaar-admin-notice mt-4 flex items-center gap-2">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : suppliersQuery.error ? (
            <div className="bazaar-admin-error mt-3 flex flex-wrap items-center gap-2">
              <span>{translateError(tErrors, suppliersQuery.error)}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => suppliersQuery.refetch()}
              >
                {tErrors("tryAgain")}
              </Button>
            </div>
          ) : !suppliersQuery.data?.items.length ? (
            <div className="bazaar-admin-empty mt-4">
              <div className="flex items-center gap-2">
                <EmptyIcon className="h-4 w-4" aria-hidden />
                {t("noSuppliers")}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
      {confirmDialog}
    </div>
  );
};

export default SuppliersPage;
