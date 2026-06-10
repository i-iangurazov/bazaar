"use client";

import { useEffect, useMemo, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";

import { DeleteIcon, EditIcon, MoreIcon, RestoreIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { useToast } from "@/components/ui/toast";
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";
import { formatDateTime } from "@/lib/i18nFormat";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import type { AppRouter } from "@/server/trpc/routers/_app";

type RegisterStatusFilter = "active" | "inactive" | "all";
type RouterOutputs = inferRouterOutputs<AppRouter>;
type RegisterRow = RouterOutputs["pos"]["registers"]["list"][number];

const allStoresValue = "__all_stores__";

const PosRegistersPage = () => {
  const t = useTranslations("pos");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const { data: session } = useSession();
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();

  const canManage = session?.user?.role === "ADMIN" || session?.user?.role === "MANAGER";

  const storesQuery = trpc.stores.list.useQuery();

  const [storeFilter, setStoreFilter] = useState(allStoresValue);
  const [statusFilter, setStatusFilter] = useState<RegisterStatusFilter>("active");
  const [createStoreId, setCreateStoreId] = useState("");
  const [createName, setCreateName] = useState("");
  const [createCode, setCreateCode] = useState("");
  const [editingRegister, setEditingRegister] = useState<RegisterRow | null>(null);
  const [editStoreId, setEditStoreId] = useState("");
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);

  useEffect(() => {
    if (createStoreId || !storesQuery.data?.[0]) {
      return;
    }
    setCreateStoreId(storesQuery.data[0].id);
  }, [createStoreId, storesQuery.data]);

  const registersQuery = trpc.pos.registers.list.useQuery({
    storeId: storeFilter === allStoresValue ? undefined : storeFilter,
    status: statusFilter,
  });

  const utils = trpc.useUtils();

  const refreshRegisters = async () => {
    await Promise.all([
      registersQuery.refetch(),
      utils.pos.registers.list.invalidate(),
      utils.pos.entry.invalidate(),
    ]);
  };

  const createMutation = trpc.pos.registers.create.useMutation({
    onSuccess: async () => {
      setCreateName("");
      setCreateCode("");
      await refreshRegisters();
      toast({ variant: "success", description: t("registers.created") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const updateMutation = trpc.pos.registers.update.useMutation({
    onSuccess: async () => {
      await refreshRegisters();
      setEditingRegister(null);
      toast({ variant: "success", description: t("registers.updated") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const deleteMutation = trpc.pos.registers.delete.useMutation({
    onSuccess: async () => {
      await refreshRegisters();
      toast({ variant: "success", description: t("registers.deleted") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const visibleRegisters = useMemo(() => registersQuery.data ?? [], [registersQuery.data]);
  const activeCount = useMemo(
    () => visibleRegisters.filter((register) => register.isActive).length,
    [visibleRegisters],
  );
  const inactiveCount = visibleRegisters.length - activeCount;

  const handleCreate = async () => {
    if (!createStoreId || !createName.trim() || !createCode.trim()) {
      toast({ variant: "error", description: t("registers.fieldsRequired") });
      return;
    }

    await createMutation.mutateAsync({
      storeId: createStoreId,
      name: createName.trim(),
      code: createCode.trim(),
    });
  };

  const openEditDialog = (register: RegisterRow) => {
    setEditingRegister(register);
    setEditStoreId(register.storeId);
    setEditName(register.name);
    setEditCode(register.code);
    setEditIsActive(register.isActive);
  };

  const handleSaveEdit = async () => {
    if (!editingRegister) {
      return;
    }
    if (!editStoreId || !editName.trim() || !editCode.trim()) {
      toast({ variant: "error", description: t("registers.fieldsRequired") });
      return;
    }

    await updateMutation.mutateAsync({
      registerId: editingRegister.id,
      storeId: editStoreId,
      name: editName.trim(),
      code: editCode.trim(),
      isActive: editIsActive,
    });
  };

  const handleToggleActive = async (register: RegisterRow) => {
    const nextActive = !register.isActive;
    const accepted = await confirm({
      title: nextActive ? t("registers.activateTitle") : t("registers.deactivateTitle"),
      description: nextActive
        ? t("registers.activateConfirm", { name: register.name })
        : t("registers.deactivateConfirm", { name: register.name }),
      confirmLabel: nextActive ? t("registers.activate") : t("registers.deactivate"),
      confirmVariant: nextActive ? "primary" : "danger",
    });
    if (!accepted) {
      return;
    }

    await updateMutation.mutateAsync({
      registerId: register.id,
      isActive: nextActive,
    });
  };

  const handleDelete = async (register: RegisterRow) => {
    if (!register.canDelete) {
      toast({
        variant: "error",
        description: t("registers.deleteBlocked"),
      });
      return;
    }
    const accepted = await confirm({
      title: t("registers.deleteTitle"),
      description: t("registers.deleteConfirm", { name: register.name }),
      confirmLabel: tCommon("delete"),
      confirmVariant: "destructive",
    });
    if (!accepted) {
      return;
    }

    await deleteMutation.mutateAsync({ registerId: register.id });
  };

  const renderStatus = (register: RegisterRow) => (
    <Badge variant={register.isActive ? "success" : "muted"}>
      {register.isActive ? t("registers.statusActive") : t("registers.statusInactive")}
    </Badge>
  );

  const renderCurrentUser = (register: RegisterRow) =>
    register.openShift?.openedBy?.name ?? t("registers.unassigned");

  const renderLastUsed = (register: RegisterRow) =>
    register.lastActivityAt ? formatDateTime(register.lastActivityAt, locale) : tCommon("notAvailable");

  const renderActions = (register: RegisterRow) => {
    if (!canManage) {
      return null;
    }
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="secondary"
            size="icon"
            aria-label={tCommon("moreActions")}
            disabled={updateMutation.isLoading || deleteMutation.isLoading}
          >
            <MoreIcon className="h-4 w-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[220px]">
          <DropdownMenuItem onSelect={() => openEditDialog(register)}>
            <EditIcon className="h-4 w-4" aria-hidden />
            {tCommon("edit")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => handleToggleActive(register)}>
            <RestoreIcon className="h-4 w-4" aria-hidden />
            {register.isActive ? t("registers.deactivate") : t("registers.activate")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-danger focus:text-danger"
            onSelect={() => handleDelete(register)}
          >
            <DeleteIcon className="h-4 w-4" aria-hidden />
            {tCommon("delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t("registers.title")} subtitle={t("registers.subtitle")} />

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("registers.createTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr_0.7fr_auto] lg:items-end">
              <div className="space-y-1.5">
                <p className="text-sm font-medium">{tCommon("store")}</p>
                <Select value={createStoreId} onValueChange={setCreateStoreId}>
                  <SelectTrigger aria-label={tCommon("store")}>
                    <SelectValue placeholder={tCommon("selectStore")} />
                  </SelectTrigger>
                  <SelectContent>
                    {(storesQuery.data ?? []).map((store) => (
                      <SelectItem key={store.id} value={store.id}>
                        {store.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <p className="text-sm font-medium">{t("registers.name")}</p>
                <Input
                  value={createName}
                  onChange={(event) => setCreateName(event.target.value)}
                  maxLength={120}
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-sm font-medium">{t("registers.code")}</p>
                <Input
                  value={createCode}
                  onChange={(event) => setCreateCode(event.target.value)}
                  maxLength={32}
                />
              </div>
              <Button onClick={handleCreate} disabled={createMutation.isLoading || !createStoreId}>
                {createMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                {t("registers.create")}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle>{t("registers.listTitle")}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("registers.summary", {
                  total: visibleRegisters.length,
                  active: activeCount,
                  inactive: inactiveCount,
                })}
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(180px,240px)_auto] sm:items-center">
              <Select value={storeFilter} onValueChange={setStoreFilter}>
                <SelectTrigger aria-label={tCommon("store")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={allStoresValue}>{tCommon("allStores")}</SelectItem>
                  {(storesQuery.data ?? []).map((store) => (
                    <SelectItem key={store.id} value={store.id}>
                      {store.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="inline-flex rounded-md border border-border bg-muted p-1">
                {(["active", "inactive", "all"] as const).map((value) => (
                  <Button
                    key={value}
                    type="button"
                    variant={statusFilter === value ? "secondary" : "ghost"}
                    size="sm"
                    className="h-8 shadow-none"
                    onClick={() => setStatusFilter(value)}
                  >
                    {t(`registers.filters.${value}`)}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {registersQuery.isLoading || storesQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : null}

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[980px] border-separate border-spacing-0 text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="border-b border-border px-3 py-2 font-medium">{t("registers.name")}</th>
                  <th className="border-b border-border px-3 py-2 font-medium">{tCommon("store")}</th>
                  <th className="border-b border-border px-3 py-2 font-medium">{tCommon("status")}</th>
                  <th className="border-b border-border px-3 py-2 font-medium">
                    {t("registers.currentUser")}
                  </th>
                  <th className="border-b border-border px-3 py-2 font-medium">{t("registers.device")}</th>
                  <th className="border-b border-border px-3 py-2 font-medium">{t("registers.createdAt")}</th>
                  <th className="border-b border-border px-3 py-2 font-medium">{t("registers.lastUsed")}</th>
                  <th className="border-b border-border px-3 py-2 text-right font-medium">
                    {tCommon("actions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleRegisters.map((register) => (
                  <tr key={register.id} className="align-top">
                    <td className="border-b border-border px-3 py-3">
                      <div className="font-semibold text-foreground">{register.name}</div>
                      <div className="text-xs text-muted-foreground">{register.code}</div>
                    </td>
                    <td className="border-b border-border px-3 py-3">
                      <div className="text-foreground">{register.store.name}</div>
                      <div className="text-xs text-muted-foreground">{register.store.code}</div>
                    </td>
                    <td className="border-b border-border px-3 py-3">{renderStatus(register)}</td>
                    <td className="border-b border-border px-3 py-3 text-muted-foreground">
                      {renderCurrentUser(register)}
                    </td>
                    <td className="border-b border-border px-3 py-3 text-muted-foreground">
                      {t("registers.notTracked")}
                    </td>
                    <td className="border-b border-border px-3 py-3 text-muted-foreground">
                      {formatDateTime(register.createdAt, locale)}
                    </td>
                    <td className="border-b border-border px-3 py-3 text-muted-foreground">
                      {renderLastUsed(register)}
                    </td>
                    <td className="border-b border-border px-3 py-3 text-right">{renderActions(register)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 md:hidden">
            {visibleRegisters.map((register) => (
              <div key={register.id} className="rounded-md border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-foreground">{register.name}</p>
                    <p className="text-xs text-muted-foreground">{register.code}</p>
                  </div>
                  {renderStatus(register)}
                </div>
                <dl className="mt-4 grid gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">{tCommon("store")}</dt>
                    <dd className="font-medium text-foreground">{register.store.name}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t("registers.currentUser")}</dt>
                    <dd className="text-foreground">{renderCurrentUser(register)}</dd>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <dt className="text-xs text-muted-foreground">{t("registers.createdAt")}</dt>
                      <dd className="text-foreground">{formatDateTime(register.createdAt, locale)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">{t("registers.lastUsed")}</dt>
                      <dd className="text-foreground">{renderLastUsed(register)}</dd>
                    </div>
                  </div>
                </dl>
                {canManage ? (
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <Button variant="secondary" size="sm" onClick={() => openEditDialog(register)}>
                      {tCommon("edit")}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleToggleActive(register)}>
                      {register.isActive ? t("registers.deactivate") : t("registers.activate")}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleDelete(register)}>
                      {tCommon("delete")}
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          {!registersQuery.isLoading && !visibleRegisters.length ? (
            <p className="text-sm text-muted-foreground">{t("registers.empty")}</p>
          ) : null}
        </CardContent>
      </Card>

      <Modal
        open={Boolean(editingRegister)}
        onOpenChange={(open) => {
          if (!open) {
            setEditingRegister(null);
          }
        }}
        title={t("registers.editTitle")}
        subtitle={editingRegister ? `${editingRegister.name} (${editingRegister.code})` : undefined}
        className="max-w-2xl"
        mobileSheet
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <p className="text-sm font-medium">{t("registers.name")}</p>
              <Input value={editName} onChange={(event) => setEditName(event.target.value)} maxLength={120} />
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">{t("registers.code")}</p>
              <Input value={editCode} onChange={(event) => setEditCode(event.target.value)} maxLength={32} />
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">{tCommon("store")}</p>
              <Select
                value={editStoreId}
                onValueChange={setEditStoreId}
                disabled={Boolean(editingRegister?.hasHistory)}
              >
                <SelectTrigger aria-label={tCommon("store")}>
                  <SelectValue placeholder={tCommon("selectStore")} />
                </SelectTrigger>
                <SelectContent>
                  {(storesQuery.data ?? []).map((store) => (
                    <SelectItem key={store.id} value={store.id}>
                      {store.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {editingRegister?.hasHistory ? (
                <p className="text-xs text-muted-foreground">{t("registers.storeLockedByHistory")}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">{tCommon("status")}</p>
              <Select value={editIsActive ? "active" : "inactive"} onValueChange={(value) => setEditIsActive(value === "active")}>
                <SelectTrigger aria-label={tCommon("status")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{t("registers.statusActive")}</SelectItem>
                  <SelectItem value="inactive">{t("registers.statusInactive")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <ModalFooter>
            <Button type="button" variant="secondary" onClick={() => setEditingRegister(null)}>
              {tCommon("cancel")}
            </Button>
            <Button type="button" onClick={handleSaveEdit} disabled={updateMutation.isLoading}>
              {updateMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
              {tCommon("save")}
            </Button>
          </ModalFooter>
        </div>
      </Modal>

      {confirmDialog}
    </div>
  );
};

export default PosRegistersPage;
