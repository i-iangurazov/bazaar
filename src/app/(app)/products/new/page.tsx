"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";

import { PageHeader } from "@/components/page-header";
import { ProductForm } from "@/components/product-form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { useToast } from "@/components/ui/toast";

const NewProductPage = () => {
  const t = useTranslations("products");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const searchParams = useSearchParams();
  const barcode = searchParams?.get("barcode")?.trim() ?? "";
  const requestedStoreId = searchParams?.get("storeId")?.trim() ?? "";
  const requestedType = searchParams?.get("type")?.trim() ?? "";
  const isBundleDefault = requestedType === "bundle";
  const pageTitle = isBundleDefault ? t("newBundle") : t("newTitle");
  const pageSubtitle = isBundleDefault ? t("newBundleSubtitle") : t("newSubtitle");
  const { data: session, status } = useSession();
  const canManageProducts = session?.user?.role === "ADMIN" || session?.user?.role === "MANAGER";
  const canEditInitialStock = session?.user?.role === "ADMIN";
  const { toast } = useToast();
  const trpcUtils = trpc.useUtils();
  const attributesQuery = trpc.attributes.list.useQuery();
  const unitsQuery = trpc.units.list.useQuery();
  const storesQuery = trpc.stores.list.useQuery(undefined, {
    enabled: status === "authenticated" && canManageProducts,
  });
  const suggestedSkuQuery = trpc.products.suggestSku.useQuery(undefined, {
    enabled: status === "authenticated" && canManageProducts,
  });

  const createMutation = trpc.products.create.useMutation({
    onSuccess: async (product) => {
      await trpcUtils.products.suggestSku.invalidate();
      toast({ variant: "success", description: t("createSuccess") });
      router.push(`/products/${product.id}`);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const storeOptions = useMemo(() => storesQuery.data ?? [], [storesQuery.data]);
  const requestedStore = useMemo(
    () => storeOptions.find((store) => store.id === requestedStoreId) ?? null,
    [requestedStoreId, storeOptions],
  );
  const [selectedStoreId, setSelectedStoreId] = useState("");

  useEffect(() => {
    if (!storeOptions.length) {
      setSelectedStoreId("");
      return;
    }

    setSelectedStoreId((currentStoreId) => {
      if (currentStoreId && storeOptions.some((store) => store.id === currentStoreId)) {
        return currentStoreId;
      }

      return requestedStore?.id ?? storeOptions[0]?.id ?? "";
    });
  }, [requestedStore?.id, storeOptions]);

  const selectedStore = storeOptions.find((store) => store.id === selectedStoreId) ?? null;
  const selectedCurrencyRate = Number(selectedStore?.currencyRateKgsPerUnit ?? 1);
  const enableSku = selectedStore?.enableSku ?? true;
  const enableBarcode = selectedStore?.enableBarcode ?? true;
  const enableSimilarProductCheck = selectedStore?.enableSimilarProductCheck ?? true;
  const storeSelectDisabled = storesQuery.isLoading || storeOptions.length <= 1;

  if (session && !canManageProducts) {
    return (
      <div>
        <PageHeader title={pageTitle} subtitle={pageSubtitle} />
        <p className="mt-4 text-sm text-danger">{tErrors("forbidden")}</p>
      </div>
    );
  }

  if (status === "loading") {
    return (
      <div>
        <PageHeader title={pageTitle} subtitle={pageSubtitle} />
        <p className="mt-4 text-sm text-muted-foreground">{tCommon("loading")}</p>
      </div>
    );
  }

  if (canManageProducts && (suggestedSkuQuery.isLoading || storesQuery.isLoading)) {
    return (
      <div>
        <PageHeader title={pageTitle} subtitle={pageSubtitle} />
        <p className="mt-4 text-sm text-muted-foreground">{tCommon("loading")}</p>
      </div>
    );
  }

  const suggestedSku = suggestedSkuQuery.data ?? "";

  const storePicker = (
    <section className="mb-6 border border-border bg-card p-4 shadow-sm">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,26rem)] lg:items-center">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t("createStoreTitle")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("createStoreHint")}</p>
        </div>
        <Select
          value={selectedStoreId}
          onValueChange={setSelectedStoreId}
          disabled={storeSelectDisabled}
        >
          <SelectTrigger aria-label={t("createStoreTitle")}>
            <SelectValue placeholder={t("createStorePlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {storeOptions.map((store) => (
              <SelectItem key={store.id} value={store.id}>
                {store.name}
                {store.code ? ` (${store.code})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </section>
  );

  return (
    <div>
      <PageHeader title={pageTitle} subtitle={pageSubtitle} />
      {storePicker}
      {!selectedStore ? (
        <p className="text-sm text-muted-foreground">{t("createStoreEmpty")}</p>
      ) : (
        <ProductForm
          key={`new:${selectedStore.id}:${selectedStore.currencyCode ?? "KGS"}:${selectedCurrencyRate}:${suggestedSku}:${enableSku}:${enableBarcode}:${enableSimilarProductCheck}`}
          initialValues={{
            sku: suggestedSku,
            name: "",
            isBundle: isBundleDefault,
            category: "",
            categories: [],
            baseUnitId: "",
            basePriceKgs: undefined,
            purchasePriceKgs: undefined,
            avgCostKgs: undefined,
            initialOnHand: undefined,
            minStock: undefined,
            description: "",
            photoUrl: "",
            images: [],
            barcodes: enableBarcode && barcode ? [barcode] : [],
            packs: [],
            variants: [],
            bundleComponents: [],
          }}
          attributeDefinitions={attributesQuery.data ?? []}
          units={unitsQuery.data ?? []}
          onSubmit={(values) =>
            createMutation.mutate({
              ...values,
              storeId: selectedStore.id,
              sku:
                !enableSku || (suggestedSku && values.sku.trim() === suggestedSku)
                  ? ""
                  : values.sku,
            })
          }
          isSubmitting={createMutation.isLoading}
          currencyCode={selectedStore.currencyCode ?? null}
          currencyRateKgsPerUnit={selectedCurrencyRate}
          quickCreateMode
          canEditInitialStock={canEditInitialStock}
          enableSku={enableSku}
          enableBarcode={enableBarcode}
          enableSimilarProductCheck={enableSimilarProductCheck}
          categoryStoreId={selectedStore.id}
        />
      )}
      {createMutation.error ? (
        <p className="mt-3 text-sm text-danger">{translateError(tErrors, createMutation.error)}</p>
      ) : null}
    </div>
  );
};

export default NewProductPage;
