"use client";

import { useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { formatDateTime } from "@/lib/i18nFormat";

const AdminSupportPage = () => {
  const t = useTranslations("adminSupport");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();
  const { data: session, status } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";
  const isForbidden = status === "authenticated" && !isAdmin;
  const { toast } = useToast();

  const usersQuery = trpc.users.list.useQuery(undefined, { enabled: isAdmin });
  const storeFlagsQuery = trpc.adminSupport.storeFlags.useQuery(undefined, { enabled: isAdmin });

  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [ttlMinutes, setTtlMinutes] = useState("30");
  const [newFlagKeys, setNewFlagKeys] = useState<Record<string, string>>({});

  const userOptions = useMemo(
    () =>
      (usersQuery.data ?? []).filter((user) => user.isActive).map((user) => ({
        id: user.id,
        label: `${user.name ?? user.email ?? tCommon("userFallback")} (${user.email})`,
      })),
    [usersQuery.data, tCommon],
  );

  const impersonationMutation = trpc.adminSupport.createImpersonation.useMutation({
    onSuccess: async (result) => {
      try {
        await fetch("/api/impersonation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: result.session.id }),
        });
        toast({
          variant: "success",
          description: t("impersonationStarted", { user: result.target.email }),
        });
        router.push("/dashboard");
        router.refresh();
      } catch (error) {
        toast({ variant: "error", description: tErrors("unexpectedError") });
      }
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const exportMutation = trpc.adminSupport.exportBundle.useMutation({
    onSuccess: (bundle) => {
      const blob = new Blob([JSON.stringify(bundle, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `support-bundle-${bundle.generatedAt}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast({ variant: "success", description: t("bundleReady") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const flagMutation = trpc.adminSupport.upsertStoreFlag.useMutation({
    onSuccess: () => {
      storeFlagsQuery.refetch();
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  if (isForbidden) {
    return (
      <div>
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <p className="mt-4 text-sm text-danger">{tErrors("forbidden")}</p>
      </div>
    );
  }

  const handleStartImpersonation = () => {
    if (!selectedUserId || impersonationMutation.isLoading) {
      return;
    }
    const minutes = Number(ttlMinutes);
    impersonationMutation.mutate({
      targetUserId: selectedUserId,
      ttlMinutes: Number.isFinite(minutes) ? minutes : undefined,
    });
  };

  const handleFlagToggle = (storeId: string, key: string, enabled: boolean) => {
    flagMutation.mutate({ storeId, key, enabled });
  };

  const handleAddFlag = (storeId: string) => {
    const key = (newFlagKeys[storeId] ?? "").trim();
    if (!key) {
      toast({ variant: "info", description: t("flagKeyRequired") });
      return;
    }
    flagMutation.mutate({ storeId, key, enabled: true });
    setNewFlagKeys((prev) => ({ ...prev, [storeId]: "" }));
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <Card>
        <CardHeader>
          <CardTitle>{t("impersonationTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {usersQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-center">
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger aria-label={t("impersonationSelectLabel")}>
                  <SelectValue placeholder={t("impersonationSelectPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {(userOptions ?? []).map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                min={5}
                max={240}
                value={ttlMinutes}
                onChange={(event) => setTtlMinutes(event.target.value)}
                aria-label={t("impersonationTtlLabel")}
              />
              <Button type="button" onClick={handleStartImpersonation} disabled={!selectedUserId}>
                {t("impersonationStart")}
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t("impersonationHint")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("bundleTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("bundleHint")}</p>
          <Button type="button" variant="secondary" onClick={() => exportMutation.mutate()}>
            {exportMutation.isLoading ? tCommon("loading") : t("bundleAction")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("flagsTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {storeFlagsQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : (
            (storeFlagsQuery.data ?? []).map((store) => (
              <div key={store.id} className="rounded-lg border border-border/70 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{store.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("storeCode", { code: store.code })}
                    </p>
                  </div>
                  <Badge variant="muted">{t("flagsCount", { count: store.featureFlags.length })}</Badge>
                </div>

                <div className="mt-3 space-y-2">
                  {store.featureFlags.length ? (
                    store.featureFlags.map((flag) => (
                      <div key={flag.id} className="flex items-center justify-between gap-2 text-sm">
                        <div>
                          <p className="font-medium text-foreground">{t("flagKey", { key: flag.key })}</p>
                          <p className="text-xs text-muted-foreground/80">
                            {t("flagUpdatedAt", { date: formatDateTime(flag.updatedAt, locale) })}
                          </p>
                        </div>
                        <Switch
                          checked={flag.enabled}
                          onCheckedChange={(value) => handleFlagToggle(store.id, flag.key, value)}
                          aria-label={t("flagToggleLabel", { key: flag.key })}
                        />
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-muted-foreground/80">{t("flagsEmpty")}</p>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Input
                    value={newFlagKeys[store.id] ?? ""}
                    onChange={(event) =>
                      setNewFlagKeys((prev) => ({ ...prev, [store.id]: event.target.value }))
                    }
                    placeholder={t("flagKeyPlaceholder")}
                    aria-label={t("flagKeyPlaceholder")}
                    className="min-w-[220px]"
                  />
                  <Button type="button" variant="secondary" onClick={() => handleAddFlag(store.id)}>
                    {t("flagAdd")}
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminSupportPage;
