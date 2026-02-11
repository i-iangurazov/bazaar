"use client";

import { useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SelectionToolbar } from "@/components/selection-toolbar";
import { ResponsiveDataList } from "@/components/responsive-data-list";
import { RowActions } from "@/components/row-actions";
import { useToast } from "@/components/ui/toast";
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

const SuppliersPage = () => {
  const t = useTranslations("suppliers");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const { data: session } = useSession();
  const role = session?.user?.role;
  const canManage = role === "ADMIN" || role === "MANAGER";
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();
  const suppliersQuery = trpc.suppliers.list.useQuery();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const schema = useMemo(
    () =>
      z.object({
        name: z.string().min(1, t("nameRequired")),
        email: z.string().email(t("emailInvalid")).optional().or(z.literal("")),
        phone: z.string().optional(),
        notes: z.string().optional(),
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
  });
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

  const handleSubmit = (values: z.infer<typeof schema>) => {
    if (editingId) {
      updateMutation.mutate({
        supplierId: editingId,
        name: values.name,
        email: values.email,
        phone: values.phone,
        notes: values.notes,
      });
      return;
    }
    createMutation.mutate({
      name: values.name,
      email: values.email,
      phone: values.phone,
      notes: values.notes,
    });
  };

  const selectedSuppliers = useMemo(
    () => (suppliersQuery.data ?? []).filter((supplier) => selectedIds.has(supplier.id)),
    [suppliersQuery.data, selectedIds],
  );
  const allSelected =
    Boolean(suppliersQuery.data?.length) &&
    selectedIds.size === (suppliersQuery.data?.length ?? 0);

  const toggleSelectAll = () => {
    if (!suppliersQuery.data?.length) {
      return;
    }
    setSelectedIds(() => {
      if (allSelected) {
        return new Set();
      }
      return new Set(suppliersQuery.data.map((supplier) => supplier.id));
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
      toast({ variant: "success", description: t("bulkDeleteSuccess", { count: selectedSuppliers.length }) });
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
            setFormOpen(open);
            if (!open) {
              setEditingId(null);
              form.reset();
            }
          }}
          title={editingId ? t("editSupplier") : t("newSupplier")}
        >
          <Form {...form}>
            <form className="space-y-4" onSubmit={form.handleSubmit(handleSubmit)}>
              <FormGrid>
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("name")}</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder={t("namePlaceholder")} />
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
                        <Input {...field} type="email" placeholder={t("emailPlaceholder")} />
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
                        <Input {...field} placeholder={t("phonePlaceholder")} />
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
                        <Textarea {...field} rows={3} placeholder={t("notesPlaceholder")} />
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
                  onClick={() => setFormOpen(false)}
                >
                  {tCommon("cancel")}
                </Button>
              </FormActions>
              {createMutation.error || updateMutation.error ? (
                <p className="text-sm text-red-500">
                  {translateError(tErrors, createMutation.error ?? updateMutation.error)}
                </p>
              ) : null}
            </form>
          </Form>
        </Modal>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("directory")}</CardTitle>
        </CardHeader>
        <CardContent>
          {canManage && (suppliersQuery.data?.length ?? 0) > 0 ? (
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
            items={suppliersQuery.data ?? []}
            getKey={(supplier) => supplier.id}
            renderDesktop={(visibleItems) => (
              <div className="overflow-x-auto">
                <TooltipProvider>
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
                          <TableCell className="font-medium">{supplier.name}</TableCell>
                          <TableCell className="text-xs text-gray-500 hidden sm:table-cell">
                            {supplier.email ?? tCommon("notAvailable")}
                          </TableCell>
                          <TableCell className="text-xs text-gray-500 hidden sm:table-cell">
                            {supplier.phone ?? tCommon("notAvailable")}
                          </TableCell>
                          <TableCell className="text-xs text-gray-500 hidden md:table-cell">
                            {supplier.notes ?? tCommon("notAvailable")}
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
                                        if (!(await confirm({ description: t("confirmDelete"), confirmVariant: "danger" }))) {
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
                        if (!(await confirm({ description: t("confirmDelete"), confirmVariant: "danger" }))) {
                          return;
                        }
                        deleteMutation.mutate({ supplierId: supplier.id });
                      },
                    },
                  ]
                : [];

              return (
                <div className="rounded-md border border-gray-200 bg-white p-3">
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
                        <p className="truncate text-sm font-medium text-ink">{supplier.name}</p>
                        <p className="text-xs text-gray-500">
                          {supplier.email ?? tCommon("notAvailable")}
                        </p>
                        <p className="text-xs text-gray-500">
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
                    <p className="mt-2 text-xs text-gray-500">{supplier.notes}</p>
                  ) : null}
                </div>
              );
            }}
          />
          {suppliersQuery.isLoading ? (
            <div className="mt-4 flex items-center gap-2 text-sm text-gray-500">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : !suppliersQuery.data?.length ? (
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-gray-500">
              <div className="flex items-center gap-2">
                <EmptyIcon className="h-4 w-4" aria-hidden />
                {t("noSuppliers")}
              </div>
            </div>
          ) : null}
          {suppliersQuery.error ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-red-500">
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
          ) : null}
        </CardContent>
      </Card>
      {confirmDialog}
    </div>
  );
};

export default SuppliersPage;
