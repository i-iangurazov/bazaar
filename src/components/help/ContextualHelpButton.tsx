"use client";

import Link from "next/link";
import { useLocale } from "next-intl";
import { usePathname } from "next/navigation";
import React, { useState } from "react";

import { GuidanceTipsTriggerButton } from "@/components/guidance/GuidanceButtons";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { getContextualHelpHref, getContextualHelpSummary } from "@/content/help/contextual";
import { localize, localizedUi } from "@/content/help/ui";
import { defaultLocale, normalizeLocale } from "@/lib/locales";

/** Contextual Guide trigger for fullscreen surfaces rendered outside GuidanceProvider. */
export const ContextualHelpButton = ({ className }: { className?: string }) => {
  const locale = normalizeLocale(useLocale()) ?? defaultLocale;
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const summary = getContextualHelpSummary(pathname);
  const href = getContextualHelpHref(pathname);
  const ui = localizedUi(locale);

  if (!summary || !href) return null;

  return (
    <>
      <GuidanceTipsTriggerButton
        pendingCount={0}
        onClick={() => setOpen(true)}
        className={className}
      />
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={localize(summary.title, locale)}
        subtitle={ui.onThisPage}
        mobileSheet
      >
        <ol className="space-y-3 text-sm text-muted-foreground">
          {summary.steps.map((step, index) => (
            <li key={index} className="flex gap-3">
              <span className="font-semibold text-primary">{index + 1}.</span>
              <span>{localize(step, locale)}</span>
            </li>
          ))}
        </ol>
        <Button asChild type="button" className="mt-5 w-full">
          <Link href={href} target="_blank" rel="noopener noreferrer">
            {ui.openGuide} →
          </Link>
        </Button>
      </Modal>
    </>
  );
};
