"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { BarcodeIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { isPluginAvailable } from "@/lib/native/platform";
import { scanBarcodeNative } from "@/lib/native/scanner";
import type { CameraError } from "@/lib/scanning/browser-scanner";

function CameraPreview({ onScan }: { onScan: (value: string) => void }) {
  const t = useTranslations("nativeApp");
  const video = useRef<HTMLVideoElement>(null);
  const scanRef = useRef(onScan);
  scanRef.current = onScan;
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [error, setError] = useState<CameraError | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | undefined;
    setError(null);
    setReady(false);
    void import("@/lib/scanning/browser-scanner")
      .then(({ startBrowserScanner }) => {
        if (cancelled || !video.current) return;
        stop = startBrowserScanner({
          video: video.current,
          facingMode,
          onScan: (value) => scanRef.current(value),
          onReady: () => setReady(true),
          onError: setError,
        });
      })
      .catch(() => {
        if (!cancelled) setError("scannerUnavailable");
      });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [facingMode]);
  return (
    <div className="space-y-3">
      <video
        ref={video}
        muted
        autoPlay
        playsInline
        className="aspect-video w-full rounded-md bg-black object-cover"
      />
      <p role={error ? "alert" : "status"}>
        {error ? t(error) : ready ? t("scanInstructions") : t("cameraStarting")}
      </p>
      <Button
        type="button"
        variant="secondary"
        onClick={() => setFacingMode((mode) => (mode === "environment" ? "user" : "environment"))}
      >
        {t("cameraSwitch")}
      </Button>
    </div>
  );
}

export function CameraScanButton({
  disabled = false,
  onScan,
  iconOnly = false,
  className,
}: {
  disabled?: boolean;
  onScan: (value: string) => void | Promise<void>;
  iconOnly?: boolean;
  className?: string;
}) {
  const t = useTranslations("nativeApp");
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const scan = async () => {
    if (disabled || busy.current) return;
    if (!isPluginAvailable("CapacitorBarcodeScanner")) {
      setOpen(true);
      return;
    }
    busy.current = true;
    setScanning(true);
    try {
      const result = await scanBarcodeNative({
        instructions: t("scanInstructions"),
        cancel: t("scanCancel"),
        torchOn: t("torchOn"),
        torchOff: t("torchOff"),
      });
      if (!mounted.current) return;
      if (result.status === "scanned") await onScan(result.value);
      else if (result.status !== "cancelled")
        toast({
          variant: "error",
          description: t(
            result.status === "permission-denied" ? "cameraPermissionDenied" : "scannerUnavailable",
          ),
        });
    } finally {
      busy.current = false;
      if (mounted.current) setScanning(false);
    }
  };
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size={iconOnly ? "icon" : "default"}
        className={className}
        aria-label={t("scanCamera")}
        title={t("scanCamera")}
        disabled={disabled || scanning}
        onClick={() => void scan()}
      >
        <BarcodeIcon className="h-4 w-4" aria-hidden />
        {iconOnly ? null : t("scanCamera")}
      </Button>
      {open ? (
        <Modal open onOpenChange={setOpen} title={t("scanCamera")}>
          <CameraPreview
            onScan={(value) => {
              setOpen(false);
              void onScan(value);
            }}
          />
        </Modal>
      ) : null}
    </>
  );
}
