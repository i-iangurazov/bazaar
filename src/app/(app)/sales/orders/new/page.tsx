"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { AddIcon, DeleteIcon } from "@/components/icons";
import { FormGrid } from "@/components/form-layout";
import { PageHeader } from "@/components/page-header";
import { ScanInput } from "@/components/ScanInput";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { formatCurrencyKGS } from "@/lib/i18nFormat";
import { translateError } from "@/lib/translateError";
import { trpc } from "@/lib/trpc";
import type { ScanResolvedResult } from "@/lib/scanning/scanRouter";

type ProductSearchResult = {
  id: string;
  name: string;
  sku: string;
  isBundle?: boolean;
};

type DraftLine = {
  productId: string;
  productName: string;
  productSku: string;
  qty: number;
  qtyInput: string;
  isBundle: boolean;
  unitPriceKgs: number | null;
  lineTotalKgs: number | null;
};

const toLineTotal = (qty: number, unitPriceKgs: number | null) =>
  unitPriceKgs === null ? null : Math.round(qty * unitPriceKgs * 100) / 100;

const NewSalesOrderPage = () => {
  const t = useTranslations("salesOrders");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const isReturnMode = searchParams.get("mode") === "return";

  const storesQuery = trpc.stores.list.useQuery();
  const [storeId, setStoreId] = useState<string>("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [lineSearch, setLineSearch] = useState("");
  const [showLineSearchResults, setShowLineSearchResults] = useState(false);
  const [pendingQty, setPendingQty] = useState("1");
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);

  useEffect(() => {
    if (!storeId && storesQuery.data?.[0]) {
      setStoreId(storesQuery.data[0].id);
    }
  }, [storeId, storesQuery.data]);

  const productSearchQuery = trpc.products.searchQuick.useQuery(
    { q: lineSearch.trim() },
    { enabled: lineSearch.trim().length >= 1 },
  );

  const createMutation = trpc.salesOrders.createDraft.useMutation({
    onSuccess: (order) => {
      toast({ variant: "success", description: t("createSuccess") });
      router.push(`/sales/orders/${order.id}`);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const addDraftLine = async (product: ProductSearchResult): Promise<boolean> => {
    if (!storeId) {
      toast({ variant: "error", description: t("storeRequired") });
      return false;
    }

    const rawQty = pendingQty.trim();
    const qty = Number(rawQty);
    if (!rawQty || !Number.isFinite(qty) || qty <= 0) {
      toast({ variant: "error", description: t("qtyPositive") });
      return false;
    }
    const normalizedQty = Math.trunc(qty);

    let unitPriceKgs: number | null = null;
    try {
      const pricing = await utils.products.pricing.fetch({
        productId: product.id,
        storeId,
      });
      unitPriceKgs = pricing.effectivePriceKgs;
    } catch (error) {
      toast({ variant: "error", description: tErrors("genericMessage") });
      return false;
    }

    if (unitPriceKgs === null) {
      toast({ variant: "info", description: t("priceNotSet") });
    }

    setDraftLines((current) => {
      const index = current.findIndex((line) => line.productId === product.id);
      if (index === -1) {
        return [
          ...current,
          {
            productId: product.id,
            productName: product.name,
            productSku: product.sku,
            qty: normalizedQty,
            qtyInput: String(normalizedQty),
            isBundle: Boolean(product.isBundle),
            unitPriceKgs,
            lineTotalKgs: toLineTotal(normalizedQty, unitPriceKgs),
          },
        ];
      }

      const next = [...current];
      const nextQty = Math.max(1, next[index].qty + normalizedQty);
      const currentPrice = next[index].unitPriceKgs ?? unitPriceKgs;
      next[index] = {
        ...next[index],
        qty: nextQty,
        qtyInput: String(nextQty),
        unitPriceKgs: currentPrice,
        lineTotalKgs: toLineTotal(nextQty, currentPrice),
      };
      return next;
    });
    setLineSearch("");
    setPendingQty("1");
    setShowLineSearchResults(false);
    return true;
  };

  const handleLineScanResolved = async (result: ScanResolvedResult): Promise<boolean> => {
    if (result.kind === "notFound") {
      toast({ variant: "info", description: tCommon("nothingFound") });
      return false;
    }
    if (result.kind === "multiple") {
      setShowLineSearchResults(true);
      return true;
    }
    return addDraftLine({
      id: result.item.id,
      name: result.item.name,
      sku: result.item.sku,
      isBundle: result.item.type === "bundle",
    });
  };

  const updateDraftLineQty = (productId: string, rawValue: string) => {
    setDraftLines((current) =>
      current.map((line) =>
        line.productId === productId
          ? {
              ...line,
              qty:
                rawValue.trim().length > 0 && Number.isFinite(Number(rawValue))
                  ? Math.trunc(Number(rawValue))
                  : 0,
              qtyInput: rawValue,
              lineTotalKgs:
                rawValue.trim().length > 0 && Number.isFinite(Number(rawValue))
                  ? toLineTotal(Math.trunc(Number(rawValue)), line.unitPriceKgs)
                  : null,
            }
          : line,
      ),
    );
  };

  const removeDraftLine = (productId: string) => {
    setDraftLines((current) => current.filter((line) => line.productId !== productId));
  };

  const handleCreate = async () => {
    if (!storeId) {
      toast({ variant: "error", description: t("storeRequired") });
      return;
    }

    if (draftLines.some((line) => line.qty < 1 || !Number.isFinite(line.qty))) {
      toast({ variant: "error", description: t("qtyPositive") });
      return;
    }

    if (draftLines.some((line) => line.unitPriceKgs === null)) {
      toast({ variant: "error", description: t("priceNotSetBlocking") });
      return;
    }

    await createMutation.mutateAsync({
      storeId,
      customerName: customerName.trim() || null,
      customerPhone: customerPhone.trim() || null,
      notes: notes.trim() || null,
      lines: draftLines.map((line) => ({
        productId: line.productId,
        variantId: null,
        qty: Math.trunc(line.qty),
      })),
    });
  };

  const orderTotalKgs = useMemo(
    () =>
      draftLines.reduce((total, line) => {
        return total + (line.lineTotalKgs ?? 0);
      }, 0),
    [draftLines],
  );

  return (
    <div>
      <PageHeader
        title={isReturnMode ? t("newReturn") : t("new")}
        subtitle={isReturnMode ? t("newReturnSubtitle") : t("newSubtitle")}
      />
      {isReturnMode ? <p className="mb-4 text-sm text-muted-foreground">{t("returnModeHint")}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("detailsTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormGrid>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">{t("store")}</p>
              <Select value={storeId} onValueChange={setStoreId}>
                <SelectTrigger aria-label={t("store")}>
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
              <p className="text-sm font-medium">
                {t("customerName")} ({tCommon("optional")})
              </p>
              <Input
                value={customerName}
                onChange={(event) => setCustomerName(event.target.value)}
                placeholder={t("customerNamePlaceholder")}
                maxLength={160}
              />
            </div>

            <div className="space-y-1.5">
              <p className="text-sm font-medium">
                {t("customerPhone")} ({tCommon("optional")})
              </p>
              <Input
                value={customerPhone}
                onChange={(event) => setCustomerPhone(event.target.value)}
                placeholder={t("customerPhonePlaceholder")}
                maxLength={64}
              />
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <p className="text-sm font-medium">{t("notes")}</p>
              <Textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder={t("notesPlaceholder")}
                maxLength={2000}
                rows={4}
              />
            </div>
          </FormGrid>

          <div className="space-y-3 rounded-md border border-border p-3">
            <div className="space-y-1">
              <p className="text-sm font-medium">{t("linesTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("lineDialogSubtitle")}</p>
            </div>

            <div className="grid gap-2 sm:grid-cols-[1fr_120px]">
              <div className="relative">
                <ScanInput
                  context="linePicker"
                  value={lineSearch}
                  onValueChange={(nextValue) => {
                    setLineSearch(nextValue);
                    setShowLineSearchResults(true);
                  }}
                  onFocus={() => setShowLineSearchResults(true)}
                  onBlur={() => {
                    window.setTimeout(() => setShowLineSearchResults(false), 150);
                  }}
                  placeholder={t("productSearchPlaceholder")}
                  ariaLabel={t("productSearchPlaceholder")}
                  supportsTabSubmit
                  showDropdown={false}
                  onResolved={handleLineScanResolved}
                />
                {showLineSearchResults && lineSearch.trim().length > 0 ? (
                  <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-background shadow-lg">
                    {productSearchQuery.isLoading ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">{tCommon("loading")}</div>
                    ) : productSearchQuery.data?.length ? (
                      productSearchQuery.data.map((product) => (
                        <button
                          key={product.id}
                          type="button"
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            void addDraftLine(product as ProductSearchResult);
                          }}
                        >
                          <div className="min-w-0">
                            <p className="truncate font-medium text-foreground">{product.name}</p>
                            <p className="truncate text-xs text-muted-foreground">{product.sku}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            {product.isBundle ? (
                              <Badge variant="muted">{t("bundleProductLabel")}</Badge>
                            ) : null}
                            <AddIcon className="h-4 w-4 text-muted-foreground" aria-hidden />
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-2 text-sm text-muted-foreground">
                        {tCommon("nothingFound")}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>

              <Input
                type="number"
                min={1}
                value={pendingQty}
                onChange={(event) => setPendingQty(event.target.value)}
                className="sm:max-w-[120px]"
                aria-label={t("qty")}
              />
            </div>

            {draftLines.length ? (
              <div className="space-y-2">
                {draftLines.map((line) => (
                  <div
                    key={line.productId}
                    className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">{line.productName}</p>
                        {line.isBundle ? <Badge variant="muted">{t("bundleProductLabel")}</Badge> : null}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{line.productSku}</p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>
                          {t("unitPrice")}:{" "}
                          {line.unitPriceKgs === null
                            ? t("priceNotSet")
                            : formatCurrencyKGS(line.unitPriceKgs, locale)}
                        </span>
                        <span>
                          {t("lineTotal")}:{" "}
                          {line.lineTotalKgs === null
                            ? t("priceNotSet")
                            : formatCurrencyKGS(line.lineTotalKgs, locale)}
                        </span>
                      </div>
                    </div>
                    <div className="flex w-full items-center gap-2 sm:w-auto">
                      <Input
                        type="number"
                        min={1}
                        value={line.qtyInput}
                        onChange={(event) => updateDraftLineQty(line.productId, event.target.value)}
                        className="h-9 w-full sm:w-20"
                        aria-label={t("qty")}
                      />
                      <Button
                        variant="secondary"
                        size="icon"
                        onClick={() => removeDraftLine(line.productId)}
                        aria-label={t("removeLine")}
                      >
                        <DeleteIcon className="h-4 w-4" aria-hidden />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("noLines")}</p>
            )}
          </div>

          <div className="rounded-md border border-border p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-muted-foreground">{t("total")}</span>
              <span className="font-semibold text-foreground">
                {formatCurrencyKGS(orderTotalKgs, locale)}
              </span>
            </div>
            {draftLines.some((line) => line.unitPriceKgs === null) ? (
              <p className="mt-2 text-xs text-danger">{t("priceNotSetBlocking")}</p>
            ) : null}
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="secondary"
              className="w-full sm:w-auto"
              onClick={() => router.push("/sales/orders")}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              className="w-full sm:w-auto"
              onClick={() => void handleCreate()}
              disabled={createMutation.isLoading}
            >
              {createMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
              {t("create")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default NewSalesOrderPage;
