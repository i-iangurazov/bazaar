"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

type ConfirmVariant = "primary" | "secondary" | "danger" | "destructive";

type ConfirmOptions = {
  title?: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: ConfirmVariant;
};

type ConfirmState = ConfirmOptions & {
  open: boolean;
};

const defaultState: ConfirmState = {
  open: false,
  title: "",
  description: "",
  confirmLabel: "",
  cancelLabel: "",
  confirmVariant: "primary",
};

export const useConfirmDialog = () => {
  const tCommon = useTranslations("common");
  const [state, setState] = useState<ConfirmState>(defaultState);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const close = (value: boolean) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setState(defaultState);
  };

  useEffect(() => {
    return () => {
      resolverRef.current?.(false);
      resolverRef.current = null;
    };
  }, []);

  const confirm = (options: ConfirmOptions) =>
    new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setState({
        open: true,
        title: options.title ?? tCommon("confirm"),
        description: options.description,
        confirmLabel: options.confirmLabel ?? tCommon("confirm"),
        cancelLabel: options.cancelLabel ?? tCommon("cancel"),
        confirmVariant: options.confirmVariant ?? "primary",
      });
    });

  const dialog = (
    <Modal
      open={state.open}
      onOpenChange={(open) => {
        if (!open) {
          close(false);
        }
      }}
      title={state.title || tCommon("confirm")}
      subtitle={state.description}
    >
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => close(false)}>
          {state.cancelLabel || tCommon("cancel")}
        </Button>
        <Button
          variant={state.confirmVariant}
          onClick={() => close(true)}
        >
          {state.confirmLabel || tCommon("confirm")}
        </Button>
      </div>
    </Modal>
  );

  return { confirm, confirmDialog: dialog };
};

