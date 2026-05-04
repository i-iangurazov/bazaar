"use client";

import React from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";

import { EmptyIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { formatKgsMoney, type CurrencySource } from "@/lib/currencyDisplay";
import { formatNumber } from "@/lib/i18nFormat";
import { cn } from "@/lib/utils";

export type ProductSearchResultProduct = {
  id: string;
  name: string;
  sku: string;
  primaryImage?: string | null;
  primaryBarcode?: string | null;
  barcode?: string | null;
  category?: string | null;
  categories?: string[] | null;
  type?: "product" | "bundle";
  isBundle?: boolean;
  matchType?: "barcode" | "sku" | "name";
  basePriceKgs?: number | null;
  effectivePriceKgs?: number | null;
  priceKgs?: number | null;
  onHandQty?: number | null;
  stockQty?: number | null;
};

type ProductSearchResultItemProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  product: ProductSearchResultProduct;
  active?: boolean;
  selected?: boolean;
  rightSlot?: ReactNode;
  compact?: boolean;
  currencySource?: CurrencySource;
};

const getProductCategory = (product: ProductSearchResultProduct) =>
  product.categories?.[0] ?? product.category ?? null;

const getProductPrice = (product: ProductSearchResultProduct) =>
  product.effectivePriceKgs ?? product.priceKgs ?? product.basePriceKgs ?? null;

const getProductStock = (product: ProductSearchResultProduct) =>
  product.onHandQty ?? product.stockQty ?? null;

export const ProductSearchResultItem = ({
  product,
  active,
  selected,
  rightSlot,
  compact,
  currencySource,
  className,
  ...buttonProps
}: ProductSearchResultItemProps) => {
  const t = useTranslations("products");
  const locale = useLocale();
  const isBundle = product.isBundle ?? product.type === "bundle";
  const primaryBarcode = product.primaryBarcode ?? product.barcode ?? null;
  const category = getProductCategory(product);
  const price = getProductPrice(product);
  const stock = getProductStock(product);
  const metadata = [
    product.sku ? { key: "sku", value: product.sku } : null,
    primaryBarcode ? { key: "barcode", value: primaryBarcode, title: t("searchResultBarcode") } : null,
    category ? { key: "category", value: category } : null,
    price !== null
      ? { key: "price", value: formatKgsMoney(price, locale, currencySource), title: t("searchResultPrice") }
      : null,
    stock !== null
      ? {
          key: "stock",
          value: `${t("searchResultStock")}: ${formatNumber(stock, locale)}`,
        }
      : null,
  ].filter((item): item is { key: string; value: string; title?: string } => Boolean(item));
  const visibleMetadata = metadata.slice(0, compact ? 3 : 5);

  return (
    <button
      type="button"
      className={cn(
        "group flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active || selected ? "bg-accent" : "hover:bg-accent/70",
        buttonProps.disabled ? "cursor-not-allowed opacity-60" : undefined,
        className,
      )}
      {...buttonProps}
    >
      {product.primaryImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={product.primaryImage}
          alt={product.name}
          className="h-12 w-12 shrink-0 rounded-none border border-border object-cover"
        />
      ) : (
        <span
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-none border border-dashed border-border bg-muted/40"
          title={t("imageUnavailable")}
          aria-label={t("imageUnavailable")}
        >
          <EmptyIcon className="h-4 w-4 text-muted-foreground" aria-hidden />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium text-foreground">{product.name}</span>
          {isBundle ? (
            <Badge variant="muted" className="shrink-0">
              {t("bundleProductLabel")}
            </Badge>
          ) : null}
        </span>
        <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {visibleMetadata.map((item) => (
            <span key={item.key} title={item.title} className="max-w-[160px] truncate">
              {item.value}
            </span>
          ))}
        </span>
      </span>
      {rightSlot ? <span className="shrink-0">{rightSlot}</span> : null}
    </button>
  );
};
