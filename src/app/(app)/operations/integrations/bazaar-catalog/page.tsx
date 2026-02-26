"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  BazaarCatalogFontFamily,
  BazaarCatalogHeaderStyle,
  BazaarCatalogStatus,
} from "@prisma/client";
import { useTranslations } from "next-intl";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronDownIcon, CopyIcon, IntegrationsIcon, ViewIcon } from "@/components/icons";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { cn } from "@/lib/utils";

type CatalogFormState = {
  title: string;
  accentColor: string;
  fontFamily: BazaarCatalogFontFamily;
  headerStyle: BazaarCatalogHeaderStyle;
  logoImageId: string | null;
  logoUrl: string | null;
  publish: boolean;
};

const DEFAULT_ACCENT_COLOR = "#2a6be4";
const accentColorPattern = /^#[0-9a-fA-F]{6}$/;

const previewFontStyle = (fontFamily: BazaarCatalogFontFamily) => {
  if (fontFamily === BazaarCatalogFontFamily.System) {
    return {
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      letterSpacing: "0",
    } as const;
  }
  if (fontFamily === BazaarCatalogFontFamily.Inter) {
    return {
      fontFamily: "var(--font-inter), Helvetica Neue, Arial, system-ui, sans-serif",
      letterSpacing: "0.006em",
    } as const;
  }
  if (fontFamily === BazaarCatalogFontFamily.Roboto) {
    return {
      fontFamily: "var(--font-roboto), Arial, Helvetica, system-ui, sans-serif",
      letterSpacing: "0.002em",
    } as const;
  }
  if (fontFamily === BazaarCatalogFontFamily.OpenSans) {
    return {
      fontFamily: "var(--font-open-sans), Arial, Helvetica, system-ui, sans-serif",
      letterSpacing: "0.003em",
    } as const;
  }
  if (fontFamily === BazaarCatalogFontFamily.Montserrat) {
    return {
      fontFamily: "var(--font-montserrat), Arial, Helvetica, system-ui, sans-serif",
      letterSpacing: "0.01em",
    } as const;
  }
  if (fontFamily === BazaarCatalogFontFamily.Lato) {
    return {
      fontFamily: "var(--font-lato), Arial, Helvetica, system-ui, sans-serif",
      letterSpacing: "0.004em",
    } as const;
  }
  if (fontFamily === BazaarCatalogFontFamily.PTSans) {
    return {
      fontFamily: "var(--font-pt-sans), Arial, Helvetica, system-ui, sans-serif",
      letterSpacing: "0.002em",
    } as const;
  }
  if (fontFamily === BazaarCatalogFontFamily.SourceSans3) {
    return {
      fontFamily: "var(--font-source-sans-3), Arial, Helvetica, system-ui, sans-serif",
      letterSpacing: "0.003em",
    } as const;
  }
  if (fontFamily === BazaarCatalogFontFamily.Manrope) {
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

const fontOptions: Array<{ value: BazaarCatalogFontFamily; labelKey: string }> = [
  { value: BazaarCatalogFontFamily.NotoSans, labelKey: "fontNotoSans" },
  { value: BazaarCatalogFontFamily.Inter, labelKey: "fontInter" },
  { value: BazaarCatalogFontFamily.System, labelKey: "fontSystem" },
  { value: BazaarCatalogFontFamily.Roboto, labelKey: "fontRoboto" },
  { value: BazaarCatalogFontFamily.OpenSans, labelKey: "fontOpenSans" },
  { value: BazaarCatalogFontFamily.Montserrat, labelKey: "fontMontserrat" },
  { value: BazaarCatalogFontFamily.Lato, labelKey: "fontLato" },
  { value: BazaarCatalogFontFamily.PTSans, labelKey: "fontPTSans" },
  { value: BazaarCatalogFontFamily.SourceSans3, labelKey: "fontSourceSans3" },
  { value: BazaarCatalogFontFamily.Manrope, labelKey: "fontManrope" },
];

const resolveAbsoluteCatalogUrl = (publicUrlPath: string) => {
  const configuredBase = process.env.NEXT_PUBLIC_BAZAAR_CATALOG_BASE_URL?.trim();
  if (configuredBase) {
    return new URL(publicUrlPath, configuredBase).toString();
  }
  if (typeof window !== "undefined") {
    return new URL(publicUrlPath, window.location.origin).toString();
  }
  return publicUrlPath;
};

const BazaarCatalogSettingsPage = () => {
  const t = useTranslations("bazaarCatalogSettings");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const { data: session } = useSession();
  const { toast } = useToast();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const storeIdParam = searchParams.get("storeId");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const role = session?.user?.role ?? "STAFF";
  const canView = role === "ADMIN" || role === "MANAGER" || role === "STAFF";
  const canEdit = role === "ADMIN" || role === "MANAGER";

  const storesQuery = trpc.bazaarCatalog.listStores.useQuery(undefined, {
    enabled: canView,
  });
  const stores = storesQuery.data ?? [];

  const selectedStoreId =
    stores.find((store) => store.storeId === storeIdParam)?.storeId ?? stores[0]?.storeId ?? "";

  useEffect(() => {
    if (!stores.length || !selectedStoreId || storeIdParam === selectedStoreId) {
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set("storeId", selectedStoreId);
    const next = params.toString();
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  }, [pathname, router, searchParams, selectedStoreId, storeIdParam, stores.length]);

  const settingsQuery = trpc.bazaarCatalog.getSettings.useQuery(
    { storeId: selectedStoreId },
    {
      enabled: canView && Boolean(selectedStoreId),
    },
  );

  const upsertMutation = trpc.bazaarCatalog.upsert.useMutation({
    onSuccess: async () => {
      await Promise.all([settingsQuery.refetch(), storesQuery.refetch()]);
      toast({ variant: "success", description: t("saved") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const [formState, setFormState] = useState<CatalogFormState | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    if (!settingsQuery.data) {
      return;
    }
    const catalog = settingsQuery.data.catalog;
    setFormState({
      title: catalog.title ?? settingsQuery.data.store.name,
      accentColor: catalog.accentColor ?? DEFAULT_ACCENT_COLOR,
      fontFamily: catalog.fontFamily ?? BazaarCatalogFontFamily.NotoSans,
      headerStyle: catalog.headerStyle ?? BazaarCatalogHeaderStyle.STANDARD,
      logoImageId: catalog.logoImageId ?? null,
      logoUrl: catalog.logoUrl ?? null,
      publish: catalog.status === BazaarCatalogStatus.PUBLISHED,
    });
  }, [settingsQuery.data]);

  const publicLink = useMemo(() => {
    if (
      settingsQuery.data?.catalog.status !== BazaarCatalogStatus.PUBLISHED ||
      !settingsQuery.data.catalog.publicUrlPath
    ) {
      return null;
    }
    return resolveAbsoluteCatalogUrl(settingsQuery.data.catalog.publicUrlPath);
  }, [settingsQuery.data?.catalog.publicUrlPath, settingsQuery.data?.catalog.status]);

  const syncStoreParam = (nextStoreId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("storeId", nextStoreId);
    const next = params.toString();
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  };

  const handleCopyPublicLink = async () => {
    if (!publicLink) {
      return;
    }
    try {
      await navigator.clipboard.writeText(publicLink);
      toast({ variant: "success", description: t("copySuccess") });
    } catch {
      toast({ variant: "error", description: t("copyFailed") });
    }
  };

  const handleLogoUpload = async (file: File | null) => {
    if (!file || !selectedStoreId) {
      return;
    }
    setUploadingLogo(true);
    try {
      const payload = new FormData();
      payload.set("file", file);
      payload.set("storeId", selectedStoreId);
      const response = await fetch("/api/bazaar-catalog/logo", {
        method: "POST",
        body: payload,
      });
      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
        image?: { id: string; url: string };
      };
      if (!response.ok || !body.image) {
        const message =
          body.message === "imageTooLarge"
            ? t("logoTooLarge")
            : body.message === "imageInvalidType"
              ? t("logoInvalidType")
              : body.message && tErrors.has?.(body.message)
                ? tErrors(body.message)
                : t("logoUploadFailed");
        throw new Error(message);
      }
      setFormState((prev) =>
        prev
          ? {
              ...prev,
              logoImageId: body.image?.id ?? null,
              logoUrl: body.image?.url ?? null,
            }
          : prev,
      );
    } catch (error) {
      toast({
        variant: "error",
        description: error instanceof Error ? error.message : tErrors("genericMessage"),
      });
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleSave = () => {
    if (!formState || !selectedStoreId) {
      return;
    }
    if (!accentColorPattern.test(formState.accentColor.trim())) {
      toast({ variant: "error", description: t("accentColorInvalid") });
      return;
    }
    upsertMutation.mutate({
      storeId: selectedStoreId,
      title: formState.title.trim() || null,
      accentColor: formState.accentColor.trim(),
      fontFamily: formState.fontFamily,
      headerStyle: formState.headerStyle,
      logoImageId: formState.logoImageId ?? null,
      status: formState.publish ? BazaarCatalogStatus.PUBLISHED : BazaarCatalogStatus.DRAFT,
    });
  };
  const settingsData = settingsQuery.data;

  if (!canView) {
    return (
      <div>
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <p className="text-sm text-danger">{tErrors("forbidden")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <Card>
        <CardHeader>
          <CardTitle>{t("storeSelectorTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={selectedStoreId} onValueChange={syncStoreParam}>
            <SelectTrigger aria-label={t("storeSelector")}>
              <SelectValue placeholder={t("storeSelector")} />
            </SelectTrigger>
            <SelectContent>
              {stores.map((store) => (
                <SelectItem key={store.storeId} value={store.storeId}>
                  {store.storeName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {!selectedStoreId || settingsQuery.isLoading || !settingsData || !formState ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4" />
            {tCommon("loading")}
          </CardContent>
        </Card>
      ) : (
        <>
          {publicLink ? (
            <Card className="border-success/40">
              <CardHeader className="space-y-2">
                <CardTitle className="text-base">{t("publicLinkTitle")}</CardTitle>
                <p className="break-all text-sm text-muted-foreground">{publicLink}</p>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={handleCopyPublicLink}>
                  <CopyIcon className="h-4 w-4" aria-hidden />
                  {tCommon("tooltips.copyLink")}
                </Button>
                <Link href={publicLink} target="_blank" rel="noopener noreferrer">
                  <Button type="button" variant="secondary">
                    <ViewIcon className="h-4 w-4" aria-hidden />
                    {t("openCatalog")}
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2 text-xl">
                  <IntegrationsIcon className="h-5 w-5 text-primary" aria-hidden />
                  {t("brandingTitle")}
                </CardTitle>
                <Badge
                  variant={
                    settingsData.catalog.status === BazaarCatalogStatus.PUBLISHED
                      ? "success"
                      : settingsData.catalog.id
                        ? "warning"
                        : "muted"
                  }
                >
                  {settingsData.catalog.status === BazaarCatalogStatus.PUBLISHED
                    ? t("statusPublished")
                    : settingsData.catalog.id
                      ? t("statusDraft")
                      : t("statusNotConfigured")}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">{t("brandingSubtitle")}</p>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="catalog-title">{t("titleLabel")}</Label>
                  <Input
                    id="catalog-title"
                    value={formState.title}
                    onChange={(event) =>
                      setFormState((prev) => (prev ? { ...prev, title: event.target.value } : prev))
                    }
                    placeholder={settingsData.store.name}
                    disabled={!canEdit || upsertMutation.isLoading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="catalog-accent">{t("accentColorLabel")}</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="catalog-accent-picker"
                      type="color"
                      value={formState.accentColor}
                      onChange={(event) =>
                        setFormState((prev) =>
                          prev ? { ...prev, accentColor: event.target.value.toLowerCase() } : prev,
                        )
                      }
                      aria-label={t("accentColorPickerAria")}
                      className="h-10 w-16 p-1"
                      disabled={!canEdit || upsertMutation.isLoading}
                    />
                    <Input
                      id="catalog-accent"
                      value={formState.accentColor}
                      onChange={(event) =>
                        setFormState((prev) =>
                          prev ? { ...prev, accentColor: event.target.value } : prev,
                        )
                      }
                      aria-label={t("accentColorInputAria")}
                      disabled={!canEdit || upsertMutation.isLoading}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>{t("logoLabel")}</Label>
                <div className="flex flex-wrap items-center gap-3">
                  {formState.logoUrl ? (
                    <img
                      src={formState.logoUrl}
                      alt={t("logoPreviewAlt")}
                      className="h-14 w-14 rounded-md border border-border object-cover"
                    />
                  ) : (
                    <div className="flex h-14 w-14 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
                      {t("logoEmpty")}
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      void handleLogoUpload(file);
                      event.currentTarget.value = "";
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!canEdit || uploadingLogo || upsertMutation.isLoading}
                  >
                    {uploadingLogo ? <Spinner className="h-4 w-4" /> : null}
                    {t("uploadLogo")}
                  </Button>
                  {formState.logoImageId ? (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        setFormState((prev) =>
                          prev
                            ? {
                                ...prev,
                                logoImageId: null,
                                logoUrl: null,
                              }
                            : prev,
                        )
                      }
                      disabled={!canEdit || upsertMutation.isLoading}
                    >
                      {t("removeLogo")}
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="rounded-xl border border-border">
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold"
                  onClick={() => setAdvancedOpen((prev) => !prev)}
                  aria-expanded={advancedOpen}
                  aria-controls="catalog-advanced"
                >
                  <span>{t("advancedTitle")}</span>
                  <ChevronDownIcon
                    className={cn(
                      "h-4 w-4 text-muted-foreground transition-transform",
                      advancedOpen ? "rotate-180" : "",
                    )}
                    aria-hidden
                  />
                </button>
                {advancedOpen ? (
                  <div
                    id="catalog-advanced"
                    className="grid gap-4 border-t border-border p-4 md:grid-cols-2"
                  >
                    <div className="space-y-2">
                      <Label htmlFor="catalog-font">{t("fontLabel")}</Label>
                      <Select
                        value={formState.fontFamily}
                        onValueChange={(value) =>
                          setFormState((prev) =>
                            prev ? { ...prev, fontFamily: value as BazaarCatalogFontFamily } : prev,
                          )
                        }
                        disabled={!canEdit || upsertMutation.isLoading}
                      >
                        <SelectTrigger
                          id="catalog-font"
                          aria-label={t("fontLabel")}
                          style={previewFontStyle(formState.fontFamily)}
                        >
                          <SelectValue placeholder={t("fontLabel")} />
                        </SelectTrigger>
                        <SelectContent>
                          {fontOptions.map((option) => (
                            <SelectItem
                              key={option.value}
                              value={option.value}
                              style={previewFontStyle(option.value)}
                            >
                              {t(option.labelKey)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="catalog-header-style">{t("headerStyleLabel")}</Label>
                      <Select
                        value={formState.headerStyle}
                        onValueChange={(value) =>
                          setFormState((prev) =>
                            prev
                              ? { ...prev, headerStyle: value as BazaarCatalogHeaderStyle }
                              : prev,
                          )
                        }
                        disabled={!canEdit || upsertMutation.isLoading}
                      >
                        <SelectTrigger id="catalog-header-style" aria-label={t("headerStyleLabel")}>
                          <SelectValue placeholder={t("headerStyleLabel")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={BazaarCatalogHeaderStyle.STANDARD}>
                            {t("headerStyleStandard")}
                          </SelectItem>
                          <SelectItem value={BazaarCatalogHeaderStyle.COMPACT}>
                            {t("headerStyleCompact")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ) : null}
              </div>

              <div
                className="rounded-xl border border-border p-4"
                style={{ borderColor: `${formState.accentColor}55` }}
              >
                <p className="mb-3 text-sm text-muted-foreground">{t("previewTitle")}</p>
                <div
                  className="rounded-lg border border-border bg-background p-3"
                  style={previewFontStyle(formState.fontFamily)}
                >
                  <div
                    className={cn(
                      "mb-3 flex items-center justify-between",
                      formState.headerStyle === BazaarCatalogHeaderStyle.COMPACT ? "gap-2" : "gap-3",
                    )}
                  >
                    <div
                      className={cn(
                        "flex min-w-0 items-center",
                        formState.headerStyle === BazaarCatalogHeaderStyle.COMPACT ? "gap-2" : "gap-3",
                      )}
                    >
                      <div
                        className={cn(
                          "flex items-center justify-center rounded-md border border-border bg-secondary font-semibold",
                          formState.headerStyle === BazaarCatalogHeaderStyle.COMPACT
                            ? "h-8 w-8 text-xs"
                            : "h-10 w-10 text-sm",
                        )}
                      >
                        {settingsData.store.name.slice(0, 1).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p
                          className={cn(
                            "truncate font-semibold text-foreground",
                            formState.headerStyle === BazaarCatalogHeaderStyle.COMPACT
                              ? "text-sm"
                              : "text-base",
                          )}
                        >
                          {formState.title.trim() || settingsData.store.name}
                        </p>
                        <p
                          className={cn(
                            "truncate text-muted-foreground",
                            formState.headerStyle === BazaarCatalogHeaderStyle.COMPACT
                              ? "text-[11px]"
                              : "text-xs",
                          )}
                        >
                          {settingsData.store.name}
                        </p>
                      </div>
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                      {formState.headerStyle === BazaarCatalogHeaderStyle.COMPACT
                        ? t("headerStyleCompact")
                        : t("headerStyleStandard")}
                    </span>
                  </div>
                  <div
                    className={cn(
                      "mb-3 grid gap-2",
                      formState.headerStyle === BazaarCatalogHeaderStyle.COMPACT
                        ? "sm:grid-cols-[1fr_10rem]"
                        : "sm:grid-cols-[1fr_12rem]",
                    )}
                  >
                    <div
                      className={cn(
                        "rounded-md border border-input bg-background",
                        formState.headerStyle === BazaarCatalogHeaderStyle.COMPACT ? "h-8" : "h-9",
                      )}
                    />
                    <div
                      className={cn(
                        "rounded-md border border-input bg-background",
                        formState.headerStyle === BazaarCatalogHeaderStyle.COMPACT ? "h-8" : "h-9",
                      )}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="inline-flex rounded-full px-3 py-1 text-xs font-semibold text-white"
                      style={{ backgroundColor: formState.accentColor }}
                    >
                      {t("previewBadge")}
                    </span>
                    <button
                      type="button"
                      className="inline-flex h-9 items-center rounded-md px-3 text-sm font-semibold text-white"
                      style={{ backgroundColor: formState.accentColor }}
                    >
                      {t("previewButton")}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-border p-4">
                <div>
                  <p className="text-sm font-semibold">{t("publishLabel")}</p>
                  <p className="text-xs text-muted-foreground">{t("publishHint")}</p>
                </div>
                <Switch
                  checked={formState.publish}
                  onCheckedChange={(value) =>
                    setFormState((prev) => (prev ? { ...prev, publish: value } : prev))
                  }
                  aria-label={t("publishLabel")}
                  disabled={!canEdit || upsertMutation.isLoading}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  onClick={handleSave}
                  disabled={!canEdit || upsertMutation.isLoading || uploadingLogo}
                >
                  {upsertMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                  {tCommon("save")}
                </Button>
                {!canEdit ? (
                  <p className="text-xs text-muted-foreground">{t("readOnlyHint")}</p>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default BazaarCatalogSettingsPage;
