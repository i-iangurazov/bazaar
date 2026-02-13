"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

const PosRegistersPage = () => {
  const t = useTranslations("pos");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const { data: session } = useSession();
  const { toast } = useToast();

  const canManage = session?.user?.role === "ADMIN" || session?.user?.role === "MANAGER";

  const storesQuery = trpc.stores.list.useQuery(undefined, {
    enabled: canManage,
  });

  const [storeId, setStoreId] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  useEffect(() => {
    if (storeId || !storesQuery.data?.[0]) {
      return;
    }
    setStoreId(storesQuery.data[0].id);
  }, [storeId, storesQuery.data]);

  const registersQuery = trpc.pos.registers.list.useQuery(
    { storeId: storeId || undefined },
    { enabled: canManage && Boolean(storeId) },
  );

  const createMutation = trpc.pos.registers.create.useMutation({
    onSuccess: async () => {
      setName("");
      setCode("");
      await registersQuery.refetch();
      toast({ variant: "success", description: t("registers.created") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const updateMutation = trpc.pos.registers.update.useMutation({
    onSuccess: async () => {
      await registersQuery.refetch();
      toast({ variant: "success", description: t("registers.updated") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const handleCreate = async () => {
    if (!storeId || !name.trim() || !code.trim()) {
      toast({ variant: "error", description: t("registers.fieldsRequired") });
      return;
    }

    await createMutation.mutateAsync({
      storeId,
      name: name.trim(),
      code: code.trim(),
    });
  };

  if (!canManage) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("registers.title")} subtitle={t("registers.subtitle")} />
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">{t("registers.forbidden")}</CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("registers.title")} subtitle={t("registers.subtitle")} />

      <Card>
        <CardHeader>
          <CardTitle>{t("registers.createTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <p className="text-sm font-medium">{tCommon("store")}</p>
              <Select value={storeId} onValueChange={setStoreId}>
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
              <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">{t("registers.code")}</p>
              <Input value={code} onChange={(event) => setCode(event.target.value)} maxLength={32} />
            </div>
          </div>

          <Button onClick={handleCreate} disabled={createMutation.isLoading || !storeId}>
            {createMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
            {t("registers.create")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("registers.listTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {registersQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : null}

          {(registersQuery.data ?? []).map((register) => (
            <div
              key={register.id}
              className="flex flex-col gap-3 rounded-md border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {register.name} ({register.code})
                </p>
                <p className="text-xs text-muted-foreground">{register.store.name}</p>
              </div>
              <Button
                variant={register.isActive ? "secondary" : "outline"}
                onClick={() =>
                  updateMutation.mutate({
                    registerId: register.id,
                    isActive: !register.isActive,
                  })
                }
                disabled={updateMutation.isLoading}
              >
                {register.isActive ? t("registers.deactivate") : t("registers.activate")}
              </Button>
            </div>
          ))}

          {!registersQuery.isLoading && !(registersQuery.data ?? []).length ? (
            <p className="text-sm text-muted-foreground">{t("registers.empty")}</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
};

export default PosRegistersPage;
