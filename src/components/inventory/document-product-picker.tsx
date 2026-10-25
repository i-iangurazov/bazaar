"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";

import { AddIcon, ChevronDownIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Keep the document table wide while retaining the full catalog and its draft refs. */
export function DocumentProductPicker({
  title,
  action,
  initiallyOpen = false,
  children,
}: {
  title: ReactNode;
  action?: ReactNode;
  initiallyOpen?: boolean;
  children: ReactNode;
}) {
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(initiallyOpen);
  const bodyId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <section className="bazaar-doc-surface min-w-0 p-4" data-document-product-picker>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <h3 className="min-w-0">
          <Button
            ref={triggerRef}
            type="button"
            variant="secondary"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => {
              setOpen(!open);
              if (!open)
                requestAnimationFrame(() => {
                  bodyRef.current?.querySelector<HTMLInputElement>("input:not(:disabled)")?.focus();
                });
            }}
          >
            <AddIcon className="h-4 w-4" aria-hidden />
            {title}
            <ChevronDownIcon className={cn("h-3.5 w-3.5", open && "rotate-180")} aria-hidden />
          </Button>
        </h3>
        {action}
      </div>
      <div
        ref={bodyRef}
        id={bodyId}
        hidden={!open}
        className="mt-4"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !event.defaultPrevented) {
            event.preventDefault();
            close();
          }
        }}
      >
        {children}
        <div className="mt-3 flex justify-end">
          <Button type="button" variant="secondary" onClick={close}>
            {tCommon("close")}
          </Button>
        </div>
      </div>
    </section>
  );
}
