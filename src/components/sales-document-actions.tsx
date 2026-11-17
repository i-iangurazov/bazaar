"use client";

import { useId, useState, type ComponentProps, type ReactNode, type RefObject } from "react";
import { useTranslations } from "next-intl";

import { DownloadIcon, PrintIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { downloadPdfBlob, fetchPdfBlob, printPdfBlob } from "@/lib/pdfClient";

type DocumentKind = "invoice" | "goods_receipt";

export function SalesDocumentActions({
  orderId,
  number,
  variant = "secondary",
  iconOnly = false,
  className,
  disabled = false,
  open,
  onOpenChange,
  trigger,
  returnFocusRef,
}: {
  orderId: string;
  number: string;
  variant?: ComponentProps<typeof Button>["variant"];
  iconOnly?: boolean;
  className?: string;
  disabled?: boolean;
  /** Controlled open state for use from an external actions menu. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** `null` renders the dialog without its own trigger. */
  trigger?: ReactNode | null;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const t = useTranslations("salesDocuments");
  const tCommon = useTranslations("common");
  const { toast } = useToast();
  const selectId = useId();
  const [internalOpen, setInternalOpen] = useState(false);
  const dialogOpen = open ?? internalOpen;
  const setDialogOpen = (value: boolean) => {
    if (open === undefined) setInternalOpen(value);
    onOpenChange?.(value);
  };
  const [kind, setKind] = useState<DocumentKind>("invoice");
  const [action, setAction] = useState<"print" | "download" | null>(null);
  const [failed, setFailed] = useState(false);

  const handlePdf = async (nextAction: "print" | "download") => {
    if (!orderId || action) return;
    setAction(nextAction);
    setFailed(false);
    try {
      const query = new URLSearchParams({ kind, action: nextAction });
      const blob = await fetchPdfBlob({
        url: `/api/sales/orders/${encodeURIComponent(orderId)}/pdf?${query.toString()}`,
        init: { signal: AbortSignal.timeout(45_000) },
      });
      if (nextAction === "print") {
        const result = await printPdfBlob(blob);
        const nativeShareStatus = "nativeShareStatus" in result ? result.nativeShareStatus : undefined;
        if (
          !result.autoPrintAttempted &&
          nativeShareStatus !== "cancelled" &&
          nativeShareStatus !== "discarded"
        ) {
          toast({ variant: "info", description: t("printFallback") });
        }
      } else {
        const safeNumber = number.replace(/[^\p{L}\p{N}_.-]/gu, "-") || "document";
        downloadPdfBlob(blob, `bazaar-${safeNumber}-${kind}.pdf`);
      }
    } catch {
      setFailed(true);
    } finally {
      setAction(null);
    }
  };

  return (
    <Dialog
      open={dialogOpen}
      onOpenChange={(value) => {
        if (action) return;
        setDialogOpen(value);
        setFailed(false);
      }}
    >
      {trigger === null ? null : (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button
              type="button"
              variant={variant}
              size={iconOnly ? "icon" : "default"}
              className={className}
              disabled={disabled || !orderId}
              aria-label={t("open")}
              title={t("open")}
            >
              <PrintIcon className="h-4 w-4" aria-hidden />
              {!iconOnly ? t("open") : null}
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent
        size="sm"
        showClose={!action}
        onCloseAutoFocus={(event) => {
          const target = returnFocusRef?.current;
          if (target?.isConnected) {
            event.preventDefault();
            target.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("title", { number })}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={selectId}>{t("kind")}</Label>
            <Select
              value={kind}
              disabled={Boolean(action)}
              onValueChange={(value) => {
                setKind(value === "goods_receipt" ? "goods_receipt" : "invoice");
                setFailed(false);
              }}
            >
              <SelectTrigger id={selectId}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="invoice">{t("invoice")}</SelectItem>
                <SelectItem value="goods_receipt">{t("goodsReceipt")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">{t("nonFiscalHint")}</p>
          {failed ? (
            <p role="alert" className="text-sm text-danger">
              {t("failed")}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={Boolean(action)}
            onClick={() => setDialogOpen(false)}
          >
            {tCommon("cancel")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={Boolean(action)}
            onClick={() => void handlePdf("download")}
          >
            {action === "download" ? (
              <Spinner className="h-4 w-4" />
            ) : (
              <DownloadIcon className="h-4 w-4" aria-hidden />
            )}
            {t("download")}
          </Button>
          <Button type="button" disabled={Boolean(action)} onClick={() => void handlePdf("print")}>
            {action === "print" ? (
              <Spinner className="h-4 w-4" />
            ) : (
              <PrintIcon className="h-4 w-4" aria-hidden />
            )}
            {t("print")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
