"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Modal } from "@/components/ui/modal";
import { FormActions, FormGrid, FormSection } from "@/components/form-layout";
import { useToast } from "@/components/ui/toast";
import {
  EmptyIcon,
  StatusSuccessIcon,
  StatusWarningIcon,
  MoreIcon,
  ViewIcon,
  EditIcon,
  AdjustIcon,
} from "@/components/icons";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ResponsiveDataList } from "@/components/responsive-data-list";
import { RowActions } from "@/components/row-actions";
import { InlineEditableCell, InlineEditTableProvider } from "@/components/table/InlineEditableCell";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { isInlineEditingEnabled } from "@/lib/inlineEdit/featureFlag";
import { inlineEditRegistry, type InlineMutationOperation } from "@/lib/inlineEdit/registry";

const StoresPage = () => {
  const t = useTranslations("stores");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { data: session } = useSession();
  const role = session?.user?.role;
  const canManage = role === "ADMIN" || role === "MANAGER";
  const isAdmin = role === "ADMIN";
  const router = useRouter();
  const pathname = usePathname() ?? "/stores";
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const trpcUtils = trpc.useUtils();
  const storesQuery = trpc.stores.list.useQuery();
  const inlineEditingEnabled = isInlineEditingEnabled();

  type Store = NonNullable<typeof storesQuery.data>[number];

  const resolveComplianceBadge = (store: Store) => {
    const profile = store.complianceProfile;
    if (!profile) {
      return {
        variant: "muted" as const,
        icon: null,
        label: t("complianceDisabled"),
      };
    }
    const enabled =
      profile.enableKkm || profile.enableEsf || profile.enableEttn || profile.enableMarking;
    if (!enabled) {
      return {
        variant: "muted" as const,
        icon: null,
        label: t("complianceDisabled"),
      };
    }
    const needsSetup =
      profile.enableKkm && profile.kkmMode === "ADAPTER" && !profile.kkmProviderKey;
    if (needsSetup) {
      return {
        variant: "warning" as const,
        icon: <StatusWarningIcon className="h-3 w-3" aria-hidden />,
        label: t("complianceNeedsSetup"),
      };
    }
    return {
      variant: "success" as const,
      icon: <StatusSuccessIcon className="h-3 w-3" aria-hidden />,
      label: t("complianceReady"),
    };
  };

  const [editingStore, setEditingStore] = useState<Store | null>(null);
  const [storeDialogOpen, setStoreDialogOpen] = useState(false);
  const [viewingStore, setViewingStore] = useState<Store | null>(null);

  const storeSchema = useMemo(
    () =>
      z.object({
        name: z.string().min(1, t("nameRequired")),
        code: z.string().min(1, t("codeRequired")),
        allowNegativeStock: z.boolean(),
        trackExpiryLots: z.boolean(),
        legalEntityType: z.enum(["IP", "OSOO", "AO", "OTHER"]).optional().or(z.literal("")),
        legalName: z.string().optional(),
        inn: z
          .string()
          .optional()
          .refine((value) => !value || /^\d{10,14}$/.test(value), {
            message: t("innInvalid"),
          }),
        address: z.string().optional(),
        phone: z.string().optional(),
      }),
    [t],
  );

  const storeForm = useForm<z.infer<typeof storeSchema>>({
    resolver: zodResolver(storeSchema),
    defaultValues: {
      name: "",
      code: "",
      allowNegativeStock: false,
      trackExpiryLots: false,
      legalEntityType: "",
      legalName: "",
      inn: "",
      address: "",
      phone: "",
    },
  });

  const legalTypeLabels = useMemo(
    () => ({
      IP: t("legalTypeIp"),
      OSOO: t("legalTypeOsoo"),
      AO: t("legalTypeAo"),
      OTHER: t("legalTypeOther"),
    }),
    [t],
  );

  const createMutation = trpc.stores.create.useMutation({
    onSuccess: () => {
      storesQuery.refetch();
      toast({ variant: "success", description: t("createSuccess") });
      storeForm.reset();
      setStoreDialogOpen(false);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const updateMutation = trpc.stores.update.useMutation({
    onSuccess: () => {
      storesQuery.refetch();
      toast({ variant: "success", description: t("updateSuccess") });
      setEditingStore(null);
      setStoreDialogOpen(false);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const updateLegalMutation = trpc.stores.updateLegalDetails.useMutation({
    onSuccess: () => {
      storesQuery.refetch();
      toast({ variant: "success", description: t("legalUpdateSuccess") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const updatePolicyMutation = trpc.stores.updatePolicy.useMutation({
    onSuccess: () => {
      storesQuery.refetch();
      toast({ variant: "success", description: t("policyUpdateSuccess") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });
  const inlineUpdateMutation = trpc.stores.update.useMutation();
  const inlineUpdateLegalMutation = trpc.stores.updateLegalDetails.useMutation();
  const inlineUpdatePolicyMutation = trpc.stores.updatePolicy.useMutation();

  const applyStoreListPatch = useCallback(
    (
      storeId: string,
      patch: (store: NonNullable<typeof storesQuery.data>[number]) => NonNullable<typeof storesQuery.data>[number],
    ) => {
      trpcUtils.stores.list.setData(undefined, (current) => {
        if (!current) {
          return current;
        }
        return current.map((store) => (store.id === storeId ? patch(store) : store));
      });
    },
    [storesQuery, trpcUtils.stores.list],
  );

  const executeInlineStoreMutation = useCallback(
    async (operation: InlineMutationOperation) => {
      const previous = trpcUtils.stores.list.getData();
      const rollback = () => {
        trpcUtils.stores.list.setData(undefined, previous);
      };

      if (operation.route === "stores.update") {
        applyStoreListPatch(operation.input.storeId, (store) => ({
          ...store,
          name: operation.input.name,
          code: operation.input.code,
        }));
        try {
          await inlineUpdateMutation.mutateAsync(operation.input);
        } catch (error) {
          rollback();
          throw error;
        }
        await trpcUtils.stores.list.invalidate();
        return;
      }

      if (operation.route === "stores.updatePolicy") {
        applyStoreListPatch(operation.input.storeId, (store) => ({
          ...store,
          allowNegativeStock: operation.input.allowNegativeStock,
          trackExpiryLots: operation.input.trackExpiryLots,
        }));
        try {
          await inlineUpdatePolicyMutation.mutateAsync(operation.input);
        } catch (error) {
          rollback();
          throw error;
        }
        await trpcUtils.stores.list.invalidate();
        return;
      }

      if (operation.route === "stores.updateLegalDetails") {
        applyStoreListPatch(operation.input.storeId, (store) => ({
          ...store,
          legalEntityType: operation.input.legalEntityType,
          legalName: operation.input.legalName,
          inn: operation.input.inn,
          address: operation.input.address,
          phone: operation.input.phone,
        }));
        try {
          await inlineUpdateLegalMutation.mutateAsync(operation.input);
        } catch (error) {
          rollback();
          throw error;
        }
        await trpcUtils.stores.list.invalidate();
        return;
      }

      throw new Error(`Unsupported inline operation: ${operation.route}`);
    },
    [
      applyStoreListPatch,
      inlineUpdateLegalMutation,
      inlineUpdateMutation,
      inlineUpdatePolicyMutation,
      trpcUtils.stores.list,
    ],
  );

  const openCreateDialog = useCallback(() => {
    setEditingStore(null);
    storeForm.reset({
      name: "",
      code: "",
      allowNegativeStock: false,
      trackExpiryLots: false,
      legalEntityType: "",
      legalName: "",
      inn: "",
      address: "",
      phone: "",
    });
    setStoreDialogOpen(true);
  }, [storeForm]);

  useEffect(() => {
    if (searchParams.get("create") !== "1") {
      return;
    }

    if (canManage) {
      openCreateDialog();
    }

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("create");
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }, [canManage, openCreateDialog, pathname, router, searchParams]);

  const openEditDialog = (store: Store) => {
    setEditingStore(store);
    storeForm.reset({
      name: store.name,
      code: store.code,
      allowNegativeStock: store.allowNegativeStock,
      trackExpiryLots: store.trackExpiryLots,
      legalEntityType: store.legalEntityType ?? "",
      legalName: store.legalName ?? "",
      inn: store.inn ?? "",
      address: store.address ?? "",
      phone: store.phone ?? "",
    });
    setStoreDialogOpen(true);
  };

  const legalDisabled = !isAdmin;
  const isSaving =
    createMutation.isLoading ||
    updateMutation.isLoading ||
    updatePolicyMutation.isLoading ||
    updateLegalMutation.isLoading;

  return (
    <div>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          canManage ? (
            <Button className="w-full sm:w-auto" onClick={openCreateDialog}>
              {t("addStore")}
            </Button>
          ) : null
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveDataList
            items={storesQuery.data ?? []}
            getKey={(store) => store.id}
            renderDesktop={(visibleItems) => (
              <div className="overflow-x-auto">
                <TooltipProvider>
                  <InlineEditTableProvider>
                    <Table className="min-w-[760px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("name")}</TableHead>
                        <TableHead className="hidden sm:table-cell">{t("code")}</TableHead>
                        <TableHead className="hidden md:table-cell">{t("legalType")}</TableHead>
                        <TableHead className="hidden lg:table-cell">{t("inn")}</TableHead>
                        <TableHead>{t("allowNegativeStock")}</TableHead>
                        <TableHead className="hidden md:table-cell">{t("trackExpiryLots")}</TableHead>
                        <TableHead className="hidden lg:table-cell">{t("complianceStatus")}</TableHead>
                        <TableHead>{tCommon("actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleItems.map((store) => {
                        const isUpdating =
                          updatePolicyMutation.isLoading &&
                          updatePolicyMutation.variables?.storeId === store.id;
                        const complianceBadge = resolveComplianceBadge(store);
                        return (
                          <TableRow key={store.id}>
                            <TableCell className="font-medium">
                              <InlineEditableCell
                                rowId={store.id}
                                row={store}
                                value={store.name}
                                definition={inlineEditRegistry.stores.name}
                                context={{}}
                                role={role}
                                locale={locale}
                                columnLabel={t("name")}
                                tTable={t}
                                tCommon={tCommon}
                                enabled={inlineEditingEnabled}
                                executeMutation={executeInlineStoreMutation}
                              />
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground hidden sm:table-cell">
                              <InlineEditableCell
                                rowId={store.id}
                                row={store}
                                value={store.code}
                                definition={inlineEditRegistry.stores.code}
                                context={{}}
                                role={role}
                                locale={locale}
                                columnLabel={t("code")}
                                tTable={t}
                                tCommon={tCommon}
                                enabled={inlineEditingEnabled}
                                executeMutation={executeInlineStoreMutation}
                              />
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground hidden md:table-cell">
                              <InlineEditableCell
                                rowId={store.id}
                                row={store}
                                value={store.legalEntityType}
                                definition={inlineEditRegistry.stores.legalEntityType}
                                context={{}}
                                role={role}
                                locale={locale}
                                columnLabel={t("legalType")}
                                tTable={t}
                                tCommon={tCommon}
                                enabled={inlineEditingEnabled}
                                executeMutation={executeInlineStoreMutation}
                              />
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground hidden lg:table-cell">
                              <InlineEditableCell
                                rowId={store.id}
                                row={store}
                                value={store.inn}
                                definition={inlineEditRegistry.stores.inn}
                                context={{}}
                                role={role}
                                locale={locale}
                                columnLabel={t("inn")}
                                tTable={t}
                                tCommon={tCommon}
                                enabled={inlineEditingEnabled}
                                executeMutation={executeInlineStoreMutation}
                              />
                            </TableCell>
                            <TableCell>
                              <InlineEditableCell
                                rowId={store.id}
                                row={store}
                                value={store.allowNegativeStock}
                                definition={inlineEditRegistry.stores.allowNegativeStock}
                                context={{}}
                                role={role}
                                locale={locale}
                                columnLabel={t("allowNegativeStock")}
                                tTable={t}
                                tCommon={tCommon}
                                enabled={inlineEditingEnabled}
                                executeMutation={executeInlineStoreMutation}
                              />
                            </TableCell>
                            <TableCell className="hidden md:table-cell">
                              <InlineEditableCell
                                rowId={store.id}
                                row={store}
                                value={store.trackExpiryLots}
                                definition={inlineEditRegistry.stores.trackExpiryLots}
                                context={{}}
                                role={role}
                                locale={locale}
                                columnLabel={t("trackExpiryLots")}
                                tTable={t}
                                tCommon={tCommon}
                                enabled={inlineEditingEnabled}
                                executeMutation={executeInlineStoreMutation}
                              />
                            </TableCell>
                            <TableCell className="hidden lg:table-cell">
                              <Badge variant={complianceBadge.variant}>
                                {complianceBadge.icon}
                                {complianceBadge.label}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {canManage ? (
                                <DropdownMenu>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="inline-flex">
                                        <DropdownMenuTrigger asChild>
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="shadow-none"
                                            aria-label={tCommon("actions")}
                                          >
                                            <MoreIcon className="h-4 w-4" aria-hidden />
                                          </Button>
                                        </DropdownMenuTrigger>
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent>{tCommon("actions")}</TooltipContent>
                                  </Tooltip>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onSelect={() => setViewingStore(store)}>
                                      {tCommon("view")}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem asChild>
                                      <Link href={`/stores/${store.id}/compliance`}>
                                        {t("complianceSettings")}
                                      </Link>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onSelect={() => openEditDialog(store)}>
                                      {t("edit")}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onSelect={() =>
                                        updatePolicyMutation.mutate({
                                          storeId: store.id,
                                          allowNegativeStock: !store.allowNegativeStock,
                                          trackExpiryLots: store.trackExpiryLots,
                                        })
                                      }
                                      disabled={isUpdating}
                                    >
                                      {isUpdating ? <Spinner className="h-3 w-3" /> : null}
                                      {isUpdating
                                        ? tCommon("loading")
                                        : store.allowNegativeStock
                                        ? t("disableNegative")
                                        : t("enableNegative")}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onSelect={() =>
                                        updatePolicyMutation.mutate({
                                          storeId: store.id,
                                          allowNegativeStock: store.allowNegativeStock,
                                          trackExpiryLots: !store.trackExpiryLots,
                                        })
                                      }
                                      disabled={isUpdating}
                                    >
                                      {isUpdating ? <Spinner className="h-3 w-3" /> : null}
                                      {isUpdating
                                        ? tCommon("loading")
                                        : store.trackExpiryLots
                                          ? t("disableExpiryLots")
                                          : t("enableExpiryLots")}
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              ) : (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="shadow-none"
                                      aria-label={tCommon("view")}
                                      onClick={() => setViewingStore(store)}
                                    >
                                      <ViewIcon className="h-4 w-4" aria-hidden />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>{tCommon("view")}</TooltipContent>
                                </Tooltip>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  </InlineEditTableProvider>
                </TooltipProvider>
              </div>
            )}
            renderMobile={(store) => {
              const complianceBadge = resolveComplianceBadge(store);
              const isUpdating =
                updatePolicyMutation.isLoading &&
                updatePolicyMutation.variables?.storeId === store.id;
              const actions = [
                {
                  key: "view",
                  label: tCommon("view"),
                  icon: ViewIcon,
                  onSelect: () => setViewingStore(store),
                },
                ...(canManage
                  ? [
                      {
                        key: "compliance",
                        label: t("complianceSettings"),
                        icon: AdjustIcon,
                        href: `/stores/${store.id}/compliance`,
                      },
                      {
                        key: "edit",
                        label: t("edit"),
                        icon: EditIcon,
                        onSelect: () => openEditDialog(store),
                      },
                      {
                        key: "toggle-negative",
                        label: store.allowNegativeStock ? t("disableNegative") : t("enableNegative"),
                        icon: StatusWarningIcon,
                        disabled: isUpdating,
                        onSelect: () =>
                          updatePolicyMutation.mutate({
                            storeId: store.id,
                            allowNegativeStock: !store.allowNegativeStock,
                            trackExpiryLots: store.trackExpiryLots,
                          }),
                      },
                      {
                        key: "toggle-expiry",
                        label: store.trackExpiryLots ? t("disableExpiryLots") : t("enableExpiryLots"),
                        icon: StatusWarningIcon,
                        disabled: isUpdating,
                        onSelect: () =>
                          updatePolicyMutation.mutate({
                            storeId: store.id,
                            allowNegativeStock: store.allowNegativeStock,
                            trackExpiryLots: !store.trackExpiryLots,
                          }),
                      },
                    ]
                  : []),
              ];

              return (
                <div className="rounded-md border border-border bg-card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{store.name}</p>
                      <p className="text-xs text-muted-foreground">{store.code}</p>
                    </div>
                    <RowActions
                      actions={actions}
                      maxInline={1}
                      moreLabel={tCommon("tooltips.moreActions")}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge variant={store.allowNegativeStock ? "success" : "warning"}>
                      {store.allowNegativeStock ? (
                        <StatusSuccessIcon className="h-3 w-3" aria-hidden />
                      ) : (
                        <StatusWarningIcon className="h-3 w-3" aria-hidden />
                      )}
                      {store.allowNegativeStock ? tCommon("yes") : tCommon("no")}
                    </Badge>
                    <Badge variant={store.trackExpiryLots ? "success" : "warning"}>
                      {store.trackExpiryLots ? (
                        <StatusSuccessIcon className="h-3 w-3" aria-hidden />
                      ) : (
                        <StatusWarningIcon className="h-3 w-3" aria-hidden />
                      )}
                      {store.trackExpiryLots ? tCommon("yes") : tCommon("no")}
                    </Badge>
                    <Badge variant={complianceBadge.variant}>
                      {complianceBadge.icon}
                      {complianceBadge.label}
                    </Badge>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {store.legalEntityType ? legalTypeLabels[store.legalEntityType] : tCommon("notAvailable")}
                    {store.inn ? ` · ${store.inn}` : ""}
                  </div>
                </div>
              );
            }}
          />
          {storesQuery.isLoading ? (
            <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : !storesQuery.data?.length ? (
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <EmptyIcon className="h-4 w-4" aria-hidden />
                {t("noStores")}
              </div>
            </div>
          ) : null}
          {storesQuery.error ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-danger">
              <span>{translateError(tErrors, storesQuery.error)}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => storesQuery.refetch()}
              >
                {tErrors("tryAgain")}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Modal
        open={storeDialogOpen}
        onOpenChange={setStoreDialogOpen}
        title={editingStore ? t("editStore") : t("addStore")}
        subtitle={editingStore?.code ?? t("storeFormHint")}
      >
        <Form {...storeForm}>
          <form
            className="flex flex-col gap-3 sm:gap-4"
            onSubmit={storeForm.handleSubmit(async (values) => {
              const normalized = {
                name: values.name.trim(),
                code: values.code.trim().toUpperCase(),
                allowNegativeStock: values.allowNegativeStock,
                trackExpiryLots: values.trackExpiryLots,
                legalEntityType: values.legalEntityType
                  ? (values.legalEntityType as "IP" | "OSOO" | "AO" | "OTHER")
                  : null,
                legalName: values.legalName?.trim() || null,
                inn: values.inn?.trim() || null,
                address: values.address?.trim() || null,
                phone: values.phone?.trim() || null,
              };

              if (editingStore) {
                const tasks: Promise<unknown>[] = [];
                const nameChanged = normalized.name !== editingStore.name;
                const codeChanged = normalized.code !== editingStore.code;
                const policyChanged =
                  normalized.allowNegativeStock !== editingStore.allowNegativeStock ||
                  normalized.trackExpiryLots !== editingStore.trackExpiryLots;
                const legalChanged =
                  isAdmin &&
                  ((normalized.legalEntityType ?? null) !==
                    (editingStore.legalEntityType ?? null) ||
                    (normalized.legalName ?? "") !== (editingStore.legalName ?? "") ||
                    (normalized.inn ?? "") !== (editingStore.inn ?? "") ||
                    (normalized.address ?? "") !== (editingStore.address ?? "") ||
                    (normalized.phone ?? "") !== (editingStore.phone ?? ""));

                if (nameChanged || codeChanged) {
                  tasks.push(
                    updateMutation.mutateAsync({
                      storeId: editingStore.id,
                      name: normalized.name,
                      code: normalized.code,
                    }),
                  );
                }
                if (policyChanged) {
                  tasks.push(
                    updatePolicyMutation.mutateAsync({
                      storeId: editingStore.id,
                      allowNegativeStock: normalized.allowNegativeStock,
                      trackExpiryLots: normalized.trackExpiryLots,
                    }),
                  );
                }
                if (legalChanged) {
                  tasks.push(
                    updateLegalMutation.mutateAsync({
                      storeId: editingStore.id,
                      legalEntityType: normalized.legalEntityType,
                      legalName: normalized.legalName,
                      inn: normalized.inn,
                      address: normalized.address,
                      phone: normalized.phone,
                    }),
                  );
                }

                if (!tasks.length) {
                  setEditingStore(null);
                  setStoreDialogOpen(false);
                  return;
                }

                try {
                  await Promise.all(tasks);
                  setEditingStore(null);
                  setStoreDialogOpen(false);
                } catch {
                  // Errors are handled by mutation onError toasts.
                }
                return;
              }

              createMutation.mutate({
                name: normalized.name,
                code: normalized.code,
                allowNegativeStock: normalized.allowNegativeStock,
                trackExpiryLots: normalized.trackExpiryLots,
                legalEntityType: normalized.legalEntityType,
                legalName: normalized.legalName,
                inn: normalized.inn,
                address: normalized.address,
                phone: normalized.phone,
              });
            })}
          >
            <FormSection title={t("sectionBasic")}>
              <FormGrid>
                <FormField
                  control={storeForm.control}
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
                  control={storeForm.control}
                  name="code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("code")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder={t("codePlaceholder")}
                          maxLength={16}
                          autoCapitalize="characters"
                          onChange={(event) =>
                            field.onChange(event.target.value.toUpperCase())
                          }
                        />
                      </FormControl>
                      <FormDescription>{t("codeHint")}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </FormGrid>
            </FormSection>

            <FormSection title={t("sectionPolicy")}>
              <FormField
                control={storeForm.control}
                name="allowNegativeStock"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
                      <div className="space-y-1">
                        <FormLabel>{t("allowNegativeStock")}</FormLabel>
                        <FormDescription>{t("allowNegativeHint")}</FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={storeForm.control}
                name="trackExpiryLots"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
                      <div className="space-y-1">
                        <FormLabel>{t("trackExpiryLots")}</FormLabel>
                        <FormDescription>{t("trackExpiryHint")}</FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </FormSection>

            <FormSection
              title={t("sectionLegal")}
              description={!isAdmin ? t("legalAdminOnly") : undefined}
            >
              <FormGrid>
                <FormField
                  control={storeForm.control}
                  name="legalEntityType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("legalType")}</FormLabel>
                      <Select
                        value={field.value || "none"}
                        onValueChange={(value) =>
                          field.onChange(value === "none" ? "" : value)
                        }
                        disabled={legalDisabled}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={t("legalTypePlaceholder")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">{tCommon("notAvailable")}</SelectItem>
                          <SelectItem value="IP">{legalTypeLabels.IP}</SelectItem>
                          <SelectItem value="OSOO">{legalTypeLabels.OSOO}</SelectItem>
                          <SelectItem value="AO">{legalTypeLabels.AO}</SelectItem>
                          <SelectItem value="OTHER">{legalTypeLabels.OTHER}</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={storeForm.control}
                  name="legalName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("legalName")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder={t("legalNamePlaceholder")}
                          disabled={legalDisabled}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={storeForm.control}
                  name="inn"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("inn")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          inputMode="numeric"
                          pattern="[0-9]*"
                          placeholder={t("innPlaceholder")}
                          disabled={legalDisabled}
                          onChange={(event) =>
                            field.onChange(event.target.value.replace(/\D/g, ""))
                          }
                        />
                      </FormControl>
                      <FormDescription>{t("innHint")}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={storeForm.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("phone")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder={t("phonePlaceholder")}
                          disabled={legalDisabled}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={storeForm.control}
                  name="address"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>{t("address")}</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          rows={3}
                          placeholder={t("addressPlaceholder")}
                          disabled={legalDisabled}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </FormGrid>
            </FormSection>

            <FormActions>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStoreDialogOpen(false)}
              >
                {tCommon("cancel")}
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? <Spinner className="h-4 w-4" /> : null}
                {isSaving
                  ? tCommon("loading")
                  : editingStore
                    ? t("save")
                    : t("create")}
              </Button>
            </FormActions>
          </form>
        </Form>
      </Modal>

      <Modal
        open={Boolean(viewingStore)}
        onOpenChange={(open) => {
          if (!open) {
            setViewingStore(null);
          }
        }}
        title={t("viewStore")}
        subtitle={viewingStore?.name}
      >
        <div className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <p className="text-xs text-muted-foreground">{t("code")}</p>
            <p className="font-medium">{viewingStore?.code ?? tCommon("notAvailable")}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("allowNegativeStock")}</p>
            <Badge variant={viewingStore?.allowNegativeStock ? "success" : "warning"}>
              {viewingStore?.allowNegativeStock ? tCommon("yes") : tCommon("no")}
            </Badge>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("trackExpiryLots")}</p>
            <Badge variant={viewingStore?.trackExpiryLots ? "success" : "warning"}>
              {viewingStore?.trackExpiryLots ? tCommon("yes") : tCommon("no")}
            </Badge>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("legalType")}</p>
            <p className="font-medium">
              {viewingStore?.legalEntityType
                ? legalTypeLabels[viewingStore.legalEntityType]
                : tCommon("notAvailable")}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("legalName")}</p>
            <p className="font-medium">{viewingStore?.legalName ?? tCommon("notAvailable")}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("inn")}</p>
            <p className="font-medium">{viewingStore?.inn ?? tCommon("notAvailable")}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("phone")}</p>
            <p className="font-medium">{viewingStore?.phone ?? tCommon("notAvailable")}</p>
          </div>
          <div className="sm:col-span-2">
            <p className="text-xs text-muted-foreground">{t("address")}</p>
            <p className="font-medium">{viewingStore?.address ?? tCommon("notAvailable")}</p>
          </div>
        </div>
        <div className="mt-6 flex justify-end">
          <Button type="button" variant="ghost" onClick={() => setViewingStore(null)}>
            {tCommon("close")}
          </Button>
        </div>
      </Modal>
    </div>
  );
};

export default StoresPage;
