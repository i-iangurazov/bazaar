"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/spinner";
import {
  applyCatalogDiscountInputSchema,
  previewCatalogDiscountInputSchema,
  removeCatalogDiscountInputSchema,
  type CatalogDiscountOperationResult,
  type CatalogDiscountPreview,
  type CatalogDiscountRouterAdapter,
  type CatalogDiscountVariantPolicy,
  type PreviewCatalogDiscountInput,
} from "@/lib/catalogDiscountContract";

export type CatalogDiscountDialogLabels = {
  applyTitle: string;
  removeTitle: string;
  subtitle: string;
  store: string;
  percentage: string;
  startsAt: string;
  endsAt: string;
  variants: string;
  allVariants: string;
  selectedVariants: string;
  selectedProducts: string;
  affectedProducts: string;
  affectedVariants: string;
  productsWithoutPrice: string;
  samplePrices: string;
  currentPrice: string;
  nextPrice: string;
  preview: string;
  previewAgain: string;
  apply: string;
  remove: string;
  cancel: string;
  loading: string;
  previewRequired: string;
};

export type CatalogDiscountDialogProps = {
  open: boolean;
  mode: "APPLY" | "REMOVE";
  productIds: string[];
  stores: Array<{ id: string; name: string }>;
  variants: Array<{ id: string; productId: string; label: string }>;
  initialStoreId?: string;
  labels: CatalogDiscountDialogLabels;
  adapter: CatalogDiscountRouterAdapter;
  onOpenChange: (open: boolean) => void;
  onCompleted?: (result: CatalogDiscountOperationResult) => void;
};

const optionalDate = (value: string) => (value ? new Date(value) : null);

