"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { BackIcon, EmptyIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";

export type PosProductPhoto = { name: string; url: string };

export const PosProductPhotoButton = ({
  photo,
  onPreview,
  className,
  imageClassName,
  disabled,
}: {
  photo: PosProductPhoto;
  onPreview: (photo: PosProductPhoto) => void;
  className: string;
  imageClassName: string;
  disabled?: boolean;
}) => {
  const t = useTranslations("pos.sell");
  return (
    <button
      type="button"
      data-pos-product-image
      aria-label={t("viewPhoto", { name: photo.name })}
      title={t("viewPhoto", { name: photo.name })}
      className={`relative overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        event.currentTarget.focus({ preventScroll: true });
        onPreview(photo);
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photo.url}
        alt={photo.name}
        loading="lazy"
        decoding="async"
        className={imageClassName}
      />
    </button>
  );
};

const Photo = ({ url, name }: PosProductPhoto) => {
  const t = useTranslations("pos.sell");
  const common = useTranslations("common");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  return (
    <div className="relative grid min-h-40 w-full place-items-center">
      {status === "error" ? (
        <div
          role="alert"
          className="flex flex-col items-center gap-3 p-4 text-center text-sm text-muted-foreground"
        >
          <EmptyIcon className="h-8 w-8" aria-hidden />
          <p>{t("photoLoadFailed")}</p>
          <Button
            variant="secondary"
            onClick={(event) => {
              event.stopPropagation();
              setStatus("loading");
              setAttempt((value) => value + 1);
            }}
          >
            {common("tryAgain")}
          </Button>
        </div>
      ) : (
        <>
          {status === "loading" ? (
            <span
              role="status"
              aria-label={common("loading")}
              className="absolute inset-0 grid place-items-center"
            >
              <Spinner className="h-7 w-7" />
            </span>
          ) : null}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={attempt}
            src={url}
            alt={name}
            data-testid="pos-photo-preview"
            draggable={false}
            onLoad={() => setStatus("ready")}
            onError={() => setStatus("error")}
            className="h-auto max-h-[min(72dvh,40rem)] w-auto max-w-full select-none object-contain"
          />
        </>
      )}
    </div>
  );
};

export const PosProductPhotoDialog = ({
  photo,
  onClose,
}: {
  photo: PosProductPhoto | null;
  onClose: () => void;
}) => {
  const common = useTranslations("common");
  const previousFocus = useRef<HTMLElement | null>(null);
  return (
    <Dialog
      open={Boolean(photo)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        size="xl"
        showClose={false}
        overlayProps={{ onClick: onClose }}
        aria-describedby={undefined}
        data-testid="pos-photo-dialog"
        onClick={onClose}
        onOpenAutoFocus={() => {
          previousFocus.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target = previousFocus.current;
          previousFocus.current = null;
          queueMicrotask(() => {
            if (target?.isConnected) target.focus({ preventScroll: true });
          });
        }}
        className="max-h-[85dvh] w-[calc(100vw-2rem)] cursor-zoom-out bg-black text-white"
      >
        <DialogTitle className="sr-only">{photo?.name}</DialogTitle>
        <div className="pointer-events-none flex shrink-0 items-start gap-3 p-3">
          <Button variant="secondary" className="pointer-events-auto min-h-11 shrink-0">
            <BackIcon className="h-4 w-4" aria-hidden />
            {common("back")}
          </Button>
          <p aria-hidden className="line-clamp-2 min-w-0 break-words pt-2 text-sm font-medium">
            {photo?.name}
          </p>
        </div>
        {photo ? <Photo key={photo.url} {...photo} /> : null}
      </DialogContent>
    </Dialog>
  );
};
