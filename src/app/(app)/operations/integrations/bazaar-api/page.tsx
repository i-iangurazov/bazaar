"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/i18nFormat";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

const BazaarApiSettingsPage = () => {
  const t = useTranslations("bazaarApiSettings");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const storeIdParam = searchParams.get("storeId");
  const { toast } = useToast();
  const [storeId, setStoreId] = useState(storeIdParam ?? "");
  const [keyName, setKeyName] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);

  const storesQuery = trpc.bazaarApi.listStores.useQuery();
  const stores = useMemo(() => storesQuery.data ?? [], [storesQuery.data]);

  useEffect(() => {
    setStoreId((current) => {
      if (current && stores.some((store) => store.storeId === current)) {
        return current;
      }
      return stores[0]?.storeId ?? "";
    });
  }, [stores]);

  const apiKeysQuery = trpc.bazaarApi.apiKeys.useQuery({ storeId }, { enabled: Boolean(storeId) });
  const utils = trpc.useUtils();
  const selectedStore = stores.find((store) => store.storeId === storeId) ?? null;
  const activeKeyCount = useMemo(
    () => (apiKeysQuery.data ?? []).filter((key) => !key.revokedAt).length,
    [apiKeysQuery.data],
  );

  const createMutation = trpc.bazaarApi.createApiKey.useMutation({
    onSuccess: async (result) => {
      setNewToken(result.token);
      setKeyName("");
      await utils.bazaarApi.apiKeys.invalidate();
      await utils.bazaarApi.listStores.invalidate();
      toast({ variant: "success", description: t("messages.created") });
    },
    onError: (error) => toast({ variant: "error", description: translateError(tErrors, error) }),
  });

  const revokeMutation = trpc.bazaarApi.revokeApiKey.useMutation({
    onSuccess: async () => {
      await utils.bazaarApi.apiKeys.invalidate();
      await utils.bazaarApi.listStores.invalidate();
      toast({ variant: "success", description: t("messages.revoked") });
    },
    onError: (error) => toast({ variant: "error", description: translateError(tErrors, error) }),
  });

  const apiBaseUrl =
    typeof window !== "undefined" ? `${window.location.origin}/api/bazaar/v1` : "/api/bazaar/v1";

  return (
    <div>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("storeTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="max-w-sm space-y-2">
            <Select
              value={storeId}
              onValueChange={setStoreId}
              disabled={storesQuery.isLoading || !stores.length}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("storePlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {stores.map((store) => (
                  <SelectItem key={store.storeId} value={store.storeId}>
                    {store.storeName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {selectedStore
                ? t("storeHint", { store: selectedStore.storeName })
                : t("storeMissing")}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <CardTitle>{t("statusTitle")}</CardTitle>
              <Badge variant={activeKeyCount > 0 ? "success" : "muted"}>
                {activeKeyCount > 0 ? t("status.ready") : t("status.notConfigured")}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm md:grid-cols-3">
            <div className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">{t("productsEndpoint")}</p>
              <p className="break-all font-mono text-xs">{apiBaseUrl}/products</p>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">{t("ordersEndpoint")}</p>
              <p className="break-all font-mono text-xs">{apiBaseUrl}/orders</p>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">{t("customersEndpoint")}</p>
              <p className="break-all font-mono text-xs">{apiBaseUrl}/customers</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("keysTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={keyName}
                onChange={(event) => setKeyName(event.target.value)}
                placeholder={t("keyNamePlaceholder")}
                disabled={!storeId || createMutation.isLoading}
              />
              <Button
                type="button"
                onClick={() => createMutation.mutate({ storeId, name: keyName.trim() })}
                disabled={!storeId || !keyName.trim() || createMutation.isLoading}
              >
                {createMutation.isLoading ? tCommon("loading") : t("createKey")}
              </Button>
            </div>

            <TableContainer>
              <Table className="min-w-[720px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("columns.name")}</TableHead>
                    <TableHead>{t("columns.prefix")}</TableHead>
                    <TableHead>{t("columns.created")}</TableHead>
                    <TableHead>{t("columns.lastUsed")}</TableHead>
                    <TableHead>{t("columns.status")}</TableHead>
                    <TableHead className="text-right">{tCommon("actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(apiKeysQuery.data ?? []).length ? (
                    (apiKeysQuery.data ?? []).map((apiKey) => (
                      <TableRow key={apiKey.id}>
                        <TableCell className="font-medium">{apiKey.name}</TableCell>
                        <TableCell className="font-mono text-xs">{apiKey.tokenPrefix}</TableCell>
                        <TableCell>{formatDateTime(apiKey.createdAt, locale)}</TableCell>
                        <TableCell>
                          {apiKey.lastUsedAt ? formatDateTime(apiKey.lastUsedAt, locale) : "-"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={apiKey.revokedAt ? "muted" : "success"}>
                            {apiKey.revokedAt ? t("status.revoked") : t("status.active")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            variant="danger"
                            disabled={Boolean(apiKey.revokedAt) || revokeMutation.isLoading}
                            onClick={() => revokeMutation.mutate({ storeId, apiKeyId: apiKey.id })}
                          >
                            {t("revoke")}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="py-10 text-center text-sm text-muted-foreground"
                      >
                        {apiKeysQuery.isLoading ? tCommon("loading") : t("empty")}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      </div>

      <Modal
        open={Boolean(newToken)}
        onOpenChange={(open) => {
          if (!open) {
            setNewToken(null);
          }
        }}
        title={t("tokenTitle")}
        subtitle={t("tokenSubtitle")}
      >
        <div className="space-y-4">
          <div className="break-all rounded-md border border-border bg-muted/30 p-3 font-mono text-xs">
            {newToken}
          </div>
          <ModalFooter>
            <Button type="button" onClick={() => setNewToken(null)}>
              {tCommon("close")}
            </Button>
          </ModalFooter>
        </div>
      </Modal>
    </div>
  );
};

export default BazaarApiSettingsPage;