export const CatalogDiscountDialog = ({
  open,
  mode,
  productIds,
  stores,
  variants,
  initialStoreId,
  labels,
  adapter,
  onOpenChange,
  onCompleted,
}: CatalogDiscountDialogProps) => {
  const defaultStoreId = initialStoreId ?? stores[0]?.id ?? "";
  const [storeId, setStoreId] = useState(defaultStoreId);
  const [percentage, setPercentage] = useState("20");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [variantPolicy, setVariantPolicy] = useState<CatalogDiscountVariantPolicy>("ALL_VARIANTS");
  const [variantIds, setVariantIds] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<CatalogDiscountPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const idempotencyKeyRef = useRef<string | null>(null);

  const eligibleVariants = useMemo(
    () => variants.filter((variant) => productIds.includes(variant.productId)),
    [productIds, variants],
  );

  useEffect(() => {
    if (!open) return;
    setStoreId(defaultStoreId);
    setPercentage("20");
    setStartsAt("");
    setEndsAt("");
    setVariantPolicy("ALL_VARIANTS");
    setVariantIds(new Set());
    setPreview(null);
    setError(null);
    idempotencyKeyRef.current = null;
  }, [defaultStoreId, open]);

  const invalidatePreview = () => {
    setPreview(null);
    setError(null);
    idempotencyKeyRef.current = null;
  };

  const buildPreviewInput = (): PreviewCatalogDiscountInput => {
    const selection = {
      storeId,
      productIds,
      variantPolicy,
      variantIds: variantPolicy === "SELECTED_VARIANTS" ? Array.from(variantIds) : [],
    };
    return previewCatalogDiscountInputSchema.parse(
      mode === "APPLY"
        ? {
            action: "APPLY",
            ...selection,
            percentage: Number(percentage),
            startsAt: optionalDate(startsAt),
            endsAt: optionalDate(endsAt),
          }
        : { action: "REMOVE", ...selection },
    );
  };

  const handlePreview = async () => {
    setIsPreviewing(true);
    setError(null);
    try {
      const result = await adapter.preview(buildPreviewInput());
      setPreview(result);
    } catch (caught) {
      setPreview(null);
      setError(caught instanceof Error ? caught.message : "catalogDiscountPreviewFailed");
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleSubmit = async () => {
    if (!preview) {
      setError(labels.previewRequired);
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const previewInput = buildPreviewInput();
      idempotencyKeyRef.current ??= crypto.randomUUID();
      const result =
        previewInput.action === "APPLY"
          ? await adapter.apply(
              applyCatalogDiscountInputSchema.parse({
                ...previewInput,
                action: undefined,
                idempotencyKey: idempotencyKeyRef.current,
              }),
            )
          : await adapter.remove(
              removeCatalogDiscountInputSchema.parse({
                ...previewInput,
                action: undefined,
                idempotencyKey: idempotencyKeyRef.current,
              }),
            );
      onCompleted?.(result);
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "catalogDiscountMutationFailed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={mode === "APPLY" ? labels.applyTitle : labels.removeTitle}
      subtitle={labels.subtitle}
      className="max-w-2xl"
      mobileSheet
    >
      <div className="space-y-5">
        <label className="block space-y-2 text-sm font-medium">
          <span>{labels.store}</span>
          <select
            value={storeId}
            onChange={(event) => {
              setStoreId(event.target.value);
              invalidatePreview();
            }}
            className="h-10 w-full rounded-md border border-input bg-background px-3"
          >
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
        </label>

        {mode === "APPLY" ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="space-y-2 text-sm font-medium">
              <span>{labels.percentage}</span>
              <Input
                type="number"
                min="0.01"
                max="99.99"
                step="0.01"
                value={percentage}
                onChange={(event) => {
                  setPercentage(event.target.value);
                  invalidatePreview();
                }}
              />
            </label>
            <label className="space-y-2 text-sm font-medium">
              <span>{labels.startsAt}</span>
              <Input
                type="datetime-local"
                value={startsAt}
                onChange={(event) => {
                  setStartsAt(event.target.value);
                  invalidatePreview();
                }}
              />
            </label>
            <label className="space-y-2 text-sm font-medium">
              <span>{labels.endsAt}</span>
              <Input
                type="datetime-local"
                value={endsAt}
                onChange={(event) => {
                  setEndsAt(event.target.value);
                  invalidatePreview();
                }}
              />
            </label>
          </div>
        ) : null}

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">{labels.variants}</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            {(["ALL_VARIANTS", "SELECTED_VARIANTS"] as const).map((policy) => (
              <label key={policy} className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={variantPolicy === policy}
                  onChange={() => {
                    setVariantPolicy(policy);
                    invalidatePreview();
                  }}
                />
                {policy === "ALL_VARIANTS" ? labels.allVariants : labels.selectedVariants}
              </label>
            ))}
          </div>
          {variantPolicy === "SELECTED_VARIANTS" ? (
            <div className="grid max-h-40 gap-2 overflow-y-auto rounded-md border p-3 sm:grid-cols-2">
              {eligibleVariants.map((variant) => (
                <label key={variant.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={variantIds.has(variant.id)}
                    onCheckedChange={(checked) => {
                      setVariantIds((current) => {
                        const next = new Set(current);
                        if (checked) next.add(variant.id);
                        else next.delete(variant.id);
                        return next;
                      });
                      invalidatePreview();
                    }}
                  />
                  <span>{variant.label}</span>
                </label>
              ))}
            </div>
          ) : null}
        </fieldset>

        {error ? <Alert variant="destructive">{error}</Alert> : null}

        {preview ? (
          <div className="space-y-3 rounded-md border bg-muted/30 p-4">
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div className="flex justify-between gap-4">
                <dt>{labels.selectedProducts}</dt>
                <dd>{preview.selectedProductCount}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>{labels.affectedProducts}</dt>
                <dd>{preview.affectedProductCount}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>{labels.affectedVariants}</dt>
                <dd>{preview.affectedVariantCount}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>{labels.productsWithoutPrice}</dt>
                <dd>{preview.productsWithoutPrice.length}</dd>
              </div>
            </dl>
            {preview.samples.length ? (
              <div className="overflow-x-auto">
                <p className="mb-2 text-sm font-medium">{labels.samplePrices}</p>
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      <th>{labels.selectedProducts}</th>
                      <th>{labels.currentPrice}</th>
                      <th>{labels.nextPrice}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.samples.map((sample) => (
                      <tr key={`${sample.productId}:${sample.variantId ?? "BASE"}`}>
                        <td>
                          {sample.productName}
                          {sample.variantName ? ` — ${sample.variantName}` : ""}
                        </td>
                        <td>
                          {sample.currentPrice} {sample.currency}
                        </td>
                        <td>
                          {sample.nextPrice} {sample.currency}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}

        <ModalFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            {labels.cancel}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={isPreviewing || isSubmitting}
            onClick={() => void handlePreview()}
          >
            {isPreviewing ? <Spinner className="h-4 w-4" /> : null}
            {isPreviewing ? labels.loading : preview ? labels.previewAgain : labels.preview}
          </Button>
          <Button
            type="button"
            disabled={!preview || isPreviewing || isSubmitting}
            onClick={() => void handleSubmit()}
          >
            {isSubmitting ? <Spinner className="h-4 w-4" /> : null}
            {isSubmitting ? labels.loading : mode === "APPLY" ? labels.apply : labels.remove}
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );
};
