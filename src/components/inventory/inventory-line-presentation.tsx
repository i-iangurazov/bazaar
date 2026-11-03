"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { EmptyIcon } from "@/components/icons";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function InventoryProductThumbnail({
  imageUrl,
  className,
}: {
  imageUrl: string | null;
  className: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  useEffect(() => setFailedUrl(null), [imageUrl]);
  return (
    <span className={className} aria-hidden="true">
      {imageUrl && imageUrl !== failedUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
          decoding="async"
          onError={() => setFailedUrl(imageUrl)}
        />
      ) : (
        <EmptyIcon className="h-4 w-4 text-muted-foreground" aria-hidden />
      )}
    </span>
  );
}

export function InventoryLinePresentationNotice({
  isError,
  onRetry,
}: {
  isError: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations("inventory");
  if (!isError) return null;
  return (
    <Alert className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <span>{t("lineDetailsLoadError")}</span>
      <Button type="button" size="sm" variant="secondary" onClick={onRetry}>
        {t("lineDetailsRetry")}
      </Button>
    </Alert>
  );
}
