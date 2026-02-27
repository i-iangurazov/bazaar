"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { LanguageSwitcher } from "@/components/language-switcher";
import { AddIcon, ChevronDownIcon, DeleteIcon, MinusIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { formatCurrencyKGS } from "@/lib/i18nFormat";
import { cn } from "@/lib/utils";

type CatalogPayload = {
  slug: string;
  storeId: string;
  title: string;
  storeName: string;
  accentColor: string;
  fontFamily:
    | "NotoSans"
    | "Inter"
    | "System"
    | "Roboto"
    | "OpenSans"
    | "Montserrat"
    | "Lato"
    | "PTSans"
    | "SourceSans3"
    | "Manrope";
  headerStyle: "COMPACT" | "STANDARD";
  logoUrl: string | null;
  categories: Array<{ key: string; name: string | null; count: number }>;
  products: Array<{
    id: string;
    name: string;
    category: string | null;
    priceKgs: number;
    imageUrl: string | null;
    isBundle: boolean;
    variants: Array<{
      id: string;
      name: string;
      priceKgs: number;
    }>;
  }>;
};

type CheckoutResponse = {
  order?: {
    id: string;
    number: string;
  };
  message?: string;
};

type CatalogResponse = CatalogPayload | { message?: string };

const uncategorizedKey = "__uncategorized";
const numericPattern = /^\d*$/;
const baseVariantKey = "BASE";
const catalogImageWidths = [320, 480, 720] as const;

const catalogTypographyStyle = (fontFamily: CatalogPayload["fontFamily"]) => {
  if (fontFamily === "System") {
    return {
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      letterSpacing: "0",
    } as const;
  }
  if (fontFamily === "Inter") {
    return {
      fontFamily: "var(--font-inter), Helvetica Neue, Arial, system-ui, sans-serif",
      letterSpacing: "0.006em",
    } as const;
  }
  if (fontFamily === "Roboto") {
    return {
      fontFamily: "var(--font-roboto), Arial, Helvetica, system-ui, sans-serif",
      letterSpacing: "0.002em",
    } as const;
  }
  if (fontFamily === "OpenSans") {
    return {
      fontFamily: "var(--font-open-sans), Arial, Helvetica, system-ui, sans-serif",
      letterSpacing: "0.003em",
    } as const;
  }
  if (fontFamily === "Montserrat") {
    return {
      fontFamily: "var(--font-montserrat), Arial, Helvetica, system-ui, sans-serif",
      letterSpacing: "0.01em",
    } as const;
  }
  if (fontFamily === "Lato") {
    return {
      fontFamily: "var(--font-lato), Arial, Helvetica, system-ui, sans-serif",
      letterSpacing: "0.004em",
    } as const;
  }
  if (fontFamily === "PTSans") {
    return {
      fontFamily: "var(--font-pt-sans), Arial, Helvetica, system-ui, sans-serif",
      letterSpacing: "0.002em",
    } as const;
  }
  if (fontFamily === "SourceSans3") {
    return {
      fontFamily: "var(--font-source-sans-3), Arial, Helvetica, system-ui, sans-serif",
      letterSpacing: "0.003em",
    } as const;
  }
  if (fontFamily === "Manrope") {
    return {
      fontFamily: "var(--font-manrope), Arial, Helvetica, system-ui, sans-serif",
      letterSpacing: "0.008em",
    } as const;
  }
  return {
    fontFamily: "var(--font-sans), system-ui, sans-serif",
    letterSpacing: "0",
  } as const;
};

const categoryKeyOf = (category: string | null | undefined) =>
  category?.trim() ? category.toLowerCase() : uncategorizedKey;

const sanitizeAccent = (value?: string | null) =>
  value && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : "#2a6be4";

const isProxyableCatalogImageUrl = (sourceUrl: string | null | undefined) => {
  const normalized = sourceUrl?.trim();
  if (!normalized) {
    return false;
  }
  if (normalized.startsWith("/uploads/imported-products/")) {
    return true;
  }
  try {
    const parsed = new URL(normalized);
    const pathname = parsed.pathname.toLowerCase();
    return pathname.includes("/uploads/imported-products/") || pathname.includes("/retails/");
  } catch {
    return false;
  }
};

const toCatalogImageUrl = (sourceUrl: string | null | undefined, width: number) => {
  const normalized = sourceUrl?.trim();
  if (!normalized || !isProxyableCatalogImageUrl(normalized)) {
    return null;
  }
  const params = new URLSearchParams({
    url: normalized,
    w: String(width),
    q: "78",
  });
  return `/api/public/catalog/image?${params.toString()}`;
};

const cartKeyOf = (productId: string, variantId?: string | null) =>
  `${productId}:${variantId ?? baseVariantKey}`;

const parseCartKey = (value: string) => {
  const separator = value.indexOf(":");
  if (separator <= 0) {
    return null;
  }
  const productId = value.slice(0, separator);
  const variantKey = value.slice(separator + 1);
  if (!productId || !variantKey) {
    return null;
  }
  return {
    productId,
    variantId: variantKey === baseVariantKey ? null : variantKey,
  };
};

export const PublicCatalogPage = ({ slug }: { slug: string }) => {
  const t = useTranslations("catalogPublic");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();

  const [catalog, setCatalog] = useState<CatalogPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
  const [cart, setCart] = useState<Record<string, number>>({});
  const [qtyInputs, setQtyInputs] = useState<Record<string, string>>({});
  const [selectedVariants, setSelectedVariants] = useState<Record<string, string | undefined>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutStep, setCheckoutStep] = useState<"cart" | "form" | "success">("cart");
  const [checkoutName, setCheckoutName] = useState("");
  const [checkoutPhone, setCheckoutPhone] = useState("");
  const [checkoutComment, setCheckoutComment] = useState("");
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setErrorMessage(null);
      try {
        const response = await fetch(`/api/public/catalog/${encodeURIComponent(slug)}`, {
          method: "GET",
          cache: "no-store",
        });
        const body = (await response.json().catch(() => ({}))) as CatalogResponse;
        if (!response.ok || !("products" in body)) {
          const key = "message" in body && body.message ? body.message : "genericMessage";
          const message = tErrors.has?.(key) ? tErrors(key) : tErrors("genericMessage");
          throw new Error(message);
        }
        if (!cancelled) {
          setCatalog(body);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : tErrors("genericMessage"));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [slug, tErrors]);

  const accentColor = sanitizeAccent(catalog?.accentColor);

  const visibleProducts = useMemo(() => {
    if (!catalog) {
      return [];
    }
    const normalizedSearch = search.trim().toLowerCase();
    return catalog.products.filter((product) => {
      const matchesCategory =
        categoryFilter === "all" ? true : categoryKeyOf(product.category) === categoryFilter;
      const matchesSearch = normalizedSearch
        ? product.name.toLowerCase().includes(normalizedSearch)
        : true;
      return matchesCategory && matchesSearch;
    });
  }, [catalog, categoryFilter, search]);

  const groupedProducts = useMemo(() => {
    const map = new Map<
      string,
      { key: string; name: string | null; count: number; products: CatalogPayload["products"] }
    >();
    for (const product of visibleProducts) {
      const key = categoryKeyOf(product.category);
      const existing = map.get(key);
      if (existing) {
        existing.products.push(product);
        existing.count += 1;
      } else {
        map.set(key, {
          key,
          name: product.category?.trim() || null,
          count: 1,
          products: [product],
        });
      }
    }

    const categories = Array.from(map.values()).sort((left, right) =>
      (left.name ?? "").localeCompare(right.name ?? "", "ru"),
    );
    return categories;
  }, [visibleProducts]);

  const hasNamedCategories = useMemo(
    () => (catalog?.categories ?? []).some((category) => Boolean(category.name?.trim())),
    [catalog?.categories],
  );

  useEffect(() => {
    if (hasNamedCategories || categoryFilter === "all") {
      return;
    }
    setCategoryFilter("all");
  }, [categoryFilter, hasNamedCategories]);

  const priorityProductIds = useMemo(
    () => new Set(visibleProducts.slice(0, 8).map((product) => product.id)),
    [visibleProducts],
  );

  const productsById = useMemo(() => {
    const map = new Map<string, CatalogPayload["products"][number]>();
    for (const product of catalog?.products ?? []) {
      map.set(product.id, product);
    }
    return map;
  }, [catalog?.products]);

  const cartItems = useMemo(() => {
    return Object.entries(cart)
      .map(([lineKey, qty]) => {
        const parsed = parseCartKey(lineKey);
        if (!parsed) {
          return null;
        }
        const product = productsById.get(parsed.productId);
        if (!product || qty < 1) {
          return null;
        }
        const variant = parsed.variantId
          ? product.variants.find((entry) => entry.id === parsed.variantId) ?? null
          : null;
        if (parsed.variantId && !variant) {
          return null;
        }
        const unitPriceKgs = variant?.priceKgs ?? product.priceKgs;
        return {
          lineKey,
          product,
          variant,
          qty,
          unitPriceKgs,
          lineTotal: qty * unitPriceKgs,
        };
      })
      .filter(
        (
          item,
        ): item is {
          lineKey: string;
          product: CatalogPayload["products"][number];
          variant: CatalogPayload["products"][number]["variants"][number] | null;
          qty: number;
          unitPriceKgs: number;
          lineTotal: number;
        } => Boolean(item),
      );
  }, [cart, productsById]);

  const cartItemsCount = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.qty, 0),
    [cartItems],
  );
  const cartTotal = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.lineTotal, 0),
    [cartItems],
  );

  const setLineQty = (lineKey: string, nextQty: number) => {
    setCart((prev) => {
      const next = { ...prev };
      if (!Number.isFinite(nextQty) || nextQty < 1) {
        delete next[lineKey];
      } else {
        next[lineKey] = Math.trunc(nextQty);
      }
      return next;
    });
    setQtyInputs((prev) => {
      const next = { ...prev };
      if (!Number.isFinite(nextQty) || nextQty < 1) {
        delete next[lineKey];
      } else {
        next[lineKey] = String(Math.trunc(nextQty));
      }
      return next;
    });
  };

  const adjustLineQty = (lineKey: string, delta: number) => {
    const current = cart[lineKey] ?? 0;
    setLineQty(lineKey, current + delta);
  };

  const handleQtyInputChange = (lineKey: string, value: string) => {
    if (!numericPattern.test(value)) {
      return;
    }
    setQtyInputs((prev) => ({ ...prev, [lineKey]: value }));
    if (!value) {
      setCart((prev) => {
        const next = { ...prev };
        delete next[lineKey];
        return next;
      });
      return;
    }
    const qty = Number(value);
    if (Number.isFinite(qty) && qty >= 1) {
      setCart((prev) => ({ ...prev, [lineKey]: Math.trunc(qty) }));
    }
  };

  const handleQtyInputBlur = (lineKey: string) => {
    const raw = qtyInputs[lineKey];
    if (raw === undefined) {
      return;
    }
    if (!raw) {
      setLineQty(lineKey, 0);
      return;
    }
    const qty = Number(raw);
    if (!Number.isFinite(qty) || qty < 1) {
      const existing = cart[lineKey] ?? 0;
      setLineQty(lineKey, existing);
      return;
    }
    setLineQty(lineKey, Math.trunc(qty));
  };

  const openCart = () => {
    if (!cartItems.length) {
      return;
    }
    setCheckoutStep("cart");
    setSubmitError(null);
    setCartOpen(true);
  };

  const closeCart = () => {
    if (submitting) {
      return;
    }
    setCartOpen(false);
    setCheckoutStep("cart");
    setSubmitError(null);
  };

  const submitCheckout = async () => {
    if (!catalog || !cartItems.length || submitting) {
      return;
    }
    if (!checkoutName.trim() || !checkoutPhone.trim()) {
      setSubmitError(t("checkoutRequired"));
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await fetch(
        `/api/public/catalog/${encodeURIComponent(catalog.slug)}/checkout`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            customerName: checkoutName.trim(),
            customerPhone: checkoutPhone.trim(),
            comment: checkoutComment.trim() || null,
            lines: cartItems.map((item) => ({
              productId: item.product.id,
              variantId: item.variant?.id ?? null,
              qty: item.qty,
            })),
          }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as CheckoutResponse;
      if (!response.ok || !body.order) {
        const key = body.message ?? "genericMessage";
        const message = tErrors.has?.(key) ? tErrors(key) : tErrors("genericMessage");
        throw new Error(message);
      }
      setOrderNumber(body.order.number);
      setCheckoutStep("success");
      setCart({});
      setQtyInputs({});
      setCheckoutName("");
      setCheckoutPhone("");
      setCheckoutComment("");
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : tErrors("genericMessage"));
    } finally {
      setSubmitting(false);
    }
  };

  const renderProductCard = (
    product: CatalogPayload["products"][number],
    prioritizeImage: boolean,
  ) => {
    const selectedVariantId = selectedVariants[product.id];
    const selectedVariant = selectedVariantId
      ? product.variants.find((variant) => variant.id === selectedVariantId) ?? null
      : null;
    const lineKey = cartKeyOf(product.id, product.variants.length ? selectedVariant?.id ?? null : null);
    const qty = cart[lineKey] ?? 0;
    const qtyInput = qtyInputs[lineKey] ?? (qty > 0 ? String(qty) : "");
    const displayPrice = selectedVariant?.priceKgs ?? product.priceKgs;
    const canAdjustQty = product.variants.length === 0 || Boolean(selectedVariant);
    const optimizedImageSources = product.imageUrl
      ? catalogImageWidths
          .map((width) => {
            const optimizedUrl = toCatalogImageUrl(product.imageUrl, width);
            return optimizedUrl ? `${optimizedUrl} ${width}w` : null;
          })
          .filter((value): value is string => Boolean(value))
      : [];
    const imageSrc = toCatalogImageUrl(product.imageUrl, 720) ?? product.imageUrl;
    const imageSrcSet = optimizedImageSources.length ? optimizedImageSources.join(", ") : undefined;

    return (
      <Card key={product.id} className="overflow-hidden">
        <CardContent className="space-y-3 p-3">
          <div className="aspect-[4/3] overflow-hidden rounded-lg bg-secondary">
            {product.imageUrl ? (
              <img
                src={imageSrc ?? undefined}
                srcSet={imageSrcSet}
                sizes="(max-width: 640px) calc(100vw - 3rem), (max-width: 1024px) calc(50vw - 3.5rem), (max-width: 1280px) calc(33vw - 3.75rem), 260px"
                alt={product.name}
                loading={prioritizeImage ? "eager" : "lazy"}
                fetchPriority={prioritizeImage ? "high" : "auto"}
                decoding="async"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                {t("imageFallback")}
              </div>
            )}
          </div>
          <div className="space-y-1">
            <p className="line-clamp-2 text-sm font-semibold text-foreground">{product.name}</p>
            <p className="text-sm text-muted-foreground">{formatCurrencyKGS(displayPrice, locale)}</p>
          </div>
          {product.variants.length ? (
            <div className="space-y-2">
              <Select
                value={selectedVariantId}
                onValueChange={(value) =>
                  setSelectedVariants((prev) => ({
                    ...prev,
                    [product.id]: value,
                  }))
                }
              >
                <SelectTrigger
                  className="h-9"
                  aria-label={t("variantSelectAria", { product: product.name })}
                >
                  <SelectValue placeholder={t("variantSelectPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {product.variants.map((variant) => (
                    <SelectItem key={variant.id} value={variant.id}>
                      {variant.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {canAdjustQty ? (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="h-10 w-10 shrink-0"
                    aria-label={t("qtyDecrease", { product: product.name })}
                    onClick={() => adjustLineQty(lineKey, -1)}
                  >
                    <MinusIcon className="h-4 w-4" aria-hidden />
                  </Button>
                  <Input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={qtyInput}
                    onChange={(event) => handleQtyInputChange(lineKey, event.target.value)}
                    onBlur={() => handleQtyInputBlur(lineKey)}
                    aria-label={t("qtyInputAria", { product: product.name })}
                    className="h-10 text-center"
                  />
                  <Button
                    type="button"
                    size="icon"
                    className="h-10 w-10 shrink-0 text-white hover:opacity-95"
                    aria-label={t("qtyIncrease", { product: product.name })}
                    onClick={() => adjustLineQty(lineKey, 1)}
                    style={{ backgroundColor: accentColor }}
                  >
                    <AddIcon className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">{t("variantSelectHint")}</p>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="h-10 w-10 shrink-0"
                aria-label={t("qtyDecrease", { product: product.name })}
                onClick={() => adjustLineQty(lineKey, -1)}
              >
                <MinusIcon className="h-4 w-4" aria-hidden />
              </Button>
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={qtyInput}
                onChange={(event) => handleQtyInputChange(lineKey, event.target.value)}
                onBlur={() => handleQtyInputBlur(lineKey)}
                aria-label={t("qtyInputAria", { product: product.name })}
                className="h-10 text-center"
              />
              <Button
                type="button"
                size="icon"
                className="h-10 w-10 shrink-0 text-white hover:opacity-95"
                aria-label={t("qtyIncrease", { product: product.name })}
                onClick={() => adjustLineQty(lineKey, 1)}
                style={{ backgroundColor: accentColor }}
              >
                <AddIcon className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
        <div className="animate-pulse space-y-6">
          <div className="space-y-3">
            <div className="h-16 w-16 rounded-xl bg-muted" />
            <div className="h-8 w-56 rounded-md bg-muted" />
            <div className="h-10 w-full rounded-md bg-muted" />
            <div className="h-10 w-full rounded-md bg-muted" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <Card key={`skeleton-${index}`}>
                <CardContent className="space-y-3 p-4">
                  <div className="h-36 rounded-md bg-muted" />
                  <div className="h-4 w-2/3 rounded bg-muted" />
                  <div className="h-4 w-1/3 rounded bg-muted" />
                  <div className="h-10 rounded bg-muted" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!catalog || errorMessage) {
    return (
      <div className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col items-center justify-center gap-4 px-4 text-center sm:px-6">
        <p className="text-lg font-semibold">{t("notFoundTitle")}</p>
        <p className="text-sm text-muted-foreground">{errorMessage ?? t("notFoundDescription")}</p>
        <Button type="button" onClick={() => router.refresh()}>
          {t("retry")}
        </Button>
      </div>
    );
  }

  const isCompactHeader = catalog.headerStyle === "COMPACT";
  const optimizedLogoSources = catalog.logoUrl
    ? [90, 180]
        .map((width) => {
          const optimizedUrl = toCatalogImageUrl(catalog.logoUrl, width);
          return optimizedUrl ? `${optimizedUrl} ${width}w` : null;
        })
        .filter((value): value is string => Boolean(value))
    : [];
  const logoSrc = toCatalogImageUrl(catalog.logoUrl, 180) ?? catalog.logoUrl ?? undefined;

  return (
    <div
      className="relative mx-auto w-full max-w-7xl px-4 pb-32 pt-4 sm:px-6 sm:pb-20"
      style={catalogTypographyStyle(catalog.fontFamily)}
    >
      <div
        className={cn(
          "rounded-2xl border border-border/80 bg-card/80 shadow-sm",
          isCompactHeader ? "p-3 sm:p-4" : "p-4 sm:p-5",
        )}
      >
        <div className={isCompactHeader ? "space-y-2.5" : "space-y-4"}>
          <div
            className={cn(
              "flex justify-between gap-2",
              isCompactHeader ? "items-center" : "items-start",
            )}
          >
            <div className={cn("flex min-w-0 items-center", isCompactHeader ? "gap-2" : "gap-3")}>
              {catalog.logoUrl ? (
                <img
                  src={logoSrc}
                  srcSet={optimizedLogoSources.length ? optimizedLogoSources.join(", ") : undefined}
                  sizes={isCompactHeader ? "44px" : "56px"}
                  alt={t("logoAlt", { store: catalog.storeName })}
                  loading="eager"
                  fetchPriority="high"
                  decoding="async"
                  className={cn(
                    "rounded-xl border border-border object-cover",
                    isCompactHeader ? "h-11 w-11" : "h-14 w-14",
                  )}
                />
              ) : (
                <div
                  className={cn(
                    "flex items-center justify-center rounded-xl border border-border bg-secondary font-semibold",
                    isCompactHeader ? "h-11 w-11 text-base" : "h-14 w-14 text-xl",
                  )}
                >
                  {catalog.storeName.slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <h1
                  className={cn(
                    "truncate font-semibold text-foreground",
                    isCompactHeader ? "text-lg sm:text-xl" : "text-xl sm:text-2xl",
                  )}
                >
                  {catalog.title}
                </h1>
                <p
                  className={cn(
                    "truncate text-muted-foreground",
                    isCompactHeader ? "text-[11px]" : "text-xs sm:text-sm",
                  )}
                >
                  {catalog.storeName}
                </p>
              </div>
            </div>
            <LanguageSwitcher
              compact={isCompactHeader}
              className="shrink-0 rounded-xl bg-background/70"
              activeButtonClassName="text-white"
              activeButtonStyle={{ backgroundColor: accentColor, borderColor: accentColor }}
              buttonClassName="font-medium"
            />
          </div>

          <div
            className={cn(
              "grid gap-2",
              hasNamedCategories
                ? isCompactHeader
                  ? "sm:grid-cols-[minmax(0,1fr)_11.5rem]"
                  : "sm:grid-cols-[minmax(0,1fr)_minmax(12rem,16rem)]"
                : "grid-cols-1",
            )}
          >
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchAria")}
              className={isCompactHeader ? "h-9" : "h-10"}
            />
            {hasNamedCategories ? (
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger
                  aria-label={t("categoryFilterAria")}
                  className={isCompactHeader ? "h-9" : "h-10"}
                >
                  <SelectValue placeholder={t("allCategories")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allCategories")}</SelectItem>
                  {catalog.categories.map((category) => (
                    <SelectItem key={category.key} value={category.key}>
                      {(category.name ?? t("uncategorized")) + ` (${category.count})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-6 space-y-4">
        {groupedProducts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {t("emptyProducts")}
          </div>
        ) : !hasNamedCategories ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visibleProducts.map((product) => renderProductCard(product, priorityProductIds.has(product.id)))}
          </div>
        ) : (
          groupedProducts.map((group) => {
            const collapsed = collapsedCategories[group.key] ?? false;
            return (
              <section key={group.key} className="rounded-2xl border border-border/70 bg-card/70">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                  onClick={() =>
                    setCollapsedCategories((prev) => ({
                      ...prev,
                      [group.key]: !collapsed,
                    }))
                  }
                >
                  <span className="text-sm font-semibold text-foreground sm:text-base">
                    {group.name ?? t("uncategorized")}
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <Badge variant="muted">{group.count}</Badge>
                    <ChevronDownIcon
                      className={`h-4 w-4 text-muted-foreground transition-transform ${
                        collapsed ? "" : "rotate-180"
                      }`}
                      aria-hidden
                    />
                  </span>
                </button>
                {!collapsed ? (
                  <div className="grid gap-3 border-t border-border/70 p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {group.products.map((product) => renderProductCard(product, priorityProductIds.has(product.id)))}
                  </div>
                ) : null}
              </section>
            );
          })
        )}
      </div>

      {cartItemsCount > 0 ? (
        <>
          <div
            className="fixed inset-x-0 bottom-0 z-40 px-3 sm:hidden"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)" }}
          >
            <button
              type="button"
              onClick={openCart}
              className="mx-auto flex h-[4.35rem] w-full max-w-xl items-center justify-between rounded-2xl border border-border/80 bg-card px-4 shadow-2xl backdrop-blur"
              style={{ borderLeft: `4px solid ${accentColor}` }}
            >
              <span className="inline-flex items-center gap-2">
                <span className="text-base font-semibold">{formatCurrencyKGS(cartTotal, locale)}</span>
              </span>
              <span
                className="inline-flex items-center rounded-xl px-3.5 py-2 text-sm font-semibold text-white shadow-sm"
                style={{ backgroundColor: accentColor }}
              >
                {t("cartButton", { count: cartItemsCount })}
              </span>
            </button>
          </div>
          <div className="fixed bottom-4 right-6 z-40 hidden sm:block">
            <button
              type="button"
              onClick={openCart}
              className="inline-flex h-12 items-center gap-3 rounded-xl border border-border/80 bg-card px-4 shadow-xl"
              style={{ borderLeft: `4px solid ${accentColor}` }}
            >
              <span className="text-sm font-semibold">
                {t("cartButton", { count: cartItemsCount })}
              </span>
              <span className="text-sm font-semibold text-muted-foreground">
                {formatCurrencyKGS(cartTotal, locale)}
              </span>
            </button>
          </div>
        </>
      ) : null}

      <Modal
        open={cartOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeCart();
            return;
          }
          setCartOpen(true);
        }}
        title={checkoutStep === "success" ? t("successTitle") : t("cartTitle")}
        className="max-w-none sm:w-[94vw] sm:max-w-5xl lg:w-[50vw] lg:max-w-6xl"
        headerClassName="p-4 sm:p-5"
        bodyClassName="max-h-[72dvh] p-4 sm:p-5"
        mobileSheet
        animated
      >
        {checkoutStep === "success" ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-muted-foreground">{t("successDescription")}</p>
            {orderNumber ? (
              <p className="text-sm font-semibold">{t("successOrderNumber", { number: orderNumber })}</p>
            ) : null}
            <Button
              type="button"
              onClick={closeCart}
              className="text-white hover:opacity-95"
              style={{ backgroundColor: accentColor }}
            >
              {t("successClose")}
            </Button>
          </div>
        ) : checkoutStep === "form" ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold" htmlFor="checkout-name">
                {t("checkoutName")}
              </label>
              <Input
                id="checkout-name"
                value={checkoutName}
                onChange={(event) => setCheckoutName(event.target.value)}
                placeholder={t("checkoutNamePlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold" htmlFor="checkout-phone">
                {t("checkoutPhone")}
              </label>
              <Input
                id="checkout-phone"
                value={checkoutPhone}
                onChange={(event) => setCheckoutPhone(event.target.value)}
                placeholder={t("checkoutPhonePlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold" htmlFor="checkout-comment">
                {t("checkoutComment")}
              </label>
              <Input
                id="checkout-comment"
                value={checkoutComment}
                onChange={(event) => setCheckoutComment(event.target.value)}
                placeholder={t("checkoutCommentPlaceholder")}
              />
            </div>
            {submitError ? <p className="text-sm text-danger">{submitError}</p> : null}
            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCheckoutStep("cart")}
                disabled={submitting}
              >
                {t("checkoutBack")}
              </Button>
              <Button
                type="button"
                onClick={submitCheckout}
                disabled={submitting}
                className="text-white hover:opacity-95"
                style={{ backgroundColor: accentColor }}
              >
                {submitting ? <Spinner className="h-4 w-4" /> : null}
                {t("checkoutSubmit")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {cartItems.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
                <p className="text-sm font-semibold">{t("cartEmptyTitle")}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t("cartEmptyDescription")}</p>
              </div>
            ) : (
              <>
                <div className="max-h-[40dvh] space-y-3 overflow-y-auto pr-1 sm:max-h-[46dvh]">
                  {cartItems.map((item) => {
                    const qtyInput = qtyInputs[item.lineKey] ?? String(item.qty);
                    return (
                      <div key={item.lineKey} className="rounded-lg border border-border p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold">{item.product.name}</p>
                            {item.variant ? (
                              <p className="text-xs text-muted-foreground">{item.variant.name}</p>
                            ) : null}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-danger"
                            aria-label={t("cartRemoveAria", {
                              product: item.variant
                                ? `${item.product.name} (${item.variant.name})`
                                : item.product.name,
                            })}
                            onClick={() => setLineQty(item.lineKey, 0)}
                          >
                            <DeleteIcon className="h-4 w-4" aria-hidden />
                          </Button>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatCurrencyKGS(item.unitPriceKgs, locale)}
                        </p>
                        <div className="mt-3 flex items-center gap-2">
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            className="h-10 w-10 shrink-0"
                            aria-label={t("qtyDecrease", { product: item.product.name })}
                            onClick={() => adjustLineQty(item.lineKey, -1)}
                          >
                            <MinusIcon className="h-4 w-4" aria-hidden />
                          </Button>
                          <Input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={qtyInput}
                            onChange={(event) =>
                              handleQtyInputChange(item.lineKey, event.target.value)
                            }
                            onBlur={() => handleQtyInputBlur(item.lineKey)}
                            aria-label={t("qtyInputAria", { product: item.product.name })}
                            className="h-10 max-w-16 text-center"
                          />
                          <Button
                            type="button"
                            size="icon"
                            className="h-10 w-10 shrink-0 text-white hover:opacity-95"
                            aria-label={t("qtyIncrease", { product: item.product.name })}
                            onClick={() => adjustLineQty(item.lineKey, 1)}
                            style={{ backgroundColor: accentColor }}
                          >
                            <AddIcon className="h-4 w-4" aria-hidden />
                          </Button>
                          <p className="ml-auto text-sm font-semibold">
                            {formatCurrencyKGS(item.lineTotal, locale)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="shrink-0 border-t border-border pt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{t("cartTotal")}</span>
                    <span className="text-base font-semibold">
                      {formatCurrencyKGS(cartTotal, locale)}
                    </span>
                  </div>
                  <Button
                    type="button"
                    className="mt-3 w-full text-white hover:opacity-95"
                    onClick={() => setCheckoutStep("form")}
                    style={{ backgroundColor: accentColor }}
                  >
                    {t("checkoutOpen")}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>

      <div className="mt-10 text-center">
        <Link href="/" className="inline-flex items-center justify-center rounded-md px-2 py-1 hover:opacity-90">
          <img src="/brand/logo.png" alt={t("poweredBy")} className="h-7 w-auto" />
          <span className="sr-only">{t("poweredBy")}</span>
        </Link>
      </div>
    </div>
  );
};
