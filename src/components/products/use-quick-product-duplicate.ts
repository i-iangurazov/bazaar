"use client";

import { useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { buildQuickProductDuplicateInput } from "@/lib/productDuplication";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { useToast } from "@/components/ui/toast";

export const useQuickProductDuplicate = () => {
  const t = useTranslations("products");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const trpcUtils = trpc.useUtils();
  const { toast } = useToast();
  const operationRef = useRef<{ productId: string; storeId?: string; idempotencyKey: string } | null>(null);
  const requestInFlightRef = useRef(false);

  const mutation = trpc.products.duplicate.useMutation({
    onSuccess: (result, input) => {
      requestInFlightRef.current = false;
      operationRef.current = null;
      void Promise.all([
        trpcUtils.products.suggestSku.invalidate(),
        trpcUtils.products.bootstrap.invalidate(),
        trpcUtils.products.list.invalidate(),
        trpcUtils.inventory.searchProducts.invalidate(),
      ]).catch(() => undefined);
      toast({
        variant: "success",
        description:
          result.omittedBarcodesCount > 0 ? t("duplicateSuccessNoBarcodes") : t("duplicateSuccess"),
      });
      router.push(
        `/products/${result.productId}${input.storeId ? `?storeId=${encodeURIComponent(input.storeId)}` : ""}`,
      );
    },
    onError: (error) => {
      requestInFlightRef.current = false;
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const duplicateProduct = useCallback(
    (productId: string, storeId?: string) => {
      if (!productId || requestInFlightRef.current) {
        return;
      }
      requestInFlightRef.current = true;
      const current = operationRef.current;
      const idempotencyKey =
        current?.productId === productId && current.storeId === storeId
          ? current.idempotencyKey
          : crypto.randomUUID();
      operationRef.current = { productId, storeId, idempotencyKey };
      mutation.mutate(buildQuickProductDuplicateInput({ productId, storeId, idempotencyKey }));
    },
    [mutation],
  );

  return {
    duplicateProduct,
    isLoading: mutation.isLoading,
  };
};
