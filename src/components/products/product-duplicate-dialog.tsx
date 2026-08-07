"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

type DuplicateOptionKey =
  | "copyImages"
  | "copyInventory"
  | "copyDescription"
  | "copyCategory"
  | "copyOtherDetails"
  | "copyPrice"
  | "copyCost"
  | "copyVariants"
  | "copyCharacteristics"
  | "copySku";

type DuplicateOptions = Record<DuplicateOptionKey, boolean>;

const defaultOptions: DuplicateOptions = {
  copyImages: true,
  copyInventory: false,
  copyDescription: true,
  copyCategory: true,
  copyOtherDetails: true,
  copyPrice: true,
  copyCost: true,
  copyVariants: true,
  copyCharacteristics: true,
  copySku: true,
};

export const ProductDuplicateDialog = ({
  open,
  onOpenChange,
  productId,
  productName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  productName: string;
}) => {
  const t = useTranslations("products");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const { toast } = useToast();
  const trpcUtils = trpc.useUtils();
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"ACTIVE" | "ARCHIVED">("ACTIVE");
  const [options, setOptions] = useState<DuplicateOptions>(defaultOptions);
  const duplicateOperationRef = useRef<{ signature: string; key: string } | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setName(t("duplicateNameTemplate", { name: productName }));
    setStatus("ACTIVE");
    setOptions(defaultOptions);
    duplicateOperationRef.current = null;
  }, [open, productId, productName, t]);

  const duplicateMutation = trpc.products.duplicate.useMutation({
    onSuccess: async (result) => {
      duplicateOperationRef.current = null;
      await Promise.all([
        trpcUtils.products.suggestSku.invalidate(),
        trpcUtils.products.bootstrap.invalidate(),
        trpcUtils.products.list.invalidate(),
        trpcUtils.inventory.searchProducts.invalidate(),
      ]);
      toast({
        variant: "success",
        description:
          result.omittedBarcodesCount > 0 ? t("duplicateSuccessNoBarcodes") : t("duplicateSuccess"),
      });
      onOpenChange(false);
      router.push(result.status === "ARCHIVED" ? "/products" : `/products/${result.productId}`);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const setOption = (key: DuplicateOptionKey, checked: boolean) => {
    setOptions((current) => {
      if (key === "copyInventory" && checked) {
        return { ...current, copyInventory: true, copyVariants: true };
      }
      if (key === "copyVariants" && !checked) {
        return { ...current, copyVariants: false, copyInventory: false };
      }
      return { ...current, [key]: checked };
    });
  };

  const optionRows: Array<{
    key: DuplicateOptionKey;
    label: string;
    description?: string;
  }> = [
    { key: "copyImages", label: t("duplicateOptionImages") },
    {
      key: "copyInventory",
      label: t("duplicateOptionInventory"),
      description: t("duplicateOptionInventoryHint"),
    },
    { key: "copyDescription", label: t("duplicateOptionDescription") },
    { key: "copyCategory", label: t("duplicateOptionCategory") },
    { key: "copyPrice", label: t("duplicateOptionPrice") },
    { key: "copyCost", label: t("duplicateOptionCost") },
    { key: "copyVariants", label: t("duplicateOptionVariants") },
    { key: "copyCharacteristics", label: t("duplicateOptionCharacteristics") },
    { key: "copyOtherDetails", label: t("duplicateOptionOtherDetails") },
    {
      key: "copySku",
      label: t("duplicateOptionSku"),
      description: t("duplicateOptionSkuHint"),
    },
  ];

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t("duplicateDialogTitle")}
      subtitle={productName}
      className="sm:max-w-xl"
      bodyClassName="p-4 sm:p-6"
      mobileSheet
    >
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!productId || name.trim().length < 2 || duplicateMutation.isLoading) {
            return;
          }
          const payload = {
            productId,
            name: name.trim(),
            status,
            ...options,
          };
          const signature = JSON.stringify(payload);
          const current = duplicateOperationRef.current;
          const idempotencyKey =
            current?.signature === signature ? current.key : crypto.randomUUID();
          duplicateOperationRef.current = { signature, key: idempotencyKey };
          duplicateMutation.mutate({ ...payload, idempotencyKey });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
          <div className="space-y-2">
            <Label htmlFor="duplicate-product-name">{t("duplicateNameLabel")}</Label>
            <Input
              id="duplicate-product-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={300}
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="duplicate-product-status">{t("duplicateStatusLabel")}</Label>
            <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
              <SelectTrigger id="duplicate-product-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ACTIVE">{t("duplicateStatusActive")}</SelectItem>
                <SelectItem value="ARCHIVED">{t("duplicateStatusArchived")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <fieldset className="space-y-1">
          <legend className="mb-2 text-sm font-semibold text-foreground">
            {t("duplicateOptionsTitle")}
          </legend>
          {optionRows.map((option) => (
            <label
              key={option.key}
              className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md px-2 py-2 transition hover:bg-accent/40"
            >
              <Checkbox
                checked={options[option.key]}
                onCheckedChange={(checked) => setOption(option.key, checked === true)}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">{option.label}</span>
                {option.description ? (
                  <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                    {option.description}
                  </span>
                ) : null}
              </span>
            </label>
          ))}
        </fieldset>

        <ModalFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={duplicateMutation.isLoading}
          >
            {tCommon("cancel")}
          </Button>
          <Button type="submit" disabled={name.trim().length < 2 || duplicateMutation.isLoading}>
            {duplicateMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
            {t("duplicateCreateAction")}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
};
