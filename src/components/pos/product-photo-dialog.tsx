"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { CloseIcon, EmptyIcon } from "@/components/icons";
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
    <div
      className={`relative grid place-items-center ${status !== "ready" ? "min-h-44 min-w-64 rounded-lg bg-card text-card-foreground" : ""}`}
    >
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
            className="block h-auto max-h-[min(80dvh,52rem)] w-auto max-w-[min(calc(100vw-3rem),80rem)] select-none rounded-lg object-contain shadow-[0_24px_80px_rgba(0,0,0,0.22)] sm:max-w-[min(86vw,80rem)]"
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
        overlayProps={{ onClick: onClose, className: "bg-black/35 backdrop-blur-[5px]" }}
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
        className="max-h-none w-max max-w-[calc(100vw-3rem)] cursor-zoom-out overflow-visible rounded-lg border-0 bg-transparent p-0 shadow-none sm:max-h-none sm:max-w-[min(86vw,80rem)]"
      >
        <DialogTitle className="sr-only">{photo?.name}</DialogTitle>
        {photo ? <Photo key={photo.url} {...photo} /> : null}
        <button
          type="button"
          aria-label={common("close")}
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          className="absolute -right-3 -top-3 grid h-10 w-10 cursor-pointer place-items-center rounded-full bg-card/95 text-foreground shadow-md ring-1 ring-border/60 backdrop-blur transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CloseIcon className="h-[18px] w-[18px]" aria-hidden />
        </button>
      </DialogContent>
    </Dialog>
  );
};
