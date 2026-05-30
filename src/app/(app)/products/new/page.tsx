"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";

import { PageHeader } from "@/components/page-header";
import {
  ProductEditorCard,
  ProductEditorGrid,
  ProductEditorHeader,
  ProductEditorPage,
  ProductEditorSaveBar,
} from "@/components/product-editor-layout";
import { ProductForm } from "@/components/product-form";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusSuccessIcon } from "@/components/icons";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { useToast } from "@/components/ui/toast";

const productCreateReceivingReturnSource = "stockReceiving";

const resolveSafeReturnTo = (value?: string | null) => {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || !trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return null;
  }
  return trimmed;
};

const buildReturnPath = (input: {
  returnTo: string;
  productId: string;
  productName: string;
  storeId: string;
  returnSource?: string;
  receivingDraftKey?: string;
}) => {
  const url = new URL(input.returnTo, "https://local.invalid");
  url.searchParams.set("createdProductId", input.productId);
  url.searchParams.set("createdProductName", input.productName);
  url.searchParams.set("storeId", input.storeId);
  if (input.returnSource) {
    url.searchParams.set("returnSource", input.returnSource);
  }
  if (input.receivingDraftKey) {
    url.searchParams.set("receivingDraftKey", input.receivingDraftKey);
  }
  return `${url.pathname}${url.search}${url.hash}`;
};

const NewProductPage = () => {
  const t = useTranslations("products");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const searchParams = useSearchParams();
  const barcode = searchParams?.get("barcode")?.trim() ?? "";
  const requestedStoreId = searchParams?.get("storeId")?.trim() ?? "";
  const requestedType = searchParams?.get("type")?.trim() ?? "";
  const returnTo = resolveSafeReturnTo(searchParams?.get("returnTo"));
  const returnSource = searchParams?.get("returnSource")?.trim() ?? "";
  const receivingDraftKey = searchParams?.get("receivingDraftKey")?.trim() ?? "";
  const isReceivingReturnFlow =
    Boolean(returnTo) &&
    returnSource === productCreateReceivingReturnSource &&
    Boolean(receivingDraftKey);
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
      await Promise.all([
        trpcUtils.products.suggestSku.invalidate(),
        trpcUtils.inventory.searchProducts.invalidate(),
      ]);
      toast({ variant: "success", description: t("createSuccess") });
      if (returnTo) {
        router.push(
          buildReturnPath({
            returnTo,
            productId: product.id,
            productName: product.name,
            storeId: selectedStoreId,
            returnSource,
            receivingDraftKey,
          }),
        );
        return;
      }
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
  const [productFormDirty, setProductFormDirty] = useState(false);

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
  const storeSelectDisabled = storesQuery.isLoading || storeOptions.length <= 1 || isReceivingReturnFlow;
  const productCreateFormId = "product-create-form";

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
    <ProductEditorCard title={t("productAvailabilityTitle")} description={t("createStoreHint")}>
      <div className="space-y-2">
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
        {selectedStore ? (
          <p className="text-xs text-muted-foreground">
            {t("productAvailabilitySelected", { store: selectedStore.name })}
          </p>
        ) : null}
      </div>
    </ProductEditorCard>
  );

  const sidebar = (
    <>
      {storePicker}
      <ProductEditorCard title={t("productOrganizationTitle")}>
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">{t("typeLabel")}</span>
            <span className="font-medium text-foreground">
              {isBundleDefault ? t("typeBundle") : t("typeProduct")}
            </span>
          </div>
          {selectedStore?.currencyCode ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{t("currency")}</span>
              <span className="font-medium text-foreground">{selectedStore.currencyCode}</span>
            </div>
          ) : null}
        </div>
      </ProductEditorCard>
      <ProductEditorCard title={t("additionalSettingsTitle")}>
        <div className="space-y-2 text-xs text-muted-foreground">
          <p>{t(enableSku ? "skuEnabledHint" : "skuDisabledHint")}</p>
          <p>{t(enableBarcode ? "barcodeEnabledHint" : "barcodeDisabledHint")}</p>
        </div>
      </ProductEditorCard>
    </>
  );

  return (
    <ProductEditorPage>
      <ProductEditorHeader
        eyebrow={
          <Link href="/products" className="text-muted-foreground hover:text-foreground">
            {tCommon("back")}
          </Link>
        }
        title={pageTitle}
      />
      <ProductEditorSaveBar
        label={
          createMutation.isLoading
            ? t("saveBarSaving")
            : productFormDirty
              ? t("saveBarUnsavedProduct")
              : t("saveBarNewProduct")
        }
        actions={
          <Button
            type="submit"
            form={productCreateFormId}
            size="sm"
            className="min-w-24"
            disabled={!selectedStore || createMutation.isLoading}
          >
            {createMutation.isLoading ? (
              <Spinner className="h-4 w-4" />
            ) : (
              <StatusSuccessIcon className="h-4 w-4" aria-hidden />
            )}
            {createMutation.isLoading ? t("saving") : t("save")}
          </Button>
        }
      />
      <ProductEditorGrid
        main={
          !selectedStore ? (
            <ProductEditorCard>
              <p className="text-sm text-muted-foreground">{t("createStoreEmpty")}</p>
            </ProductEditorCard>
          ) : (
            <ProductForm
              key={`new:${selectedStore.id}:${selectedStore.currencyCode ?? "KGS"}:${selectedCurrencyRate}:${suggestedSku}:${enableSku}:${enableBarcode}:${enableSimilarProductCheck}`}
              formId={productCreateFormId}
              hideActions
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
              onDirtyChange={setProductFormDirty}
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
          )
        }
        sidebar={sidebar}
      />
      {createMutation.error ? (
        <p className="mt-3 text-sm text-danger">{translateError(tErrors, createMutation.error)}</p>
      ) : null}
    </ProductEditorPage>
  );
};

export default NewProductPage;
