"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { ExternalLinkIcon, SparklesIcon } from "@/components/icons";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { hasPermission, type RoleAccess } from "@/lib/roleAccess";

const hiddenPrefixes = [
  "/pos", "/inventory", "/reports/receipts", "/printing/receipt",
  "/cash", "/finance/income", "/finance/expense", "/help/pos",
];

export const canShowBaamLauncher = (access: RoleAccess, pathname: string) =>
  hasPermission(access, "viewReports") &&
  !hiddenPrefixes.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));

export function BaamLauncher({ access, pathname, children }: {
  access: RoleAccess;
  /** Locale-normalized application path from AppShell. */
  pathname: string;
  children: ReactNode;
}) {
  const t = useTranslations("baam.assistant");
  const tBaam = useTranslations("baam");
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  if (!canShowBaamLauncher(access, pathname)) return null;

  const inWorkspace = pathname === "/baam" || pathname === "/baam/";
  const focusWorkspace = () => {
    const workspace = document.querySelector<HTMLElement>("[data-baam-workspace]");
    const target = workspace?.querySelector<HTMLTextAreaElement>("textarea:not(:disabled)") ?? workspace;
    target?.scrollIntoView({ block: "center" });
    target?.focus({ preventScroll: true });
  };
  const launcher = (
    <button
      type="button" aria-label={t("launcherLabel")} title={t("launcherLabel")} data-baam-launcher
      onClick={inWorkspace ? focusWorkspace : undefined}
      className="button-focus-ring fixed bottom-[calc(6rem+env(safe-area-inset-bottom,0px))] right-[max(1rem,env(safe-area-inset-right,0px))] z-30 flex h-14 w-14 flex-col items-center justify-center gap-0.5 rounded-full border border-primary-foreground/20 bg-primary text-primary-foreground shadow-lg shadow-primary/25 transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 md:bottom-6 md:right-6 [body:has([role=dialog][data-state=open])_&]:invisible [body:has([role=alertdialog][data-state=open])_&]:invisible"
    >
      <SparklesIcon className="h-5 w-5" aria-hidden />
      <span className="text-[9px] font-bold leading-none tracking-wider" aria-hidden>{tBaam("title")}</span>
    </button>
  );

  // The workspace already hosts this conversation. Focus it without mounting a second panel.
  if (inWorkspace) return launcher;

  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild>{launcher}</DialogTrigger>
    <DialogContent
      className="bottom-0 left-0 right-0 top-auto h-[min(44rem,90dvh)] max-h-[90dvh] w-full max-w-none translate-x-0 translate-y-0 rounded-b-none rounded-t-2xl pb-[env(safe-area-inset-bottom,0px)] sm:bottom-4 sm:left-auto sm:right-4 sm:h-[min(42rem,calc(100dvh-2rem))] sm:max-h-[calc(100dvh-2rem)] sm:max-w-[26rem] sm:rounded-2xl"
    >
      <DialogHeader className="space-y-1">
        <DialogTitle className="flex items-center gap-2"><SparklesIcon className="h-5 w-5 text-primary" aria-hidden />{tBaam("title")}</DialogTitle>
        <DialogDescription>{t("drawerDescription")}</DialogDescription>
        <Link href="/baam" prefetch={false} onClick={() => setOpen(false)}
          className="button-focus-ring inline-flex min-h-8 items-center gap-1 rounded-md text-xs font-medium text-primary hover:underline">
          {t("openWorkspace")}<ExternalLinkIcon className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </DialogHeader>
      <div className="min-h-0 flex-1">{open ? children : null}</div>
    </DialogContent>
  </Dialog>;
}
