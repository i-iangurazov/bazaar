"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ProductForm, type ProductFormValues } from "@/components/product-form";
import { QueryErrorState } from "@/components/query-error-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

type StudioProduct = { id: string; sku: string; name: string; imageUrl?: string | null };

export function StudioCreateProductDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (product: StudioProduct) => Promise<void> | void;
}) {
  const t = useTranslations("products");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const [storeId, setStoreId] = useState("");
  const [selectingProduct, setSelectingProduct] = useState(false);
  const [failedSelection, setFailedSelection] = useState<StudioProduct | null>(null);
  const formId = useId();
  const storeSelectId = useId();
  const operation = useRef<{ signature: string; key: string } | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const utils = trpc.useUtils();
  const stores = trpc.stores.list.useQuery(undefined, { enabled: open });
  const units = trpc.units.list.useQuery(undefined, { enabled: open });
  const attributes = trpc.attributes.list.useQuery(undefined, { enabled: open });
  const suggestedSku = trpc.products.suggestSku.useQuery(undefined, { enabled: open });
  const storeOptions = stores.data ?? [];
  const selectedStore = storeOptions.find((candidate) => candidate.id === storeId)
    ?? (storeOptions.length === 1 ? storeOptions[0] : undefined);

  const selectProduct = async (product: StudioProduct) => {
    setSelectingProduct(true);
    setFailedSelection(null);
    try {
      await onCreated(product);
      setStoreId("");
      onOpenChange(false);
    } catch {
      setFailedSelection(product);
    } finally {
      setSelectingProduct(false);
    }
  };

  const create = trpc.products.create.useMutation({
    onSuccess: async (product) => {
      await Promise.allSettled([
        utils.products.suggestSku.invalidate(),
        utils.products.bootstrap.invalidate(),
        utils.products.list.invalidate(),
        utils.inventory.searchProducts.invalidate(),
      ]);
      operation.current = null;
      await selectProduct({
        id: product.id,
        sku: product.sku,
        name: product.name,
        imageUrl: product.photoUrl,
      });
    },
  });
  const resetCreate = create.reset;
  useEffect(() => {
    if (open) return;
    resetCreate();
    setFailedSelection(null);
  }, [open, resetCreate]);
  const busy = create.isLoading || selectingProduct;
  const queriesFailed = stores.isError || units.isError || attributes.isError || suggestedSku.isError;
  const ready = stores.isSuccess && units.isSuccess && attributes.isSuccess && suggestedSku.isSuccess;

  const createProduct = (values: ProductFormValues) => {
    if (!selectedStore || busy || create.isSuccess) return;
    const sku = values.sku.trim();
    const payload = {
      ...values,
      storeId: selectedStore.id,
      sku: !selectedStore.enableSku || sku === suggestedSku.data ? "" : sku,
    };
    const signature = JSON.stringify(payload);
    const key = operation.current?.signature === signature ? operation.current.key : crypto.randomUUID();
    operation.current = { signature, key };
    create.mutate({ ...payload, idempotencyKey: key });
  };

  const close = () => {
    if (busy) return;
    if (create.isSuccess) operation.current = null;
    create.reset();
    setFailedSelection(null);
    setStoreId("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent
        size="lg"
        showClose={!busy}
        onOpenAutoFocus={() => {
          trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(event) => {
          if (trigger.current?.isConnected) {
            event.preventDefault();
            trigger.current.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("newTitle")}</DialogTitle>
          <DialogDescription>{t("newSubtitle")}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {queriesFailed ? (
            <QueryErrorState onRetry={() => void Promise.all([
              stores.refetch(), units.refetch(), attributes.refetch(), suggestedSku.refetch(),
            ])} />
          ) : !ready ? (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" /> {tCommon("loading")}
            </p>
          ) : !storeOptions.length ? (
            <p className="text-sm text-muted-foreground">{t("createStoreEmpty")}</p>
          ) : (
            <>
              <div className="space-y-1.5">
                <label htmlFor={storeSelectId} className="text-sm font-medium">{tCommon("store")}</label>
                <Select value={selectedStore?.id ?? ""} onValueChange={setStoreId} disabled={busy || create.isSuccess}>
                  <SelectTrigger id={storeSelectId} className="min-h-11">
                    <SelectValue placeholder={t("createStorePlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {storeOptions.map((store) => (
                      <SelectItem key={store.id} value={store.id}>{store.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedStore && !create.isSuccess ? (
                <ProductForm
                  key={selectedStore.id}
                  formId={formId}
                  initialValues={{
                    sku: suggestedSku.data ?? "",
                    name: "",
                    baseUnitId: "",
                    barcodes: [],
                    packs: [],
                    variants: [],
                  }}
                  units={units.data}
                  attributeDefinitions={attributes.data}
                  onSubmit={createProduct}
                  isSubmitting={busy}
                  hideActions
                  quickCreateMode
                  canEditInitialStock={false}
                  currencyCode={selectedStore.currencyCode}
                  currencyRateKgsPerUnit={Number(selectedStore.currencyRateKgsPerUnit ?? 1)}
                  retailWholesaleEnabled={selectedStore.organization.retailWholesaleEnabled}
                  enableSku={selectedStore.enableSku}
                  enableBarcode={selectedStore.enableBarcode}
                  enableSimilarProductCheck={selectedStore.enableSimilarProductCheck}
                  categoryStoreId={selectedStore.id}
                  onReuseExisting={(product) => void selectProduct({ ...product, sku: product.sku ?? "" })}
                />
              ) : null}
            </>
          )}
          {create.error ? (
            <p role="alert" className="text-sm text-danger">{translateError(tErrors, create.error)}</p>
          ) : null}
          {failedSelection ? (
            <p role="alert" className="text-sm text-danger">{tErrors("unexpectedError")}</p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={close} disabled={busy}>{tCommon("cancel")}</Button>
          {failedSelection ? (
            <Button type="button" onClick={() => void selectProduct(failedSelection)} disabled={busy}>
              {tCommon("tryAgain")}
            </Button>
          ) : (
            <Button type="submit" form={formId} disabled={!selectedStore || !ready || busy || create.isSuccess}>
              {busy ? <Spinner className="h-4 w-4" /> : null}
              {t(busy ? "saving" : "save")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
